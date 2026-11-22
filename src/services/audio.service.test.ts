import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { AudioService, audioService } from './audio.service.js';
import { UpdateDispatcher } from './dispatcher.js';
import { TelegramClient } from './telegram.client.js';
import { userRepo } from '../db/user.repo.js';
import { pool } from '../db/pool.js';

describe('Voice Notes & Audio Transcription (Groq Whisper)', () => {
  const testUserId = 665544;
  let dbUserId: string;
  let mockTg: TelegramClient;
  let dispatcher: UpdateDispatcher;

  beforeEach(async () => {
    mockTg = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 888 }),
      editMessageText: vi.fn().mockResolvedValue({ message_id: 888 }),
      answerCallbackQuery: vi.fn().mockResolvedValue({ ok: true }),
      getFile: vi.fn().mockResolvedValue({
        ok: true,
        result: { file_id: 'voice_123', file_path: 'voice/file_1.oga' },
      }),
      downloadFile: vi.fn().mockResolvedValue(Buffer.from('fake-audio-bytes')),
    } as unknown as TelegramClient;

    dispatcher = new UpdateDispatcher(mockTg);

    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'VoiceUser', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUserId = user.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('rejects empty audio buffer with clear error', async () => {
    const service = new AudioService('fake-key');
    await expect(service.transcribeAudio(Buffer.from(''))).rejects.toThrow('Audio buffer is empty');
  });

  it('transcribes valid audio buffer via Groq Whisper', async () => {
    const mockGroq = {
      audio: {
        transcriptions: {
          create: vi.fn().mockResolvedValue({
            text: 'Schedule dentist appointment tomorrow 3pm',
            duration: 3.2,
            language: 'english',
          }),
        },
      },
    };

    const service = new AudioService('fake-key');
    (service as any).groq = mockGroq;

    const res = await service.transcribeAudio(Buffer.from('mock-audio-data'), 'audio/ogg', 'voice.ogg');
    expect(res.text).toBe('Schedule dentist appointment tomorrow 3pm');
    expect(res.duration).toBe(3.2);
    expect(mockGroq.audio.transcriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'whisper-large-v3',
        response_format: 'verbose_json',
      })
    );
  });

  it('ingests Telegram voice note, transcribes, quotes preview, and triggers task creation', async () => {
    // Mock transcribeAudio on global audioService
    vi.spyOn(audioService, 'transcribeAudio').mockResolvedValue({
      text: 'Submit physics assignment by Friday 5pm',
      duration: 2.5,
      language: 'english',
    });

    const voiceMsg = {
      message_id: 501,
      from: { id: testUserId, first_name: 'VoiceUser' },
      chat: { id: testUserId },
      voice: {
        file_id: 'voice_123',
        duration: 3,
        mime_type: 'audio/ogg',
        file_size: 15000,
      },
    };

    await (dispatcher as any).handleMessage(voiceMsg);

    // 1. Assert getFile and downloadFile called
    expect(mockTg.getFile).toHaveBeenCalledWith('voice_123');
    expect(mockTg.downloadFile).toHaveBeenCalledWith('voice/file_1.oga');

    // 2. Assert voice transcription status and quote preview sent to Telegram
    expect(mockTg.sendMessage).toHaveBeenCalledWith(
      testUserId,
      expect.stringContaining('Transcribing your voice note')
    );
    expect(mockTg.sendMessage).toHaveBeenCalledWith(
      testUserId,
      expect.stringContaining('Submit physics assignment by Friday 5pm'),
      undefined
    );

    // 3. Assert task created in DB
    const taskRes = await pool.query(
      `SELECT title, due_at FROM tasks WHERE user_id = $1 AND title ILIKE '%physics%'`,
      [dbUserId]
    );
    expect(taskRes.rowCount).toBe(1);
    expect(taskRes.rows[0].title.toLowerCase()).toContain('physics');
  }, 30000);

  it('handles voice download failure gracefully with user alert', async () => {
    (mockTg.downloadFile as any).mockRejectedValueOnce(new Error('Network timeout'));

    const voiceMsg = {
      message_id: 502,
      from: { id: testUserId, first_name: 'VoiceUser' },
      chat: { id: testUserId },
      voice: {
        file_id: 'voice_err',
        duration: 2,
        mime_type: 'audio/ogg',
      },
    };

    await (dispatcher as any).handleMessage(voiceMsg);

    // Assert graceful error message sent
    expect(mockTg.sendMessage).toHaveBeenCalledWith(
      testUserId,
      expect.stringContaining('trouble transcribing that voice note'),
      undefined
    );
  });
});
