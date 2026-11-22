import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { nudgeService } from './nudge.service.js';
import { userRepo } from '../db/user.repo.js';
import { taskService } from './task.service.js';
import { pool } from '../db/pool.js';

describe('5-Stage Nudge Ladder Service', () => {
  const testUserId = 332211;
  let dbUserId: string;

  beforeEach(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'NudgeUser', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUserId = user.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('schedules Stage 1 (+2h) following Stage 0 reminder', async () => {
    const task = await taskService.createTask({
      userId: dbUserId,
      title: 'Submit report',
      dueLocal: '2026-11-25T14:00:00',
      timeIsExplicit: true,
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    const remRes = await pool.query('SELECT * FROM reminders WHERE task_id = $1', [task.taskId]);
    const r0 = remRes.rows[0];

    await nudgeService.scheduleNextStage({
      id: String(r0.id),
      user_id: dbUserId,
      task_id: String(task.taskId),
      kind: 'USER',
      nudge_stage: 0,
      fire_at: r0.fire_at,
      status: 'SENT',
      attempt_count: 0,
    });

    const nextRem = await pool.query(
      `SELECT * FROM reminders WHERE task_id = $1 AND nudge_stage = 1 AND status = 'SCHEDULED'`,
      [task.taskId]
    );

    expect(nextRem.rowCount).toBe(1);
    const fireAt = new Date(nextRem.rows[0].fire_at).getTime();
    expect(fireAt).toBeGreaterThan(Date.now() + 1.9 * 60 * 60 * 1000);
    expect(fireAt).toBeLessThan(Date.now() + 2.1 * 60 * 60 * 1000);
  });

  it('detects anti-annoyance circuit breaker condition when 3 nudges ignored', async () => {
    const task = await taskService.createTask({
      userId: dbUserId,
      title: 'Ignored task',
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    // Insert 3 ignored nudges (status SENT, acked_at NULL)
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `
        INSERT INTO reminders (user_id, task_id, kind, nudge_stage, fire_at, status, sent_at)
        VALUES ($1, $2, 'NUDGE', $3, now() - interval '2 hours', 'SENT', now() - interval '1 hour')
        `,
        [dbUserId, task.taskId, i + 1]
      );
    }

    const shouldTrigger = await nudgeService.shouldTriggerCircuitBreaker(dbUserId);
    expect(shouldTrigger).toBe(true);

    const circuitMsg = nudgeService.getCircuitBreakerMessage();
    expect(circuitMsg.text).toContain('Notice:');
    expect(circuitMsg.keyboard[0][0].callback_data).toBe('pause:3');
  });

  it('cancels scheduled reminders when task is marked complete or dropped', async () => {
    const task = await taskService.createTask({
      userId: dbUserId,
      title: 'Task to cancel',
      dueLocal: '2026-11-26T10:00:00',
      timeIsExplicit: true,
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    await nudgeService.cancelTaskReminders(String(task.taskId));

    const check = await pool.query('SELECT status FROM reminders WHERE task_id = $1', [task.taskId]);
    expect(check.rows[0].status).toBe('CANCELLED');
  });
});
