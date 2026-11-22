import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { pool } from '../db/pool.js';
import { userRepo } from '../db/user.repo.js';
import { dailySummaryService } from './daily.summary.service.js';
import { UpdateDispatcher } from './dispatcher.js';
import { TelegramClient } from './telegram.client.js';
import { DateTime } from 'luxon';

describe('Daily Summaries Management - Step 33', () => {
  const testUserId = 998822;
  let dbUser: any;
  let mockTg: TelegramClient;
  let dispatcher: UpdateDispatcher;

  beforeEach(async () => {
    mockTg = {
      sendMessage: vi.fn().mockResolvedValue({ ok: true, result: { message_id: 101 } }),
      editMessageText: vi.fn().mockResolvedValue({ ok: true }),
      answerCallbackQuery: vi.fn().mockResolvedValue({ ok: true }),
      sendChatAction: vi.fn().mockResolvedValue({ ok: true }),
      downloadFile: vi.fn().mockResolvedValue(Buffer.from('mock')),
    } as unknown as TelegramClient;

    dispatcher = new UpdateDispatcher(mockTg);

    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'SummaryTester', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUser = (await userRepo.findByTelegramId(testUserId))!;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('configures daily summary settings (enable/disable and time adjustments)', async () => {
    // 1. Disable summary
    const resOff = await dailySummaryService.configure(dbUser.id, {
      enabled: false,
    });
    expect(resOff.formattedText).toContain('Disabled');
    expect(resOff.user.morning_plan_enabled).toBe(false);

    // 2. Change summary time to 8 PM (20:00) and enable
    const resOn = await dailySummaryService.configure(dbUser.id, {
      enabled: true,
      eveningTime: '20:00',
      summaryType: 'EVENING',
    });
    expect(resOn.formattedText).toContain('Enabled');
    expect(resOn.formattedText).toContain('20:00');
    expect(resOn.user.evening_checkin_enabled).toBe(true);
  });

  it('builds comprehensive summary incorporating tasks, habits, and calendar meetings', async () => {
    const nowLocal = DateTime.now().setZone(dbUser.timezone);

    // 1. Overdue task
    await pool.query(
      `INSERT INTO tasks (user_id, title, status, due_at) VALUES ($1, 'Old Tax Filing', 'OPEN', now() - interval '2 days')`,
      [dbUser.id]
    );

    // 2. Today's task
    const todayDue = nowLocal.plus({ hours: 2 }).toJSDate();
    await pool.query(
      `INSERT INTO tasks (user_id, title, status, due_at, due_has_time) VALUES ($1, 'DSA Array Questions', 'OPEN', $2, true)`,
      [dbUser.id, todayDue]
    );

    // 3. Completed task
    await pool.query(
      `INSERT INTO tasks (user_id, title, status, completed_at) VALUES ($1, 'Drink morning matcha', 'COMPLETED', now())`,
      [dbUser.id]
    );

    // 4. Logged habit (Weight)
    const habitRes = await pool.query(
      `INSERT INTO habits (user_id, name, kind, unit) VALUES ($1, 'Weight', 'METRIC', 'kg') RETURNING id`,
      [dbUser.id]
    );
    await pool.query(
      `INSERT INTO habit_logs (user_id, habit_id, value, logged_at) VALUES ($1, $2, 88.5, now())`,
      [dbUser.id, habitRes.rows[0].id]
    );

    // 5. Calendar event
    await pool.query(
      `INSERT INTO calendar_events (user_id, title, start_time, end_time, provider) VALUES ($1, 'Team Standup Sync', now(), now() + interval '30 mins', 'GOOGLE')`,
      [dbUser.id]
    );

    const summary = await dailySummaryService.buildSummary(dbUser, 'INSTANT');

    expect(summary).toContain('Old Tax Filing');
    expect(summary).toContain('DSA Array Questions');
    expect(summary).toContain('Drink morning matcha');
    expect(summary).toContain('Weight');
    expect(summary).toContain('88.5 kg');
    expect(summary).toContain('Team Standup Sync');
  });

  it('dispatches configure_daily_summary and view_daily_summary tools via dispatcher', async () => {
    // 1. Dispatch configure_daily_summary
    await (dispatcher as any).executeToolCall(
      dbUser,
      dbUser.telegram_chat_id,
      {
        name: 'configure_daily_summary',
        args: {
          enabled: true,
          morning_time: '07:30',
          summary_type: 'MORNING',
        },
      }
    );

    const call1 = vi.mocked(mockTg.sendMessage).mock.calls[0];
    expect(call1[0]).toBe(dbUser.telegram_chat_id);
    expect(call1[1]).toContain('07:30');

    // 2. Dispatch view_daily_summary
    await (dispatcher as any).executeToolCall(
      dbUser,
      dbUser.telegram_chat_id,
      {
        name: 'view_daily_summary',
        args: { mode: 'INSTANT' },
      }
    );

    const call2 = vi.mocked(mockTg.sendMessage).mock.calls[1];
    expect(call2[0]).toBe(dbUser.telegram_chat_id);
    expect(call2[1]).toContain('Daily Summary');
  });
});
