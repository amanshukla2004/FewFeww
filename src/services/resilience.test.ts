import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { resilienceService } from './resilience.service.js';
import { userRepo } from '../db/user.repo.js';
import { taskService } from './task.service.js';
import { pool } from '../db/pool.js';

describe('Resilience Service, Safety Nets & Stuck Job Reaper', () => {
  const testUserId = 665544;
  let dbUserId: string;

  beforeEach(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'ResilienceUser', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUserId = user.id;
    resilienceService.resetRateLimit(String(testUserId));
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('enforces 30 messages / 10 min sliding window rate limit', () => {
    const uid = 'rate_test_user_1';
    resilienceService.resetRateLimit(uid);

    // Send 30 allowed messages
    for (let i = 0; i < 30; i++) {
      const status = resilienceService.checkRateLimit(uid);
      expect(status.isLimited).toBe(false);
    }

    // 31st message exceeds rate limit
    const exceeded = resilienceService.checkRateLimit(uid);
    expect(exceeded.isLimited).toBe(true);
    expect(exceeded.remaining).toBe(0);
    expect(exceeded.resetSeconds).toBeGreaterThan(0);

    // Resetting unblocks user
    resilienceService.resetRateLimit(uid);
    const afterReset = resilienceService.checkRateLimit(uid);
    expect(afterReset.isLimited).toBe(false);
  });

  it('transitions user status to BLOCKED and cancels reminders on HTTP 403', async () => {
    const task = await taskService.createTask({
      userId: dbUserId,
      title: 'Doomed task for blocked bot',
      dueLocal: '2026-11-28T10:00:00',
      timeIsExplicit: true,
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    // Reminders should be SCHEDULED
    const remBefore = await pool.query('SELECT status FROM reminders WHERE task_id = $1', [task.taskId]);
    expect(remBefore.rows[0].status).toBe('SCHEDULED');

    // Simulate 403 bot blocked handling
    await resilienceService.handleUserBlocked(dbUserId);

    // User status should now be BLOCKED
    const userCheck = await pool.query('SELECT status FROM users WHERE id = $1', [dbUserId]);
    expect(userCheck.rows[0].status).toBe('BLOCKED');

    // Reminders should now be CANCELLED
    const remAfter = await pool.query('SELECT status, last_error FROM reminders WHERE task_id = $1', [task.taskId]);
    expect(remAfter.rows[0].status).toBe('CANCELLED');
    expect(remAfter.rows[0].last_error).toBe('user_blocked');
  });

  it('reaps stuck reminders in SENDING status (locked_at > 5 min)', async () => {
    const task = await taskService.createTask({
      userId: dbUserId,
      title: 'Stuck reminder task',
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    // Insert reminder simulating worker crash in SENDING state 10 minutes ago
    const stuckRes = await pool.query(
      `
      INSERT INTO reminders (user_id, task_id, kind, nudge_stage, fire_at, status, locked_at)
      VALUES ($1, $2, 'USER', 0, now() - interval '15 minutes', 'SENDING', now() - interval '10 minutes')
      RETURNING id;
      `,
      [dbUserId, task.taskId]
    );
    const stuckId = String(stuckRes.rows[0].id);

    // Run reaper
    const reapedCount = await resilienceService.reapStuckReminders(5);
    expect(reapedCount).toBeGreaterThanOrEqual(1);

    // Verify row was recovered to SCHEDULED with locked_at NULL
    const check = await pool.query('SELECT status, locked_at FROM reminders WHERE id = $1', [stuckId]);
    expect(check.rows[0].status).toBe('SCHEDULED');
    expect(check.rows[0].locked_at).toBeNull();
  });

  it('reaps stuck inbox updates in PROCESSING status', async () => {
    const testUpdateId = 88997711;
    await pool.query('DELETE FROM inbox_updates WHERE update_id = $1', [testUpdateId]);

    // Insert update simulating node crash while processing
    await pool.query(
      `
      INSERT INTO inbox_updates (update_id, telegram_user_id, payload, status, received_at)
      VALUES ($1, $2, '{}'::jsonb, 'PROCESSING', now() - interval '10 minutes');
      `,
      [testUpdateId, testUserId]
    );

    const reapedCount = await resilienceService.reapStuckInboxUpdates(5);
    expect(reapedCount).toBeGreaterThanOrEqual(1);

    const check = await pool.query('SELECT status, attempts FROM inbox_updates WHERE update_id = $1', [testUpdateId]);
    expect(check.rows[0].status).toBe('PENDING');
    expect(check.rows[0].attempts).toBe(1);

    await pool.query('DELETE FROM inbox_updates WHERE update_id = $1', [testUpdateId]);
  });
});
