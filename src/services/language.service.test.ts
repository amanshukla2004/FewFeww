import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import { commandRouter } from './command.router.js';
import { CallbackRouter } from './callback.router.js';
import { UpdateDispatcher } from './dispatcher.js';
import { TelegramClient } from './telegram.client.js';
import { userRepo } from '../db/user.repo.js';
import { pool } from '../db/pool.js';

describe('Multilingual Onboarding & Output Language Engine (Step 19)', () => {
  const testUserId = 554433;
  let dbUserId: string;
  let mockTg: TelegramClient;
  let callbackRouter: CallbackRouter;
  let dispatcher: UpdateDispatcher;

  beforeEach(async () => {
    mockTg = {
      sendMessage: vi.fn().mockResolvedValue({ ok: true, result: { message_id: 401 } }),
      editMessageText: vi.fn().mockResolvedValue({ ok: true }),
      answerCallbackQuery: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as TelegramClient;

    callbackRouter = new CallbackRouter(mockTg);
    dispatcher = new UpdateDispatcher(mockTg);

    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'LangUser', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUserId = user.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('renders language selection keyboard via /language command', async () => {
    const user = (await userRepo.findById(dbUserId))!;
    const res = await commandRouter.handleCommand(user, '/language');

    expect(res.text).toContain('Preferred Output Language');
    expect(res.keyboard).toBeDefined();
    expect(res.keyboard?.[0][0].callback_data).toBe('cfg:lang:English');
    expect(res.keyboard?.[0][1].callback_data).toBe('cfg:lang:Hindi');
  });

  it('updates output_language when cfg:lang callback is clicked', async () => {
    await callbackRouter.handleCallback({
      id: 'cq_lang_1',
      from: { id: testUserId, first_name: 'LangUser' },
      message: { message_id: 402, chat: { id: testUserId } },
      data: 'cfg:lang:Hindi',
    });

    const user = (await userRepo.findById(dbUserId))!;
    expect(user.output_language).toBe('Hindi');
    expect(mockTg.editMessageText).toHaveBeenCalledWith(
      testUserId,
      402,
      expect.stringContaining('I will now reply in <b>Hindi</b>')
    );
  });

  it('updates language via set_language tool call in dispatcher', async () => {
    const user = (await userRepo.findById(dbUserId))!;
    await (dispatcher as any).executeToolCall(user, testUserId, {
      name: 'set_language',
      args: { language: 'Spanish' },
    });

    const updated = (await userRepo.findById(dbUserId))!;
    expect(updated.output_language).toBe('Spanish');
    expect(mockTg.sendMessage).toHaveBeenCalledWith(
      testUserId,
      expect.stringContaining('I will now reply in <b>Spanish</b>'),
      undefined
    );
  });

  it('displays output language in /settings', async () => {
    await userRepo.setOutputLanguage(dbUserId, 'Hinglish');
    const user = (await userRepo.findById(dbUserId))!;
    const res = await commandRouter.handleCommand(user, '/settings');

    expect(res.text).toContain('Hinglish');
  });
});
