import { describe, it, expect, beforeEach } from 'vitest';
import { momService } from './mom.service.js';
import { commandRouter } from './command.router.js';
import { UpdateDispatcher } from './dispatcher.js';
import { audioService } from './audio.service.js';
import { pool } from '../db/pool.js';
import { userRepo } from '../db/user.repo.js';

describe('Meeting Minutes (MOM Mode) - Step 31', () => {
  let testUserId: string;
  const testChatId = 7700334455;

  beforeEach(async () => {
    await pool.query('DELETE FROM meeting_minutes;');
    await pool.query('DELETE FROM conversation_state;');
    await pool.query('DELETE FROM tasks;');
    await pool.query('DELETE FROM users WHERE telegram_chat_id = $1;', [testChatId]);

    const { user } = await userRepo.findOrCreate(testChatId, testChatId, 'MomUser', 'en');
    testUserId = user.id;
  });

  it('activates MOM mode with setup instructions and saves active state', async () => {
    const res = await momService.activateMomMode(testUserId);
    expect(res.text).toContain('Meeting Minutes Mode Activated');
    expect(res.text).toContain('Turn on voice recording');
    expect(res.text).toContain('Place phone in the center');

    const state = await pool.query('SELECT * FROM conversation_state WHERE user_id = $1', [testUserId]);
    expect(state.rowCount).toBe(1);
    expect(state.rows[0].kind).toBe('MOM_MODE');
  });

  it('handles /mom command via commandRouter', async () => {
    const user = await userRepo.findById(testUserId);
    expect(user).toBeDefined();

    const cmdRes = await commandRouter.handleCommand(user!, '/mom');
    expect(cmdRes.text).toContain('Meeting Minutes Mode Activated');
  });

  it('processes meeting transcript, saves decisions, and auto-creates tasks for action items', async () => {
    const meetingTranscript =
      'We discussed the Q1 backend performance goals. ' +
      'We agreed to migrate database to Postgres 17. ' +
      'Yash will finish the caching layer by Friday. ' +
      'Aman must send the security review report.';

    const res = await momService.processMeetingAudio(
      testUserId,
      meetingTranscript,
      300,
      'Q1 Architecture Sync'
    );

    expect(res.minutes.title).toBe('Q1 Architecture Sync');
    expect(res.minutes.decisions.length).toBeGreaterThanOrEqual(1);
    expect(res.minutes.actionItems.length).toBeGreaterThanOrEqual(2);
    expect(res.formattedText).toContain('Meeting Minutes Generated');
    expect(res.formattedText).toContain('Decisions Made');
    expect(res.formattedText).toContain('Action Items');

    // Verify row in meeting_minutes table
    const mmRes = await pool.query('SELECT * FROM meeting_minutes WHERE user_id = $1', [testUserId]);
    expect(mmRes.rowCount).toBe(1);

    // Verify tasks auto-created for action items
    const tasksRes = await pool.query('SELECT * FROM tasks WHERE user_id = $1', [testUserId]);
    expect(tasksRes.rowCount).toBeGreaterThanOrEqual(2);
  });

  it('intercepts voice note in MOM mode, dispatches meeting minutes, and clears MOM state', async () => {
    const user = await userRepo.findById(testUserId);
    expect(user).toBeDefined();

    // Activate MOM mode first
    await momService.activateMomMode(testUserId);

    const sentMessages: string[] = [];
    const mockTg: any = {
      sendMessage: async (_chatId: any, text: string) => {
        sentMessages.push(text);
        return { message_id: 5001 };
      },
      getFile: async () => ({
        result: { file_path: 'voice/mom_recording.ogg' },
      }),
      downloadFile: async () => Buffer.from('voice_bytes'),
    };

    // Mock audio transcription
    const originalTranscribe = audioService.transcribeAudio;
    audioService.transcribeAudio = async () => ({
      text: 'We finalized the client contract. Rohit will deploy the production build tomorrow.',
      durationSec: 120,
    });

    try {
      const dispatcher = new UpdateDispatcher(mockTg);

      await (dispatcher as any).handleMessage({
        message_id: 888,
        from: { id: testChatId, first_name: 'MomUser' },
        chat: { id: testChatId },
        voice: { file_id: 'mom_voice_123', duration: 120 },
      });

      // Verify MOM report was sent
      expect(sentMessages.length).toBe(2);
      expect(sentMessages[0]).toContain('Transcribing your voice note');
      expect(sentMessages[1]).toContain('Meeting Minutes Generated');
      expect(sentMessages[1]).toContain('Rohit will deploy');

      // Verify MOM state cleared
      const state = await pool.query('SELECT * FROM conversation_state WHERE user_id = $1', [testUserId]);
      expect(state.rowCount).toBe(0);
    } finally {
      audioService.transcribeAudio = originalTranscribe;
    }
  });
});
