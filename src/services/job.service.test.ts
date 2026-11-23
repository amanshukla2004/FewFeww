import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { JobExtractionZodSchema } from './job.types.js';
import { PostgresJobRepository, SavedJob } from '../db/job.repo.js';
import { JobService } from './job.service.js';
import { userRepo } from '../db/user.repo.js';
import { pool } from '../db/pool.js';
import { TelegramClient } from './telegram.client.js';
import { CommandRouter } from './command.router.js';
import { CallbackRouter } from './callback.router.js';

describe('Quick Save Job Feature', () => {
  const testUserId = 889911;
  let dbUserId: string;
  let jobRepo: PostgresJobRepository;
  let jobService: JobService;
  let mockTg: TelegramClient;
  let commandRouter: CommandRouter;
  let callbackRouter: CallbackRouter;

  beforeEach(async () => {
    jobRepo = new PostgresJobRepository();

    mockTg = {
      sendMessage: vi.fn().mockResolvedValue({ ok: true, result: { message_id: 999 } }),
      editMessageText: vi.fn().mockResolvedValue({ ok: true }),
      answerCallbackQuery: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as TelegramClient;

    jobService = new JobService(jobRepo, undefined, undefined, 'mock-key');
    commandRouter = new CommandRouter();
    callbackRouter = new CallbackRouter(mockTg);

    // Clean user and jobs
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'JobTester', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUserId = user.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
  });

  describe('1. Zod Schema Validation & Extraction Rules', () => {
    it('validates a complete, structured job extraction correctly', () => {
      const mockLlmOutput = {
        type: 'email',
        jobTitle: 'Senior Backend Engineer',
        company: 'Stripe',
        applyEmail: 'jobs@stripe.com',
        requiredSubject: 'Senior Backend Engineer - Referral',
        requiredInstructions: 'Attach resume and specify years of Go experience.',
        formLink: null,
        formQuestions: [],
        deadline: '15 Dec 2026',
        summary: 'Senior Go role. Email resume with specific subject.',
        status: 'to-apply',
      };

      const parsed = JobExtractionZodSchema.parse(mockLlmOutput);
      expect(parsed.type).toBe('email');
      expect(parsed.applyEmail).toBe('jobs@stripe.com');
      expect(parsed.requiredSubject).toBe('Senior Backend Engineer - Referral');
      expect(parsed.status).toBe('to-apply');
    });

    it('defaults missing optional fields to null or empty arrays without hallucinating', () => {
      const minimalOutput = {
        type: 'form',
        formLink: 'https://forms.gle/abc123xyz',
      };

      const parsed = JobExtractionZodSchema.parse(minimalOutput);
      expect(parsed.type).toBe('form');
      expect(parsed.formLink).toBe('https://forms.gle/abc123xyz');
      expect(parsed.jobTitle).toBeNull();
      expect(parsed.applyEmail).toBeNull();
      expect(parsed.formQuestions).toEqual([]);
      expect(parsed.status).toBe('to-apply');
    });

    it('rejects invalid job types and catches errors', () => {
      const invalidOutput = {
        type: 'invalid-type-xyz',
      };

      expect(() => JobExtractionZodSchema.parse(invalidOutput)).toThrow();
    });
  });

  describe('2. JobRepository (CRUD & Integrity)', () => {
    it('creates and stores 100% untouched raw_text with all fields', async () => {
      const rawText =
        'Hiring: React Frontend Dev at Acme Corp! Send your CV to careers@acmewidgets.com with subject Application - React Dev. Deadline: 30 Nov.';

      const created = await jobRepo.create({
        userId: dbUserId,
        rawText,
        type: 'email',
        jobTitle: 'React Frontend Dev',
        company: 'Acme Corp',
        applyEmail: 'careers@acmewidgets.com',
        requiredSubject: 'Application - React Dev',
        requiredInstructions: 'Send your CV',
        deadline: '30 Nov',
        status: 'to-apply',
      });

      expect(created.id).toBeDefined();
      expect(created.raw_text).toBe(rawText);
      expect(created.apply_email).toBe('careers@acmewidgets.com');
      expect(created.required_subject).toBe('Application - React Dev');
      expect(created.status).toBe('to-apply');

      const fetched = await jobRepo.findById(created.id, dbUserId);
      expect(fetched).not.toBeNull();
      expect(fetched?.raw_text).toBe(rawText);
    });

    it('updates specific fields via updateField for /edit command', async () => {
      const created = await jobRepo.create({
        userId: dbUserId,
        rawText: 'Some raw post',
        requiredSubject: 'Old Subject',
      });

      const updated = await jobRepo.updateField(created.id, dbUserId, 'subject', 'New Subject Here');
      expect(updated?.required_subject).toBe('New Subject Here');

      const updatedEmail = await jobRepo.updateField(created.id, dbUserId, 'email', 'newhr@company.com');
      expect(updatedEmail?.apply_email).toBe('newhr@company.com');
    });

    it('sets status to applied and filters in list query', async () => {
      const job1 = await jobRepo.create({
        userId: dbUserId,
        rawText: 'Job 1',
        status: 'to-apply',
      });
      const job2 = await jobRepo.create({
        userId: dbUserId,
        rawText: 'Job 2',
        status: 'to-apply',
      });

      await jobRepo.setStatus(job1.id, dbUserId, 'applied');

      const todoJobs = await jobRepo.list(dbUserId, { status: 'to-apply' });
      expect(todoJobs.some((j) => j.id === job1.id)).toBe(false);
      expect(todoJobs.some((j) => j.id === job2.id)).toBe(true);

      const allJobs = await jobRepo.list(dbUserId);
      expect(allJobs.length).toBeGreaterThanOrEqual(2);
    });

    it('deletes a job entry permanently', async () => {
      const job = await jobRepo.create({
        userId: dbUserId,
        rawText: 'Job to delete',
      });

      const deleted = await jobRepo.delete(job.id, dbUserId);
      expect(deleted).toBe(true);

      const fetched = await jobRepo.findById(job.id, dbUserId);
      expect(fetched).toBeNull();
    });
  });

  describe('3. Idempotency & Duplicate Handling', () => {
    it('returns isDuplicate: true and existing job when saving from same message_id and chat_id', async () => {
      const rawText = 'Forwarded job posting from Telegram';
      const sourceChatId = 123456;
      const sourceMsgId = 5544;

      const firstSave = await jobService.saveJobImmediate({
        userId: dbUserId,
        rawText,
        chatId: sourceChatId,
        messageId: sourceMsgId,
      });

      expect(firstSave.isDuplicate).toBe(false);
      expect(firstSave.job.id).toBeDefined();

      const secondSave = await jobService.saveJobImmediate({
        userId: dbUserId,
        rawText,
        chatId: sourceChatId,
        messageId: sourceMsgId,
      });

      expect(secondSave.isDuplicate).toBe(true);
      expect(secondSave.job.id).toBe(firstSave.job.id);

      // Verify only 1 entry in DB
      const list = await jobRepo.list(dbUserId);
      const matching = list.filter(
        (j) => j.source_telegram_chat_id === String(sourceChatId) && j.source_telegram_message_id === String(sourceMsgId)
      );
      expect(matching.length).toBe(1);
    });
  });

  describe('4. Bot Commands & Callback Routing', () => {
    it('handles /job <text> command by saving immediately and notifying user', async () => {
      const user = await userRepo.findById(dbUserId);
      expect(user).not.toBeNull();

      const cmdText = '/job We are hiring a Fullstack Dev! Send resume to hr@devs.io with subject Application: Fullstack';
      const response = await commandRouter.handleCommand(user!, cmdText);

      expect(response.text).toContain('saved, processing');

      const jobs = await jobRepo.list(dbUserId);
      expect(jobs.length).toBeGreaterThanOrEqual(1);
      expect(jobs[0].raw_text).toContain('We are hiring a Fullstack Dev');
    });

    it('handles /jobs todo command returning only pending applications', async () => {
      const user = await userRepo.findById(dbUserId);
      const job = await jobRepo.create({
        userId: dbUserId,
        rawText: 'Dev role at Google',
        jobTitle: 'SWE',
        company: 'Google',
        status: 'to-apply',
      });

      const response = await commandRouter.handleCommand(user!, '/jobs todo');
      expect(response.text).toContain('Google');
      expect(response.text).toContain(`#${job.id}`);
    });

    it('handles /applied <id> and marks the job as applied', async () => {
      const user = await userRepo.findById(dbUserId);
      const job = await jobRepo.create({
        userId: dbUserId,
        rawText: 'Job post',
        jobTitle: 'Designer',
        company: 'Figma',
        status: 'to-apply',
      });

      const response = await commandRouter.handleCommand(user!, `/applied ${job.id}`);
      expect(response.text).toContain('APPLIED');

      const fetched = await jobRepo.findById(job.id, dbUserId);
      expect(fetched?.status).toBe('applied');
    });

    it('handles /edit <id> <field> <value> updating exact fields', async () => {
      const user = await userRepo.findById(dbUserId);
      const job = await jobRepo.create({
        userId: dbUserId,
        rawText: 'Raw post',
        requiredSubject: 'Old Subject',
      });

      const response = await commandRouter.handleCommand(user!, `/edit ${job.id} subject Application - Senior Dev`);
      expect(response.text).toContain('Application - Senior Dev');

      const fetched = await jobRepo.findById(job.id, dbUserId);
      expect(fetched?.required_subject).toBe('Application - Senior Dev');
    });

    it('handles callback job:orig:<id> and responds with original raw text', async () => {
      const rawOriginal = 'Exact original post with special characters & symbols <cool>';
      const job = await jobRepo.create({
        userId: dbUserId,
        rawText: rawOriginal,
      });

      await callbackRouter.handleCallback({
        id: 'cq_job_1',
        from: { id: testUserId, first_name: 'JobTester' },
        message: { message_id: 701, chat: { id: testUserId } },
        data: `job:orig:${job.id}`,
      });

      expect(mockTg.editMessageText).toHaveBeenCalledWith(
        testUserId,
        701,
        expect.stringContaining('Original Raw Text'),
        expect.any(Array)
      );
    });

    it('handles callback job:app:<id> toggling applied status', async () => {
      const job = await jobRepo.create({
        userId: dbUserId,
        rawText: 'Some job',
        jobTitle: 'Frontend Dev',
        status: 'to-apply',
      });

      await callbackRouter.handleCallback({
        id: 'cq_job_2',
        from: { id: testUserId, first_name: 'JobTester' },
        message: { message_id: 702, chat: { id: testUserId } },
        data: `job:app:${job.id}`,
      });

      const fetched = await jobRepo.findById(job.id, dbUserId);
      expect(fetched?.status).toBe('applied');
    });
  });
});
