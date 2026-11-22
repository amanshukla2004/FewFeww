import { describe, it, expect, beforeEach } from 'vitest';
import { visionService } from './vision.service.js';
import { UpdateDispatcher } from './dispatcher.js';
import { pool } from '../db/pool.js';
import { userRepo } from '../db/user.repo.js';

describe('Multimodal Vision & Image Analysis (Step 30)', () => {
  let testUserId: string;
  const testChatId = 7700223344;

  beforeEach(async () => {
    await pool.query('DELETE FROM image_analyses;');
    await pool.query('DELETE FROM tasks;');
    await pool.query('DELETE FROM users WHERE telegram_chat_id = $1;', [testChatId]);

    const { user } = await userRepo.findOrCreate(testChatId, testChatId, 'VisionUser', 'en');
    testUserId = user.id;
  });

  it('analyzes an image with deadline caption and extracts actionable tasks', async () => {
    const dummyImage = Buffer.from('fake_image_bytes_for_testing');
    const res = await visionService.analyzeImage(
      testUserId,
      dummyImage,
      'image/jpeg',
      'Submit Physics assignment by Friday 5pm'
    );

    expect(res.summary).toContain('Submit Physics assignment');
    expect(res.extractedTasks.length).toBe(1);
    expect(res.extractedTasks[0].title).toBe('Submit Physics assignment by Friday 5pm');
    expect(res.formattedText).toContain('Image Analysis Complete');
    expect(res.formattedText).toContain('Submit Physics assignment');

    // Verify row in DB
    const dbRes = await pool.query('SELECT * FROM image_analyses WHERE user_id = $1', [testUserId]);
    expect(dbRes.rowCount).toBe(1);
    expect(dbRes.rows[0].summary).toContain('Submit Physics assignment');
  });

  it('lists previous image analyses for user', async () => {
    const dummyImage = Buffer.from('fake_bytes');
    await visionService.analyzeImage(testUserId, dummyImage, 'image/png', 'Receipt from grocery store');

    const list = await visionService.listAnalyses(testUserId);
    expect(list.length).toBe(1);
    expect(list[0].summary).toContain('Receipt from grocery store');
  });

  it('ingests Telegram photo message, runs Vision analysis, and auto-creates tasks', async () => {
    const user = await userRepo.findById(testUserId);
    expect(user).toBeDefined();

    const sentMessages: string[] = [];
    const mockTg: any = {
      sendMessage: async (_chatId: any, text: string) => {
        sentMessages.push(text);
        return { message_id: 4001 };
      },
      getFile: async () => ({
        result: { file_path: 'photos/file_4001.jpg' },
      }),
      downloadFile: async () => Buffer.from('photo_bytes'),
    };

    const dispatcher = new UpdateDispatcher(mockTg);

    // Simulate incoming photo from Telegram with caption
    await (dispatcher as any).handleMessage({
      message_id: 999,
      from: { id: testChatId, first_name: 'VisionUser' },
      chat: { id: testChatId },
      photo: [
        { file_id: 'thumb_id', width: 90, height: 90 },
        { file_id: 'large_id', width: 800, height: 800 },
      ],
      caption: 'Due date: Pay electricity bill tomorrow',
    });

    expect(sentMessages.length).toBe(2);
    expect(sentMessages[0]).toContain('Analyzing image with Vision OCR');
    expect(sentMessages[1]).toContain('Image Analysis Complete');
    expect(sentMessages[1]).toContain('Pay electricity bill');

    // Verify task auto-created in tasks table
    const taskRes = await pool.query('SELECT * FROM tasks WHERE user_id = $1', [testUserId]);
    expect(taskRes.rowCount).toBe(1);
    expect(taskRes.rows[0].title).toBe('Due date: Pay electricity bill tomorrow');
  });
});
