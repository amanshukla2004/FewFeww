import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import { PrivacyService } from './privacy.service.js';
import { TelegramClient } from './telegram.client.js';
import { taskService } from './task.service.js';
import { userRepo } from '../db/user.repo.js';
import { pool } from '../db/pool.js';

describe('Privacy Service & DPDP Compliance (/export & /deleteme)', () => {
  const testUserId = 998877;
  let dbUserId: string;
  let mockTg: TelegramClient;
  let privacy: PrivacyService;

  beforeEach(async () => {
    mockTg = {
      sendMessage: vi.fn().mockResolvedValue({ ok: true }),
      editMessageText: vi.fn().mockResolvedValue({ ok: true }),
      answerCallbackQuery: vi.fn().mockResolvedValue({ ok: true }),
      sendDocument: vi.fn().mockResolvedValue({ ok: true, result: { message_id: 999 } }),
    } as unknown as TelegramClient;
    privacy = new PrivacyService(mockTg);

    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'PrivacyUser', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUserId = user.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('compiles user data into structured JSON export payload', async () => {
    // Insert a task
    await taskService.createTask({
      userId: dbUserId,
      title: 'Submit GST declaration form',
      details: 'Quarterly tax filing',
      dueLocal: '2026-11-28T18:00:00',
      timeIsExplicit: true,
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    // Insert a note
    await taskService.saveNote(dbUserId, 'Tax portal login credentials and passkeys', 'Tax Passwords');

    const payload = await privacy.getUserExportPayload(dbUserId);

    expect(payload.user.telegram_user_id).toBe(String(testUserId));
    expect(payload.tasks.length).toBe(1);
    expect(payload.tasks[0].title).toBe('Submit GST declaration form');
    expect(payload.notes.length).toBe(1);
    expect(payload.notes[0].title).toBe('Tax Passwords');
    expect(payload.reminders.length).toBeGreaterThanOrEqual(1);
  });

  it('generates compliant CSV formatted output for tasks', () => {
    const sampleTasks = [
      {
        id: '101',
        title: 'Meeting with Dr. Sharma, HOD',
        details: 'Bring "report.pdf" and syllabus',
        status: 'OPEN',
        due_at: new Date('2026-11-28T12:00:00Z'),
        created_at: new Date('2026-11-20T10:00:00Z'),
        completed_at: null,
      },
    ];

    const csv = privacy.generateTasksCsv(sampleTasks);

    expect(csv).toContain('ID,Title,Details,Status,Due Date (UTC),Created At (UTC),Completed At (UTC)');
    expect(csv).toContain('"Meeting with Dr. Sharma, HOD"');
    expect(csv).toContain('"Bring ""report.pdf"" and syllabus"');
  });

  it('uploads JSON and CSV export documents to user via Telegram sendDocument', async () => {
    const user = (await userRepo.findByTelegramId(testUserId))!;
    await privacy.exportAndSend(user, testUserId);

    expect(mockTg.sendDocument).toHaveBeenCalledTimes(2);

    // Verify first call is JSON
    const call1 = (mockTg.sendDocument as any).mock.calls[0];
    expect(call1[2]).toContain('.json');

    // Verify second call is CSV
    const call2 = (mockTg.sendDocument as any).mock.calls[1];
    expect(call2[2]).toContain('.csv');
  });

  it('cascades hard delete across users, tasks, notes, reminders, and messages on /deleteme', async () => {
    await taskService.createTask({
      userId: dbUserId,
      title: 'Doomed task for deletion',
      dueLocal: '2026-11-27T10:00:00',
      timeIsExplicit: true,
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    await taskService.saveNote(dbUserId, 'Secret note to be wiped', 'Top Secret');

    // Assert rows exist prior to deletion
    const taskBefore = await pool.query('SELECT count(*)::int AS count FROM tasks WHERE user_id = $1', [dbUserId]);
    expect(taskBefore.rows[0].count).toBe(1);

    const noteBefore = await pool.query('SELECT count(*)::int AS count FROM notes WHERE user_id = $1', [dbUserId]);
    expect(noteBefore.rows[0].count).toBe(1);

    const remBefore = await pool.query('SELECT count(*)::int AS count FROM reminders WHERE user_id = $1', [dbUserId]);
    expect(remBefore.rows[0].count).toBeGreaterThanOrEqual(1);

    // Execute hard delete
    const success = await privacy.deleteUserCascade(dbUserId);
    expect(success).toBe(true);

    // Verify cascading deletion across all foreign key tables
    const userAfter = await pool.query('SELECT count(*)::int AS count FROM users WHERE id = $1', [dbUserId]);
    expect(userAfter.rows[0].count).toBe(0);

    const taskAfter = await pool.query('SELECT count(*)::int AS count FROM tasks WHERE user_id = $1', [dbUserId]);
    expect(taskAfter.rows[0].count).toBe(0);

    const noteAfter = await pool.query('SELECT count(*)::int AS count FROM notes WHERE user_id = $1', [dbUserId]);
    expect(noteAfter.rows[0].count).toBe(0);

    const remAfter = await pool.query('SELECT count(*)::int AS count FROM reminders WHERE user_id = $1', [dbUserId]);
    expect(remAfter.rows[0].count).toBe(0);
  });
});
