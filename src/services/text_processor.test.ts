import { describe, it, expect, beforeEach } from 'vitest';
import { textProcessor } from './text_processor.js';
import { UpdateDispatcher } from './dispatcher.js';
import { pool } from '../db/pool.js';
import { userRepo } from '../db/user.repo.js';

describe('In-Chat Text Processing Utilities - Step 32', () => {
  let testUserId: string;
  const testChatId = 7700445566;

  beforeEach(async () => {
    await pool.query('DELETE FROM users WHERE telegram_chat_id = $1;', [testChatId]);
    const { user } = await userRepo.findOrCreate(testChatId, testChatId, 'TextUser', 'en');
    testUserId = user.id;
  });

  it('rewrites text to formal tone with code-formatted output', async () => {
    const res = await textProcessor.rewriteText({
      text: 'hey i need the report by tmrw morning',
      tone: 'FORMAL',
    });

    expect(res.result).toBeDefined();
    expect(res.formattedText).toContain('Rewritten (FORMAL)');
    expect(res.formattedText).toContain('<code>');
  });

  it('rewrites text to casual tone', async () => {
    const res = await textProcessor.rewriteText({
      text: 'I would like to inquire regarding our scheduled meeting',
      tone: 'CASUAL',
    });

    expect(res.result).toBeDefined();
    expect(res.formattedText).toContain('Rewritten (CASUAL)');
  });

  it('translates text into target language', async () => {
    const res = await textProcessor.translateText({
      text: 'Good morning, have a productive day!',
      targetLanguage: 'Spanish',
    });

    expect(res.translated).toBeDefined();
    expect(res.formattedText).toContain('Translation (Spanish)');
    expect(res.formattedText).toContain('<code>');
  });

  it('executes rewrite_text and translate_text tool calls via dispatcher', async () => {
    const user = await userRepo.findById(testUserId);
    expect(user).toBeDefined();

    const sentMessages: string[] = [];
    const mockTg: any = {
      sendMessage: async (_chatId: any, text: string) => {
        sentMessages.push(text);
        return { message_id: 6001 };
      },
    };

    const dispatcher = new UpdateDispatcher(mockTg);

    // Call rewrite_text tool
    await (dispatcher as any).executeToolCall(
      user!,
      testChatId,
      {
        name: 'rewrite_text',
        args: {
          text: 'thanks for helping me out',
          tone: 'FORMAL',
        },
      }
    );

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Rewritten (FORMAL)');

    // Call translate_text tool
    await (dispatcher as any).executeToolCall(
      user!,
      testChatId,
      {
        name: 'translate_text',
        args: {
          text: 'Where is the office?',
          target_language: 'French',
        },
      }
    );

    expect(sentMessages.length).toBe(2);
    expect(sentMessages[1]).toContain('Translation (French)');
  });
});
