import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import { UpdateDispatcher } from './dispatcher.js';
import { CallbackRouter } from './callback.router.js';
import { TelegramClient } from './telegram.client.js';
import { userRepo } from '../db/user.repo.js';
import { pool } from '../db/pool.js';

describe('4-Way Intent Disambiguation & Retraction Parsing (Step 17)', () => {
  const testUserId = 884422;
  let dbUserId: string;
  let mockTg: TelegramClient;
  let dispatcher: UpdateDispatcher;
  let callbackRouter: CallbackRouter;

  beforeEach(async () => {
    mockTg = {
      sendMessage: vi.fn().mockResolvedValue({ ok: true, result: { message_id: 301 } }),
      editMessageText: vi.fn().mockResolvedValue({ ok: true }),
      answerCallbackQuery: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as TelegramClient;

    dispatcher = new UpdateDispatcher(mockTg);
    callbackRouter = new CallbackRouter(mockTg);

    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'IntentUser', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUserId = user.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('handles retract_command tool call: confirms cancellation and creates zero tasks', async () => {
    const user = await userRepo.findById(dbUserId);
    await (dispatcher as any).executeToolCall(user, testUserId, {
      name: 'retract_command',
      args: { cancelled_intent: 'sending mail' },
    });

    expect(mockTg.sendMessage).toHaveBeenCalledWith(
      testUserId,
      expect.stringContaining('Cancelled. I did not create that task for "sending mail".'),
      undefined
    );

    const taskCheck = await pool.query('SELECT count(*) FROM tasks WHERE user_id = $1', [dbUserId]);
    expect(Number(taskCheck.rows[0].count)).toBe(0);
  });

  it('distinguishes actionable cancellation: creates task to cancel subscription', async () => {
    const user = await userRepo.findById(dbUserId);
    await (dispatcher as any).executeToolCall(user, testUserId, {
      name: 'create_task',
      args: { title: 'Cancel gym subscription' },
    });

    const taskCheck = await pool.query('SELECT title, status FROM tasks WHERE user_id = $1', [dbUserId]);
    expect(taskCheck.rowCount).toBe(1);
    expect(taskCheck.rows[0].title).toBe('Cancel gym subscription');
    expect(taskCheck.rows[0].status).toBe('OPEN');
  });

  it('renders 3-way interactive card when classification is ambiguous', async () => {
    const user = await userRepo.findById(dbUserId);
    await (dispatcher as any).executeToolCall(user, testUserId, {
      name: 'ask_clarification',
      args: {
        disambiguation_type: 'TASK_OR_NOTE_OR_HABIT',
        pending_title: 'Morning workout',
        question: 'Would you like to track this as a task, habit, or note?',
      },
    });

    expect(mockTg.sendMessage).toHaveBeenCalledWith(
      testUserId,
      expect.stringContaining('How would you like to track:'),
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({ text: '✅ To-Do Task', callback_data: 'c:kind:task:Morning workout' }),
          expect.objectContaining({ text: '📊 Daily Habit', callback_data: 'c:kind:habit:Morning workout' }),
        ]),
        expect.arrayContaining([
          expect.objectContaining({ text: '📌 Reference Note', callback_data: 'c:kind:note:Morning workout' }),
        ]),
      ])
    );
  });

  it('resolves ambiguous classification via callback query to task or note', async () => {
    // 1. User taps "✅ To-Do Task"
    await callbackRouter.handleCallback({
      id: 'cq_k1',
      from: { id: testUserId, first_name: 'IntentUser' },
      message: { message_id: 302, chat: { id: testUserId } },
      data: 'c:kind:task:Read 20 pages',
    });

    const taskCheck = await pool.query('SELECT title FROM tasks WHERE user_id = $1 AND title = $2', [
      dbUserId,
      'Read 20 pages',
    ]);
    expect(taskCheck.rowCount).toBe(1);

    // 2. User taps "📌 Reference Note"
    await callbackRouter.handleCallback({
      id: 'cq_k2',
      from: { id: testUserId, first_name: 'IntentUser' },
      message: { message_id: 303, chat: { id: testUserId } },
      data: 'c:kind:note:Book recommendations',
    });

    const noteCheck = await pool.query('SELECT title FROM notes WHERE user_id = $1 AND title = $2', [
      dbUserId,
      'Book recommendations',
    ]);
    expect(noteCheck.rowCount).toBe(1);
  });
});
