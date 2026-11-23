import Groq from 'groq-sdk';
import { config } from '../config.js';
import { jobRepo, JobRepository, SavedJob, JobStatus, JobType } from '../db/job.repo.js';
import {
  JobExtractionZodSchema,
  JobExtractionResult,
  JobMessagingAdapter,
  JobMessagePayload,
} from './job.types.js';
import { telegramJobMessagingAdapter } from './job.messaging.adapter.js';
import { taskService, TaskService } from './task.service.js';
import { dateResolver } from './date.resolver.js';

export interface SaveJobInput {
  userId: string;
  rawText: string;
  chatId: number | string;
  messageId?: number | string | null;
  imageFileId?: string | null;
  initialType?: JobType;
  timezone?: string;
  defaultReminderTime?: string;
}

export class JobService {
  private groq: Groq;

  constructor(
    private repo: JobRepository = jobRepo,
    private messaging: JobMessagingAdapter = telegramJobMessagingAdapter,
    private tasks: TaskService = taskService,
    apiKey: string = config.llm.groqApiKey
  ) {
    this.groq = new Groq({ apiKey });
  }

  /**
   * Immediately saves the raw job text to guarantee zero data loss and returns the saved entry.
   */
  async saveJobImmediate(input: SaveJobInput): Promise<{ job: SavedJob; isDuplicate: boolean }> {
    const { userId, rawText, chatId, messageId, imageFileId, initialType } = input;

    // Idempotency check: if message was already processed
    if (messageId && chatId) {
      const existing = await this.repo.findBySource(userId, chatId, messageId);
      if (existing) {
        return { job: existing, isDuplicate: true };
      }
    }

    // Infer type if lone link or form questions
    let detectedType = initialType || 'other';
    const trimmed = rawText.trim();
    if (/^https?:\/\/[^\s]+$/i.test(trimmed) && /(forms\.gle|typeform\.com|google\.com\/forms|airtable\.com|fillout\.com)/i.test(trimmed)) {
      detectedType = 'form';
    } else if (/@[\w.-]+\.[a-zA-Z]{2,}/.test(trimmed) && /subject/i.test(trimmed)) {
      detectedType = 'email';
    }

    const job = await this.repo.create({
      userId,
      rawText,
      type: detectedType,
      sourceTelegramChatId: chatId,
      sourceTelegramMessageId: messageId,
      imageFileId: imageFileId || null,
      status: 'to-apply',
    });

    return { job, isDuplicate: false };
  }

  /**
   * Background task: extracts structured fields with Groq LLM, validates with Zod,
   * updates the database, creates a linked task under the 'Jobs' category if applicable,
   * and edits or sends the final scannable card.
   */
  processExtractionAsync(
    jobId: number,
    userId: string,
    chatId: number | string,
    tempMessageId?: number | string,
    opts: { timezone?: string; defaultReminderTime?: string } = {}
  ): void {
    setImmediate(async () => {
      try {
        const job = await this.repo.findById(jobId, userId);
        if (!job) return;

        const extracted = await this.extractWithLlm(job.raw_text, job.type);

        // If deadline is present, schedule a task in the "Jobs" category
        let linkedTaskId: string | null = null;
        if (extracted.deadline) {
          try {
            const taskTitle = `Apply: ${extracted.jobTitle || 'Job'} at ${extracted.company || 'Company'}`;
            const dueResolution = dateResolver.resolveNatural(extracted.deadline, {
              timezone: opts.timezone || 'Asia/Kolkata',
              defaultReminderTime: opts.defaultReminderTime || '09:00',
            });

            const taskRes = await this.tasks.createTask({
              userId,
              title: taskTitle.slice(0, 200),
              details: extracted.summary || undefined,
              dueLocal: dueResolution.kind === 'RESOLVED' ? dueResolution.localIso : undefined,
              timeIsExplicit: dueResolution.kind === 'RESOLVED' ? dueResolution.timeIsExplicit : false,
              category: 'Jobs',
              userTimezone: opts.timezone,
              defaultReminderTime: opts.defaultReminderTime,
            });

            if (taskRes.taskId) {
              linkedTaskId = taskRes.taskId;
            }
          } catch (taskErr) {
            console.error('[JobService] Failed to auto-create linked job task:', taskErr);
          }
        }

        // Update database with extracted fields
        const updatedJob = await this.repo.updateExtracted(jobId, userId, {
          type: extracted.type,
          jobTitle: extracted.jobTitle,
          company: extracted.company,
          applyEmail: extracted.applyEmail,
          requiredSubject: extracted.requiredSubject,
          requiredInstructions: extracted.requiredInstructions,
          formLink: extracted.formLink,
          formQuestions: extracted.formQuestions,
          deadline: extracted.deadline,
          summary: extracted.summary,
          status: extracted.status,
          linkedTaskId,
        });

        if (!updatedJob) return;

        // Render card
        const card = this.formatJobCard(updatedJob);
        if (tempMessageId) {
          await this.messaging.editMessage(chatId, tempMessageId, card);
        } else {
          await this.messaging.sendMessage(chatId, card);
        }
      } catch (err: any) {
        console.error(`[JobService] Background extraction failed for job ${jobId}:`, err);
        // Fallback: update status to needs-review
        await this.repo.setStatus(jobId, userId, 'needs-review');
        const fallbackText = `⚠️ <b>Job #${jobId} saved (Needs Review)</b>\n\nAI extraction encountered an error. Your original text is safely stored.\nUse <code>/job ${jobId}</code> to inspect.`;
        if (tempMessageId) {
          await this.messaging.editMessage(chatId, tempMessageId, {
            text: fallbackText,
            buttons: [
              [
                { text: '📄 Show original', callbackData: `job:orig:${jobId}` },
                { text: '🔄 Re-run', callbackData: `job:rerun:${jobId}` },
              ],
            ],
          });
        }
      }
    });
  }

  /**
   * Calls Groq LLM with strict JSON schema and retries once if Zod validation fails.
   */
  async extractWithLlm(rawText: string, currentType: JobType = 'other'): Promise<JobExtractionResult> {
    // Truncate safely for LLM context window (max 4000 chars) while rawText in DB remains 100% full
    const safeText = rawText.length > 4000 ? rawText.slice(0, 4000) + '\n[...truncated for AI extraction...]' : rawText;

    const systemPrompt = `You are an expert recruitment and job posting parser. Read the raw text and extract structured job application information.
Output strict JSON matching this schema:
{
  "type": "email" | "form" | "other",
  "jobTitle": string | null,
  "company": string | null,
  "applyEmail": string | null,
  "requiredSubject": string | null,
  "requiredInstructions": string | null,
  "formLink": string | null,
  "formQuestions": string[],
  "deadline": string | null,
  "summary": string | null,
  "status": "to-apply" | "applied" | "needs-review"
}

STRICT RULES:
1. Never invent data. If something is not explicitly stated in the text, return null (or [] for formQuestions).
2. Extract exact strings for applyEmail and requiredSubject, character for character.
3. requiredInstructions should list specific requirements mentioned (e.g. "attach portfolio", "mention notice period", "tell us about X").
4. If it's a lone form link (e.g. google forms, typeform) or form questions with no context, set type="form".
5. summary must be at most 2 lines: what the job is and what the applicant needs to do.
6. status must be "to-apply" by default.
Output JSON only. Do not add markdown backticks or commentary.`;

    let attempt = 0;
    while (attempt < 2) {
      attempt++;
      try {
        const response = await this.groq.chat.completions.create({
          model: config.llm.model || 'openai/gpt-oss-120b',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: safeText },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        });

        const rawJson = response.choices[0]?.message?.content || '{}';
        const parsed = JSON.parse(rawJson);
        const validated = JobExtractionZodSchema.parse(parsed);

        // Fallback type if lone form link or questions
        if (currentType === 'form' && validated.type === 'other') {
          validated.type = 'form';
        }

        return validated;
      } catch (err: any) {
        console.warn(`[JobService] Extraction attempt ${attempt} failed: ${err.message}`);
        if (attempt >= 2) {
          // Fallback extraction
          return {
            type: currentType,
            jobTitle: null,
            company: null,
            applyEmail: this.findRegex(rawText, /[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}/),
            requiredSubject: null,
            requiredInstructions: null,
            formLink: this.findRegex(rawText, /https?:\/\/[^\s]+/),
            formQuestions: [],
            deadline: null,
            summary: rawText.slice(0, 160),
            status: 'needs-review',
          };
        }
      }
    }

    return {
      type: currentType,
      jobTitle: null,
      company: null,
      applyEmail: null,
      requiredSubject: null,
      requiredInstructions: null,
      formLink: null,
      formQuestions: [],
      deadline: null,
      summary: null,
      status: 'needs-review',
    };
  }

  /**
   * Re-runs the LLM extraction on existing raw_text.
   */
  async reRunExtraction(
    jobId: number,
    userId: string,
    chatId: number | string,
    messageId?: number | string
  ): Promise<void> {
    const job = await this.repo.findById(jobId, userId);
    if (!job) return;

    if (messageId) {
      await this.messaging.editMessage(chatId, messageId, {
        text: `⏳ <b>Re-extracting Job #${jobId}...</b>`,
      });
    }

    this.processExtractionAsync(jobId, userId, chatId, messageId);
  }

  /**
   * Marks a job as applied and updates any linked task.
   */
  async markApplied(jobId: number, userId: string): Promise<SavedJob | null> {
    const updated = await this.repo.setStatus(jobId, userId, 'applied');
    if (updated?.linked_task_id) {
      try {
        await this.tasks.completeTask(userId, updated.linked_task_id);
      } catch (err) {
        // Ignored
      }
    }
    return updated;
  }

  /**
   * Updates an individual field manually via /edit.
   */
  async editField(jobId: number, userId: string, field: string, value: string): Promise<SavedJob | null> {
    return this.repo.updateField(jobId, userId, field, value);
  }

  /**
   * Deletes a job entry and removes any linked task.
   */
  async deleteJob(jobId: number, userId: string): Promise<boolean> {
    const job = await this.repo.findById(jobId, userId);
    if (!job) return false;
    if (job.linked_task_id) {
      try {
        await this.tasks.dropTask(userId, job.linked_task_id);
      } catch (err) {
        // Ignored
      }
    }
    return this.repo.delete(jobId, userId);
  }

  async getJob(jobId: number, userId: string): Promise<SavedJob | null> {
    return this.repo.findById(jobId, userId);
  }

  async listJobs(userId: string, filter?: { status?: JobStatus; limit?: number }): Promise<SavedJob[]> {
    return this.repo.list(userId, filter);
  }

  /**
   * Formats a clean, scannable job card with tap-to-copy codes for Telegram.
   */
  formatJobCard(job: SavedJob): JobMessagePayload {
    const role = job.job_title ? `<b>${job.job_title}</b>` : '<i>Not specified</i>';
    const comp = job.company ? ` at <b>${job.company}</b>` : '';

    let details = `📌 <b>Job #${job.id} saved</b>\n` + `Role: ${role}${comp}\n`;

    if (job.apply_email) {
      details += `Email: <code>${job.apply_email}</code>\n`;
    }
    if (job.required_subject) {
      details += `Subject: <code>${job.required_subject}</code>\n`;
    }
    if (job.required_instructions) {
      details += `Instructions: <i>${job.required_instructions}</i>\n`;
    }
    if (job.form_link) {
      details += `Form: ${job.form_link}\n`;
    }
    if (job.form_questions && job.form_questions.length > 0) {
      details += `Questions: ${job.form_questions.map((q) => `\n• ${q}`).join('')}\n`;
    }
    if (job.deadline) {
      details += `Deadline: <b>${job.deadline}</b>\n`;
    }
    if (job.summary) {
      details += `Summary: <i>${job.summary}</i>\n`;
    }

    const statusBadge =
      job.status === 'applied' ? '✅ APPLIED' : job.status === 'needs-review' ? '⚠️ NEEDS REVIEW' : '⏳ TO-APPLY';
    details += `Status: <b>${statusBadge}</b>`;

    const buttons = [
      [
        { text: '📄 Show original', callbackData: `job:orig:${job.id}` },
        { text: job.status === 'applied' ? '↩️ To-Apply' : '✅ Mark applied', callbackData: `job:app:${job.id}` },
      ],
      [
        { text: '🔄 Re-run', callbackData: `job:rerun:${job.id}` },
        { text: '🗑️ Delete', callbackData: `job:del:${job.id}` },
      ],
    ];

    return { text: details, buttons };
  }

  /**
   * Formats a list overview of jobs.
   */
  formatJobsList(jobs: SavedJob[], title = '💼 Saved Jobs'): JobMessagePayload {
    if (jobs.length === 0) {
      return {
        text: `📭 <b>${title}</b>\n\nNo jobs saved yet! Forward a job post or use <code>/job [paste post]</code> to save one.`,
      };
    }

    let text = `💼 <b>${title}</b> (${jobs.length})\n\n`;
    const buttons: { text: string; callbackData: string }[][] = [];

    jobs.forEach((j) => {
      const badge = j.status === 'applied' ? '✅' : j.status === 'needs-review' ? '⚠️' : '⏳';
      const roleStr = j.job_title || 'Opportunity';
      const compStr = j.company ? ` • ${j.company}` : '';
      const deadlineStr = j.deadline ? ` (Due: ${j.deadline})` : '';
      text += `${badge} <b>#${j.id}</b>: ${roleStr}${compStr}${deadlineStr}\n`;
      text += `   ↳ /job_${j.id} • ${j.type.toUpperCase()}\n\n`;
    });

    text += `💡 <i>Tap any job command above to view details, or <code>/jobs todo</code> for pending applications.</i>`;

    return { text, buttons };
  }

  private findRegex(str: string, reg: RegExp): string | null {
    const match = str.match(reg);
    return match ? match[0] : null;
  }
}

export const jobService = new JobService();
