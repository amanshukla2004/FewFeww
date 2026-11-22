import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { reminderWorker } from './reminder.worker.js';
import { userRepo } from '../db/user.repo.js';
import { taskService } from './task.service.js';
import { nudgePolicy } from './nudge.policy.js';
import { pool } from '../db/pool.js';
import { DateTime } from 'luxon';

describe('Postgres Poller Scheduler (FOR UPDATE SKIP LOCKED)', () => {
  const testUserId = 551122;
  let dbUserId: string;

  beforeEach(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'WorkerUser', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUserId = user.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('guarantees zero duplicate claims across concurrent workers (FOR UPDATE SKIP LOCKED)', async () => {
    const task = await taskService.createTask({
      userId: dbUserId,
      title: 'Batch test task',
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    // Insert 20 due reminders
    const insertIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const res = await pool.query(
        `
        INSERT INTO reminders (user_id, task_id, kind, nudge_stage, fire_at, status)
        VALUES ($1, $2, 'USER', 0, now() - interval '1 minute', 'SCHEDULED')
        RETURNING id;
        `,
        [dbUserId, task.taskId]
      );
      insertIds.push(String(res.rows[0].id));
    }

    // Run 2 concurrent worker claims simultaneously
    const [batch1, batch2] = await Promise.all([
      reminderWorker.claimDueReminders(10),
      reminderWorker.claimDueReminders(10),
    ]);

    const ids1 = new Set(batch1.map((r) => r.id));
    const ids2 = new Set(batch2.map((r) => r.id));

    expect(batch1.length).toBe(10);
    expect(batch2.length).toBe(10);

    // Mutual exclusion check: Intersection must be empty!
    for (const id of ids1) {
      expect(ids2.has(id)).toBe(false);
    }

    // All claimed rows must now be in SENDING state
    for (const r of [...batch1, ...batch2]) {
      expect(r.status).toBe('SENDING');
    }
  });

  it('reaps stuck jobs (locked_at > 5 minutes) back to SCHEDULED', async () => {
    const task = await taskService.createTask({
      userId: dbUserId,
      title: 'Stuck reminder task',
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    const stuckRes = await pool.query(
      `
      INSERT INTO reminders (user_id, task_id, kind, nudge_stage, fire_at, status, locked_at)
      VALUES ($1, $2, 'USER', 0, now() - interval '10 minutes', 'SENDING', now() - interval '6 minutes')
      RETURNING id;
      `,
      [dbUserId, task.taskId]
    );
    const stuckId = String(stuckRes.rows[0].id);

    const reapedCount = await reminderWorker.reapStuckRows();
    expect(reapedCount).toBeGreaterThanOrEqual(1);

    const checkRes = await pool.query(`SELECT status, locked_at FROM reminders WHERE id = $1`, [stuckId]);
    expect(checkRes.rows[0].status).toBe('SCHEDULED');
    expect(checkRes.rows[0].locked_at).toBeNull();
  });

  describe('NudgePolicy Quiet Hours', () => {
    it('allows explicit user reminders (stage 0) during quiet hours', async () => {
      const user = await userRepo.findById(dbUserId);
      const reminder = {
        id: '1',
        user_id: dbUserId,
        task_id: '1',
        kind: 'USER' as const,
        nudge_stage: 0,
        fire_at: new Date(),
        status: 'SCHEDULED',
        attempt_count: 0,
      };

      // 23:30 (inside quiet hours 22:00 to 07:00)
      const lateNight = DateTime.fromISO('2026-11-22T23:30:00', { zone: 'Asia/Kolkata' });
      const check = nudgePolicy.maySendNow(user!, reminder, lateNight);
      expect(check.allowed).toBe(true);
    });

    it('holds proactive nudges (stage > 0) during quiet hours until 07:00 AM', async () => {
      const user = await userRepo.findById(dbUserId);
      const nudge = {
        id: '2',
        user_id: dbUserId,
        task_id: '1',
        kind: 'NUDGE' as const,
        nudge_stage: 1,
        fire_at: new Date(),
        status: 'SCHEDULED',
        attempt_count: 0,
      };

      const lateNight = DateTime.fromISO('2026-11-22T23:30:00', { zone: 'Asia/Kolkata' });
      const check = nudgePolicy.maySendNow(user!, nudge, lateNight);

      expect(check.allowed).toBe(false);
      expect(check.nextAllowed).toBeDefined();
      expect(check.nextAllowed?.hour).toBe(7);
      expect(check.nextAllowed?.minute).toBe(0);
    });
  });
});
