import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { pool } from '../db/pool.js';
import { userRepo } from '../db/user.repo.js';
import { webSearchService } from './web_search.service.js';
import { UpdateDispatcher } from './dispatcher.js';
import { TelegramClient } from './telegram.client.js';

describe('Internet Search Engine & Quota Tracking - Step 35', () => {
  const testUserId = 665544;
  let dbUser: any;
  let mockTg: TelegramClient;
  let dispatcher: UpdateDispatcher;

  beforeEach(async () => {
    mockTg = {
      sendMessage: vi.fn().mockResolvedValue({ ok: true, result: { message_id: 303 } }),
      editMessageText: vi.fn().mockResolvedValue({ ok: true }),
      answerCallbackQuery: vi.fn().mockResolvedValue({ ok: true }),
      sendChatAction: vi.fn().mockResolvedValue({ ok: true }),
      downloadFile: vi.fn().mockResolvedValue(Buffer.from('mock')),
    } as unknown as TelegramClient;

    dispatcher = new UpdateDispatcher(mockTg);

    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'SearchTester', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUser = (await userRepo.findByTelegramId(testUserId))!;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('performs web search, returns sources, and tracks monthly quota', async () => {
    const mockFetcher = async (query: string) => [
      {
        title: 'TypeScript 5.7 Release Notes',
        snippet: 'TypeScript 5.7 introduces checks for uninitialized variables and improved path rewriting.',
        url: 'https://devblogs.microsoft.com/typescript/announcing-typescript-5-7/',
      },
    ];

    const res = await webSearchService.search(dbUser.id, 'TypeScript 5.7 features', mockFetcher);

    expect(res.results.length).toBe(1);
    expect(res.formattedText).toContain('TypeScript 5.7 Release Notes');
    expect(res.formattedText).toContain('https://devblogs.microsoft.com/typescript/announcing-typescript-5-7/');
    expect(res.formattedText).toContain('1/30 used this month');
    expect(res.remainingQuota).toBe(29);

    // Verify DB count updated
    const userDb = await pool.query('SELECT monthly_search_count FROM users WHERE id = $1', [dbUser.id]);
    expect(userDb.rows[0].monthly_search_count).toBe(1);
  });

  it('enforces monthly search limit when quota is exhausted', async () => {
    // Set user quota to 30
    await pool.query('UPDATE users SET monthly_search_count = 30 WHERE id = $1', [dbUser.id]);

    const res = await webSearchService.search(dbUser.id, 'Any query');
    expect(res.remainingQuota).toBe(0);
    expect(res.formattedText).toContain('Monthly Search Limit Reached');
    expect(res.results.length).toBe(0);
  });

  it('dispatches internet_search tool via dispatcher', async () => {
    await (dispatcher as any).executeToolCall(
      dbUser,
      dbUser.telegram_chat_id,
      {
        name: 'internet_search',
        args: { query: 'latest AI news' },
      }
    );

    const call = vi.mocked(mockTg.sendMessage).mock.calls[0];
    expect(call[0]).toBe(dbUser.telegram_chat_id);
    expect(call[1]).toContain('Internet Search Results');
  });
});
