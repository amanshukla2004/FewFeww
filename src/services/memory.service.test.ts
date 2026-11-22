import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { pool } from '../db/pool.js';
import { userRepo } from '../db/user.repo.js';
import { memoryService } from './memory.service.js';
import { UpdateDispatcher } from './dispatcher.js';
import { TelegramClient } from './telegram.client.js';

describe('Long-Term AI Memory & Recall Engine - Step 34', () => {
  const testUserId = 771199;
  let dbUser: any;
  let mockTg: TelegramClient;
  let dispatcher: UpdateDispatcher;

  beforeEach(async () => {
    mockTg = {
      sendMessage: vi.fn().mockResolvedValue({ ok: true, result: { message_id: 202 } }),
      editMessageText: vi.fn().mockResolvedValue({ ok: true }),
      answerCallbackQuery: vi.fn().mockResolvedValue({ ok: true }),
      sendChatAction: vi.fn().mockResolvedValue({ ok: true }),
      downloadFile: vi.fn().mockResolvedValue(Buffer.from('mock')),
    } as unknown as TelegramClient;

    dispatcher = new UpdateDispatcher(mockTg);

    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'MemoryTester', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUser = (await userRepo.findByTelegramId(testUserId))!;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('stores and updates facts in long-term AI memory (remember)', async () => {
    // 1. Store initial fact
    const res1 = await memoryService.remember(
      dbUser.id,
      'car license plate',
      'KA-01-MJ-1234',
      'CREDENTIAL'
    );
    expect(res1.formattedText).toContain('Stored in AI Memory');
    expect(res1.memory.content).toBe('KA-01-MJ-1234');

    // 2. Update existing memory with same key
    const res2 = await memoryService.remember(
      dbUser.id,
      'car license plate',
      'DL-08-AB-9999',
      'CREDENTIAL'
    );
    expect(res2.memory.content).toBe('DL-08-AB-9999');

    // Verify only 1 row exists
    const countRes = await pool.query('SELECT count(*) FROM ai_memories WHERE user_id = $1', [dbUser.id]);
    expect(Number(countRes.rows[0].count)).toBe(1);
  });

  it('recalls stored memories via fuzzy keyword search', async () => {
    await memoryService.remember(dbUser.id, 'wifi password', 'SecretGarden2026', 'CREDENTIAL');
    await memoryService.remember(dbUser.id, 'flight preference', 'Always window seat, row 12 or front', 'PREFERENCE');

    // Query 1: wifi
    const recallWifi = await memoryService.recall(dbUser.id, 'wifi');
    expect(recallWifi.memories.length).toBeGreaterThan(0);
    expect(recallWifi.formattedText).toContain('SecretGarden2026');

    // Query 2: seat preference
    const recallSeat = await memoryService.recall(dbUser.id, 'flight window seat');
    expect(recallSeat.memories.length).toBeGreaterThan(0);
    expect(recallSeat.formattedText).toContain('Always window seat');

    // Query 3: Non-existent memory
    const recallNone = await memoryService.recall(dbUser.id, 'cryptocurrency wallet address');
    expect(recallNone.memories.length).toBe(0);
    expect(recallNone.formattedText).toContain("couldn't find any saved memories");
  });

  it('lists and forgets memories', async () => {
    await memoryService.remember(dbUser.id, 'mother birthday', '14 June', 'PERSONAL');

    // List
    const list = await memoryService.listMemories(dbUser.id);
    expect(list.memories.length).toBe(1);
    expect(list.formattedText).toContain('14 June');

    // Forget
    const forgetRes = await memoryService.forget(dbUser.id, 'mother birthday');
    expect(forgetRes.deleted).toBe(true);
    expect(forgetRes.formattedText).toContain('Forgotten');

    // Check empty
    const listAfter = await memoryService.listMemories(dbUser.id);
    expect(listAfter.memories.length).toBe(0);
  });

  it('dispatches store_memory, recall_memory, and forget_memory tools via dispatcher', async () => {
    // 1. Dispatch store_memory
    await (dispatcher as any).executeToolCall(
      dbUser,
      dbUser.telegram_chat_id,
      {
        name: 'store_memory',
        args: {
          key_phrase: 'gym locker code',
          content: '9876',
          category: 'CREDENTIAL',
        },
      }
    );
    expect(vi.mocked(mockTg.sendMessage).mock.calls[0][1]).toContain('Stored in AI Memory');

    // 2. Dispatch recall_memory
    await (dispatcher as any).executeToolCall(
      dbUser,
      dbUser.telegram_chat_id,
      {
        name: 'recall_memory',
        args: { query: 'locker code' },
      }
    );
    expect(vi.mocked(mockTg.sendMessage).mock.calls[1][1]).toContain('9876');

    // 3. Dispatch forget_memory
    await (dispatcher as any).executeToolCall(
      dbUser,
      dbUser.telegram_chat_id,
      {
        name: 'forget_memory',
        args: { query: 'gym locker code' },
      }
    );
    expect(vi.mocked(mockTg.sendMessage).mock.calls[2][1]).toContain('Forgotten');
  });
});
