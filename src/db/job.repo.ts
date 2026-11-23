import { pool } from './pool.js';

export type JobType = 'email' | 'form' | 'other';
export type JobStatus = 'to-apply' | 'applied' | 'needs-review';

export interface SavedJob {
  id: number;
  user_id: string;
  type: JobType;
  job_title: string | null;
  company: string | null;
  apply_email: string | null;
  required_subject: string | null;
  required_instructions: string | null;
  form_link: string | null;
  form_questions: string[];
  deadline: string | null;
  summary: string | null;
  status: JobStatus;
  raw_text: string;
  source_telegram_message_id: string | null;
  source_telegram_chat_id: string | null;
  image_file_id: string | null;
  linked_task_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateJobInput {
  userId: string;
  rawText: string;
  type?: JobType;
  jobTitle?: string | null;
  company?: string | null;
  applyEmail?: string | null;
  requiredSubject?: string | null;
  requiredInstructions?: string | null;
  formLink?: string | null;
  formQuestions?: string[];
  deadline?: string | null;
  summary?: string | null;
  status?: JobStatus;
  sourceTelegramMessageId?: number | string | null;
  sourceTelegramChatId?: number | string | null;
  imageFileId?: string | null;
  linkedTaskId?: number | string | null;
}

export interface UpdateExtractedInput {
  type: JobType;
  jobTitle: string | null;
  company: string | null;
  applyEmail: string | null;
  requiredSubject: string | null;
  requiredInstructions: string | null;
  formLink: string | null;
  formQuestions: string[];
  deadline: string | null;
  summary: string | null;
  status?: JobStatus;
  linkedTaskId?: number | string | null;
}

export interface JobRepository {
  create(input: CreateJobInput): Promise<SavedJob>;
  findById(id: number, userId: string): Promise<SavedJob | null>;
  findBySource(userId: string, chatId: number | string, messageId: number | string): Promise<SavedJob | null>;
  updateExtracted(id: number, userId: string, extracted: UpdateExtractedInput): Promise<SavedJob | null>;
  updateField(id: number, userId: string, field: string, value: string): Promise<SavedJob | null>;
  setStatus(id: number, userId: string, status: JobStatus): Promise<SavedJob | null>;
  list(userId: string, filter?: { status?: JobStatus; limit?: number }): Promise<SavedJob[]>;
  delete(id: number, userId: string): Promise<boolean>;
}

export class PostgresJobRepository implements JobRepository {
  async create(input: CreateJobInput): Promise<SavedJob> {
    const questionsJson = JSON.stringify(input.formQuestions || []);
    const res = await pool.query(
      `
      INSERT INTO saved_jobs (
        user_id, raw_text, type, job_title, company, apply_email,
        required_subject, required_instructions, form_link, form_questions,
        deadline, summary, status, source_telegram_message_id, source_telegram_chat_id,
        image_file_id, linked_task_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *;
      `,
      [
        input.userId,
        input.rawText,
        input.type || 'other',
        input.jobTitle || null,
        input.company || null,
        input.applyEmail || null,
        input.requiredSubject || null,
        input.requiredInstructions || null,
        input.formLink || null,
        questionsJson,
        input.deadline || null,
        input.summary || null,
        input.status || 'to-apply',
        input.sourceTelegramMessageId ? String(input.sourceTelegramMessageId) : null,
        input.sourceTelegramChatId ? String(input.sourceTelegramChatId) : null,
        input.imageFileId || null,
        input.linkedTaskId ? String(input.linkedTaskId) : null,
      ]
    );

    return this.mapRow(res.rows[0]);
  }

  async findById(id: number, userId: string): Promise<SavedJob | null> {
    const res = await pool.query(
      `SELECT * FROM saved_jobs WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (!res.rowCount || res.rowCount === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  async findBySource(userId: string, chatId: number | string, messageId: number | string): Promise<SavedJob | null> {
    const res = await pool.query(
      `
      SELECT * FROM saved_jobs 
      WHERE user_id = $1 AND source_telegram_chat_id = $2 AND source_telegram_message_id = $3
      `,
      [userId, String(chatId), String(messageId)]
    );
    if (!res.rowCount || res.rowCount === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  async updateExtracted(id: number, userId: string, extracted: UpdateExtractedInput): Promise<SavedJob | null> {
    const questionsJson = JSON.stringify(extracted.formQuestions || []);
    const res = await pool.query(
      `
      UPDATE saved_jobs
      SET type = $3,
          job_title = $4,
          company = $5,
          apply_email = $6,
          required_subject = $7,
          required_instructions = $8,
          form_link = $9,
          form_questions = $10,
          deadline = $11,
          summary = $12,
          status = COALESCE($13, status),
          linked_task_id = COALESCE($14, linked_task_id),
          updated_at = now()
      WHERE id = $1 AND user_id = $2
      RETURNING *;
      `,
      [
        id,
        userId,
        extracted.type,
        extracted.jobTitle,
        extracted.company,
        extracted.applyEmail,
        extracted.requiredSubject,
        extracted.requiredInstructions,
        extracted.formLink,
        questionsJson,
        extracted.deadline,
        extracted.summary,
        extracted.status || null,
        extracted.linkedTaskId ? String(extracted.linkedTaskId) : null,
      ]
    );
    if (!res.rowCount || res.rowCount === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  async updateField(id: number, userId: string, field: string, value: string): Promise<SavedJob | null> {
    const fieldMap: Record<string, string> = {
      subject: 'required_subject',
      requiredsubject: 'required_subject',
      email: 'apply_email',
      applyemail: 'apply_email',
      instructions: 'required_instructions',
      instruction: 'required_instructions',
      requiredinstructions: 'required_instructions',
      role: 'job_title',
      title: 'job_title',
      jobtitle: 'job_title',
      company: 'company',
      deadline: 'deadline',
      link: 'form_link',
      formlink: 'form_link',
      summary: 'summary',
      status: 'status',
      type: 'type',
    };

    const col = fieldMap[field.toLowerCase().replace(/[^a-z]/g, '')];
    if (!col) {
      throw new Error(`Invalid field '${field}'. Allowed fields: subject, email, instructions, role, company, deadline, link, status.`);
    }

    const res = await pool.query(
      `
      UPDATE saved_jobs
      SET ${col} = $3, updated_at = now()
      WHERE id = $1 AND user_id = $2
      RETURNING *;
      `,
      [id, userId, value]
    );

    if (!res.rowCount || res.rowCount === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  async setStatus(id: number, userId: string, status: JobStatus): Promise<SavedJob | null> {
    const res = await pool.query(
      `
      UPDATE saved_jobs
      SET status = $3, updated_at = now()
      WHERE id = $1 AND user_id = $2
      RETURNING *;
      `,
      [id, userId, status]
    );
    if (!res.rowCount || res.rowCount === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  async list(userId: string, filter?: { status?: JobStatus; limit?: number }): Promise<SavedJob[]> {
    let query = `SELECT * FROM saved_jobs WHERE user_id = $1`;
    const params: any[] = [userId];

    if (filter?.status) {
      params.push(filter.status);
      query += ` AND status = $${params.length}`;
    }

    query += ` ORDER BY created_at DESC`;

    if (filter?.limit) {
      params.push(filter.limit);
      query += ` LIMIT $${params.length}`;
    }

    const res = await pool.query(query, params);
    return res.rows.map((r) => this.mapRow(r));
  }

  async delete(id: number, userId: string): Promise<boolean> {
    const res = await pool.query(
      `DELETE FROM saved_jobs WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return Boolean(res.rowCount && res.rowCount > 0);
  }

  private mapRow(row: any): SavedJob {
    return {
      id: Number(row.id),
      user_id: String(row.user_id),
      type: row.type,
      job_title: row.job_title,
      company: row.company,
      apply_email: row.apply_email,
      required_subject: row.required_subject,
      required_instructions: row.required_instructions,
      form_link: row.form_link,
      form_questions: Array.isArray(row.form_questions) ? row.form_questions : [],
      deadline: row.deadline,
      summary: row.summary,
      status: row.status,
      raw_text: row.raw_text,
      source_telegram_message_id: row.source_telegram_message_id ? String(row.source_telegram_message_id) : null,
      source_telegram_chat_id: row.source_telegram_chat_id ? String(row.source_telegram_chat_id) : null,
      image_file_id: row.image_file_id,
      linked_task_id: row.linked_task_id ? String(row.linked_task_id) : null,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }
}

export const jobRepo = new PostgresJobRepository();
