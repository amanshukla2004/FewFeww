import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { pool } from '../db/pool.js';
import { userRepo } from '../db/user.repo.js';
import { taskService } from './task.service.js';
import { ReminderWorker } from './reminder.worker.js';
import { callbackRouter } from './callback.router.js';
import { UpdateDispatcher } from './dispatcher.js';
import { TelegramClient } from './telegram.client.js';
import { DateTime } from 'luxon';

describe('Call-Style & High-Priority Ring Alerts - Step 36', () => {
  const testUserId = 554433;
  let dbUser: any;
  let mockTg: TelegramClient;
  let dispatcher: UpdateDispatcher;
  let worker: ReminderWorker;

  beforeEach(async () => {
    mockTg = {
      sendMessage: vi.fn().mockResolvedValue({ ok: true, result: { message_id: 404 } }),
      editMessageText: vi.fn().mockResolvedValue({ ok: true }),
      answerCallbackQuery: vi.fn().mockResolvedValue({ ok: true }),
      sendChatAction: vi.fn().mockResolvedValue({ ok: true }),
      downloadFile: vi.fn().mockResolvedValue(Buffer.from('mock')),
    } as unknown as TelegramClient;

    dispatcher = new UpdateDispatcher(mockTg);
    worker = new ReminderWorker(mockTg);

    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'CallAlertTester', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUser = (await userRepo.findByTelegramId(testUserId))!;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('schedules a call-style reminder with kind = CALL and distinct ring confirmation', async () => {
    const tomorrowLocal = DateTime.now().setZone(dbUser.timezone).plus({ days: 1 }).set({ hour: 6, minute: 0 }).toISO();

    const res = await taskService.createTask({
      userId: dbUser.id,
      title: 'Wake up for early flight',
      dueLocal: tomorrowLocal,
      timeIsExplicit: true,
      userTimezone: dbUser.timezone,
      callAlert: true,
    });

    expect(res.text).toContain('Call-Style Ring Alert Scheduled');
    expect(res.text).toContain('Wake up for early flight');

    // Verify reminder row created with kind = 'CALL'
    const remRes = await pool.query('SELECT kind, status FROM reminders WHERE task_id = $1', [res.taskId]);
    expect(remRes.rowCount).toBe(1);
    expect(remRes.rows[0].kind).toBe('CALL');
    expect(remRes.rows[0].status).toBe('SCHEDULED');
  });

  it('delivers loud call ring notification and handles 10-minute snooze via callback', async () => {
    // 1. Create a due call reminder
    const duePast = new Date(Date.now() - 5000);
    const taskRes = await pool.query(
      `INSERT INTO tasks (user_id, title, status, due_at) VALUES ($1, 'Take blood pressure medication', 'OPEN', $2) RETURNING id`,
      [dbUser.id, duePast]
    );
    const taskId = taskRes.rows[0].id;

    const remRes = await pool.query(
      `INSERT INTO reminders (user_id, task_id, kind, nudge_stage, fire_at, status) VALUES ($1, $2, 'CALL', 0, $3, 'SCHEDULED') RETURNING id`,
      [dbUser.id, taskId, duePast]
    );
    const reminderId = remRes.rows[0].id;

    // 2. Worker tick processes the call reminder
    await worker.tick();

    // Verify message sent with CALL-ALERT formatting
    expect(mockTg.sendMessage).toHaveBeenCalledWith(
      dbUser.telegram_chat_id,
      expect.stringContaining('INCOMING CALL-ALERT RING'),
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({ text: '📞 Answer / Done', callback_data: `r:done:${reminderId}` }),
          expect.objectContaining({ text: '💤 Snooze 10m', callback_data: `r:snz10:${reminderId}` }),
        ]),
      ])
    );

    // 3. Simulate user clicking "Snooze 10m"
    const cq = {
      id: 'cq_99',
      from: { id: testUserId, first_name: 'CallAlertTester' },
      message: { message_id: 404, chat: { id: testUserId } },
      data: `r:snz10:${reminderId}`,
    };

    const cbRouter = new (callbackRouter.constructor as any)(mockTg);
    await cbRouter.handleCallback(cq);

    // Verify reminder snoozed as CALL kind with future fire_at
    const snoozedRem = await pool.query(
      `SELECT kind, status, fire_at FROM reminders WHERE task_id = $1 AND status = 'SCHEDULED'`,
      [taskId]
    );
    expect(snoozedRem.rowCount).toBe(1);
    expect(snoozedRem.rows[0].kind).toBe('CALL');
    expect(new Date(snoozedRem.rows[0].fire_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('dispatches create_reminder with call_alert = true via dispatcher', async () => {
    const dueLocal = DateTime.now().setZone(dbUser.timezone).plus({ hours: 1 }).toISO();

    await (dispatcher as any).executeToolCall(
      dbUser,
      dbUser.telegram_chat_id,
      {
        name: 'create_reminder',
        args: {
          text: 'Ring me to turn off stove',
          remind_local: dueLocal,
          time_is_explicit: true,
          call_alert: true,
        },
      }
    );

    const call = vi.mocked(mockTg.sendMessage).mock.calls[0];
    expect(call[0]).toBe(dbUser.telegram_chat_id);
    expect(call[1]).toContain('Call-Style Ring Alert Scheduled');
  });
});
