import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import { CallbackRouter } from './callback.router.js';
import { TelegramClient } from './telegram.client.js';
import { userRepo } from '../db/user.repo.js';
import { taskService } from './task.service.js';
import { pool } from '../db/pool.js';

describe('Inline Callback Router & 5-Stage Nudge Actions', () => {
  const testUserId = 441122;
  let dbUserId: string;
  let mockTg: TelegramClient;
  let router: CallbackRouter;

  beforeEach(async () => {
    mockTg = {
      sendMessage: vi.fn().mockResolvedValue({ ok: true }),
      editMessageText: vi.fn().mockResolvedValue({ ok: true }),
      answerCallbackQuery: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as TelegramClient;
    router = new CallbackRouter(mockTg);

    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'CallbackUser', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUserId = user.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('marks task DONE when r:done is tapped', async () => {
    const task = await taskService.createTask({
      userId: dbUserId,
      title: 'Lab practical submission',
      dueLocal: '2026-11-30T10:00:00',
      timeIsExplicit: true,
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    const remRes = await pool.query('SELECT id FROM reminders WHERE task_id = $1', [task.taskId]);
    const reminderId = String(remRes.rows[0].id);

    // Simulate callback_query from Telegram
    await router.handleCallback({
      id: 'cq_001',
      from: { id: testUserId, first_name: 'CallbackUser' },
      message: { message_id: 501, chat: { id: testUserId } },
      data: `r:done:${reminderId}`,
    });

    // Check task status
    const taskCheck = await pool.query('SELECT status, completed_at FROM tasks WHERE id = $1', [task.taskId]);
    expect(taskCheck.rows[0].status).toBe('DONE');
    expect(taskCheck.rows[0].completed_at).not.toBeNull();

    // Check reminder status
    const remCheck = await pool.query('SELECT status, ack_action FROM reminders WHERE id = $1', [reminderId]);
    expect(remCheck.rows[0].status).toBe('ACKED');
    expect(remCheck.rows[0].ack_action).toBe('DONE');

    expect(mockTg.editMessageText).toHaveBeenCalledWith(
      testUserId,
      501,
      expect.stringContaining('Marked Done')
    );
  });

  it('snoozes reminder by 1 hour when r:snz1 is tapped', async () => {
    const task = await taskService.createTask({
      userId: dbUserId,
      title: 'Call team lead',
      dueLocal: '2026-11-25T11:00:00',
      timeIsExplicit: true,
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    const remRes = await pool.query('SELECT id FROM reminders WHERE task_id = $1', [task.taskId]);
    const reminderId = String(remRes.rows[0].id);

    await router.handleCallback({
      id: 'cq_002',
      from: { id: testUserId, first_name: 'CallbackUser' },
      message: { message_id: 502, chat: { id: testUserId } },
      data: `r:snz1:${reminderId}`,
    });

    // Old reminder ACKED
    const oldRem = await pool.query('SELECT status, ack_action FROM reminders WHERE id = $1', [reminderId]);
    expect(oldRem.rows[0].status).toBe('ACKED');
    expect(oldRem.rows[0].ack_action).toBe('SNOOZE_1H');

    // New reminder scheduled ~1 hour from now
    const newRem = await pool.query(
      `SELECT * FROM reminders WHERE task_id = $1 AND status = 'SCHEDULED' ORDER BY fire_at DESC LIMIT 1`,
      [task.taskId]
    );
    expect(newRem.rowCount).toBe(1);
    expect(new Date(newRem.rows[0].fire_at).getTime()).toBeGreaterThan(Date.now() + 50 * 60 * 1000);

    expect(mockTg.editMessageText).toHaveBeenCalledWith(
      testUserId,
      502,
      expect.stringContaining('Snoozed for 1 hour')
    );
  });

  it('reschedules for tomorrow when r:tom is tapped', async () => {
    const task = await taskService.createTask({
      userId: dbUserId,
      title: 'Read paper',
      dueLocal: '2026-11-24T10:00:00',
      timeIsExplicit: true,
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    const remRes = await pool.query('SELECT id FROM reminders WHERE task_id = $1', [task.taskId]);
    const reminderId = String(remRes.rows[0].id);

    await router.handleCallback({
      id: 'cq_003',
      from: { id: testUserId, first_name: 'CallbackUser' },
      message: { message_id: 503, chat: { id: testUserId } },
      data: `r:tom:${reminderId}`,
    });

    const taskCheck = await pool.query('SELECT due_at FROM tasks WHERE id = $1', [task.taskId]);
    expect(taskCheck.rows[0].due_at).not.toBeNull();
    expect(mockTg.editMessageText).toHaveBeenCalledWith(
      testUserId,
      503,
      expect.stringContaining('Rescheduled for tomorrow')
    );
  });

  it('drops task when r:drop is tapped', async () => {
    const task = await taskService.createTask({
      userId: dbUserId,
      title: 'Obsolete task',
      dueLocal: '2026-11-28T10:00:00',
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    const remRes = await pool.query('SELECT id FROM reminders WHERE task_id = $1', [task.taskId]);
    const reminderId = String(remRes.rows[0].id);

    await router.handleCallback({
      id: 'cq_004',
      from: { id: testUserId, first_name: 'CallbackUser' },
      message: { message_id: 504, chat: { id: testUserId } },
      data: `r:drop:${reminderId}`,
    });

    const taskCheck = await pool.query('SELECT status FROM tasks WHERE id = $1', [task.taskId]);
    expect(taskCheck.rows[0].status).toBe('DROPPED');
    expect(mockTg.editMessageText).toHaveBeenCalledWith(
      testUserId,
      504,
      expect.stringContaining('Dropped task')
    );
  });

  it('pauses proactive nudges when pause:3 is tapped', async () => {
    await router.handleCallback({
      id: 'cq_005',
      from: { id: testUserId, first_name: 'CallbackUser' },
      message: { message_id: 505, chat: { id: testUserId } },
      data: 'pause:3',
    });

    const userCheck = await pool.query('SELECT nudges_paused_until FROM users WHERE id = $1', [dbUserId]);
    expect(userCheck.rows[0].nudges_paused_until).not.toBeNull();
    const pauseTime = new Date(userCheck.rows[0].nudges_paused_until).getTime();
    expect(pauseTime).toBeGreaterThan(Date.now() + 2 * 24 * 60 * 60 * 1000);
    expect(mockTg.editMessageText).toHaveBeenCalledWith(
      testUserId,
      505,
      expect.stringContaining('Follow-up nudges paused for <b>3 days</b>')
    );
  });
});
