import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import { UpdateDispatcher } from './dispatcher.js';
import { CallbackRouter } from './callback.router.js';
import { TelegramClient } from './telegram.client.js';
import { userRepo } from '../db/user.repo.js';
import { pool } from '../db/pool.js';

describe('Option A Clarification Loop & Open Task Fallback', () => {
  const testUserId = 776655;
  let dbUserId: string;
  let mockTg: TelegramClient;
  let dispatcher: UpdateDispatcher;
  let callbackRouter: CallbackRouter;

  beforeEach(async () => {
    mockTg = {
      sendMessage: vi.fn().mockResolvedValue({ ok: true, result: { message_id: 111 } }),
      editMessageText: vi.fn().mockResolvedValue({ ok: true }),
      answerCallbackQuery: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as TelegramClient;

    dispatcher = new UpdateDispatcher(mockTg);
    callbackRouter = new CallbackRouter(mockTg);

    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'ClarifyUser', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUserId = user.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('prompts user for time with inline options when scheduling without time', async () => {
    // Simulate dispatcher executing ask_clarification tool call
    await (dispatcher as any).executeToolCall(
      await userRepo.findById(dbUserId),
      testUserId,
      {
        name: 'ask_clarification',
        args: {
          pending_title: 'Dentist appointment',
          reason: 'missing_schedule_time',
          question: 'When would you like to schedule this?',
        },
      }
    );

    // Assert message sent with inline buttons
    expect(mockTg.sendMessage).toHaveBeenCalledWith(
      testUserId,
      expect.stringContaining('Dentist appointment'),
      expect.arrayContaining([
        expect.arrayContaining([expect.objectContaining({ callback_data: 'c:time:tom' })]),
        expect.arrayContaining([expect.objectContaining({ callback_data: 'c:time:skip' })]),
      ])
    );

    // Assert state saved to conversation_state
    const stateCheck = await pool.query('SELECT * FROM conversation_state WHERE user_id = $1', [dbUserId]);
    expect(stateCheck.rowCount).toBe(1);
    expect(stateCheck.rows[0].context.pending_title).toBe('Dentist appointment');
  });

  it('saves task in Open Tasks without deadline when c:time:skip is tapped', async () => {
    // Seed pending conversation state
    await pool.query(
      `
      INSERT INTO conversation_state (user_id, kind, context, expires_at)
      VALUES ($1, 'CLARIFY_TIME', $2, now() + interval '10 minutes')
      `,
      [dbUserId, JSON.stringify({ pending_title: 'Dentist appointment' })]
    );

    // Simulate callback query c:time:skip
    await callbackRouter.handleCallback({
      id: 'cq_time_1',
      from: { id: testUserId, first_name: 'ClarifyUser' },
      message: { message_id: 222, chat: { id: testUserId } },
      data: 'c:time:skip',
    });

    // Assert task created in tasks table with due_at = NULL
    const taskCheck = await pool.query('SELECT title, status, due_at FROM tasks WHERE user_id = $1', [dbUserId]);
    expect(taskCheck.rowCount).toBe(1);
    expect(taskCheck.rows[0].title).toBe('Dentist appointment');
    expect(taskCheck.rows[0].status).toBe('OPEN');
    expect(taskCheck.rows[0].due_at).toBeNull();

    // Assert conversation_state cleaned up
    const stateCheck = await pool.query('SELECT * FROM conversation_state WHERE user_id = $1', [dbUserId]);
    expect(stateCheck.rowCount).toBe(0);

    // Assert confirmation message edited
    expect(mockTg.editMessageText).toHaveBeenCalledWith(
      testUserId,
      222,
      expect.stringContaining('Saved in Open Tasks')
    );
  });

  it('schedules task for tomorrow when c:time:tom is tapped', async () => {
    await pool.query(
      `
      INSERT INTO conversation_state (user_id, kind, context, expires_at)
      VALUES ($1, 'CLARIFY_TIME', $2, now() + interval '10 minutes')
      `,
      [dbUserId, JSON.stringify({ pending_title: 'Eye checkup' })]
    );

    await callbackRouter.handleCallback({
      id: 'cq_time_2',
      from: { id: testUserId, first_name: 'ClarifyUser' },
      message: { message_id: 223, chat: { id: testUserId } },
      data: 'c:time:tom',
    });

    const taskCheck = await pool.query('SELECT title, due_at FROM tasks WHERE user_id = $1', [dbUserId]);
    expect(taskCheck.rowCount).toBe(1);
    expect(taskCheck.rows[0].title).toBe('Eye checkup');
    expect(taskCheck.rows[0].due_at).not.toBeNull();
  });

  it('logs OUTBOUND messages to messages table when bot replies', async () => {
    await (dispatcher as any).sendBotMessage(dbUserId, testUserId, 'Hello from bot');

    const msgCheck = await pool.query(
      `SELECT direction, text FROM messages WHERE user_id = $1 AND direction = 'OUTBOUND'`,
      [dbUserId]
    );
    expect(msgCheck.rowCount).toBeGreaterThanOrEqual(1);
    expect(msgCheck.rows[0].text).toBe('Hello from bot');
  });

  it('persists task recurrence when executeToolCall receives recurrence', async () => {
    const user = await userRepo.findById(dbUserId);
    await (dispatcher as any).executeToolCall(user, testUserId, {
      name: 'create_task',
      args: {
        title: 'DSA challenge questions',
        recurrence: 'DAILY',
        due_local: '2026-11-23T10:00:00',
        time_is_explicit: true,
      },
    });

    const taskRes = await pool.query(
      `SELECT title, recurrence, due_at FROM tasks WHERE user_id = $1 AND title = 'DSA challenge questions'`,
      [dbUserId]
    );
    expect(taskRes.rowCount).toBe(1);
    expect(taskRes.rows[0].recurrence).toEqual({ freq: 'DAILY' });
    expect(mockTg.sendMessage).toHaveBeenCalledWith(
      testUserId,
      expect.stringContaining('Repeats:</b> daily'),
      expect.any(Array)
    );
  });
});
