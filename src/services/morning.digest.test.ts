import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import { MorningDigest } from './morning.digest.js';
import { TelegramClient } from './telegram.client.js';
import { taskService } from './task.service.js';
import { userRepo } from '../db/user.repo.js';
import { pool } from '../db/pool.js';
import { DateTime } from 'luxon';

describe('Morning Plan Digest Service (Stage 2 Nudge Ladder)', () => {
  const testUserId = 881122;
  let dbUser: any;
  let mockTg: TelegramClient;
  let digest: MorningDigest;

  beforeEach(async () => {
    mockTg = {
      sendMessage: vi.fn().mockResolvedValue({ ok: true, result: { message_id: 888 } }),
      editMessageText: vi.fn().mockResolvedValue({ ok: true }),
      answerCallbackQuery: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as TelegramClient;
    digest = new MorningDigest(mockTg);

    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'MorningUser', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUser = (await userRepo.findByTelegramId(testUserId))!;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('includes overdue tasks in morning plan under Overdue Items (Stage 2)', async () => {
    // 1. Overdue task
    const overdueDue = DateTime.now().minus({ days: 1 }).toJSDate();
    await pool.query(
      `
      INSERT INTO tasks (user_id, title, status, due_at)
      VALUES ($1, 'Overdue DBMS viva project', 'OPEN', $2)
      `,
      [dbUser.id, overdueDue]
    );

    // 2. Today's task (ensure future time on today so it falls under Today's Agenda)
    const todayDue = DateTime.now().setZone(dbUser.timezone).plus({ hours: 2 }).toJSDate();
    await pool.query(
      `
      INSERT INTO tasks (user_id, title, status, due_at, due_has_time)
      VALUES ($1, 'Team sync call', 'OPEN', $2, true)
      `,
      [dbUser.id, todayDue]
    );

    const summary = await digest.buildTodaySummary(dbUser);

    expect(summary).toContain('Overdue Items');
    expect(summary).toContain('Overdue DBMS viva project');
    expect(summary).toContain("Today's Agenda");
    expect(summary).toContain('Team sync call');
  });

  it('generates upcoming 7-day schedule with buildUpcomingList', async () => {
    await taskService.createTask({
      userId: dbUser.id,
      title: 'Review pull requests',
      dueLocal: '2026-11-29T11:00:00',
      timeIsExplicit: true,
      userTimezone: dbUser.timezone,
      defaultReminderTime: '09:00',
    });

    const listText = await digest.buildUpcomingList(dbUser);
    expect(listText).toContain('Review pull requests');
    expect(listText).toContain('Your Open Tasks');
  });

  it('sends morning digest and updates last_morning_plan_on in database', async () => {
    // Simulate user needing morning plan right now (passed morning_plan_time within 3 hours)
    await pool.query(
      `
      UPDATE users
      SET morning_plan_enabled = true,
          morning_plan_time = ((now() AT TIME ZONE timezone) - interval '10 minutes')::time,
          last_morning_plan_on = NULL
      WHERE id = $1
      `,
      [dbUser.id]
    );

    const count = await digest.checkAndSendDigests();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(mockTg.sendMessage).toHaveBeenCalled();

    const userCheck = await pool.query('SELECT last_morning_plan_on FROM users WHERE id = $1', [dbUser.id]);
    expect(userCheck.rows[0].last_morning_plan_on).not.toBeNull();
  });
});
