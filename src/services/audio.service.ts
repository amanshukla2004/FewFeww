import Groq, { toFile } from 'groq-sdk';
import { config } from '../config.js';

export interface TranscriptionResult {
  text: string;
  duration?: number;
  language?: string;
}

export class AudioService {
  private groq: Groq;

  constructor(apiKey: string = config.llm.groqApiKey) {
    this.groq = new Groq({ apiKey });
  }

  /**
   * Transcribes an audio buffer using Groq Whisper (whisper-large-v3).
   * Supports .oga, .ogg, .wav, .mp3, .m4a.
   */
  async transcribeAudio(
    audioBuffer: Buffer,
    mimeType = 'audio/ogg',
    filename = 'voice.ogg'
  ): Promise<TranscriptionResult> {
    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('Audio buffer is empty');
    }

    const file = await toFile(audioBuffer, filename, { type: mimeType });

    const transcription = await this.groq.audio.transcriptions.create({
      file,
      model: 'whisper-large-v3',
      response_format: 'verbose_json',
    });

    return {
      text: (transcription.text || '').trim(),
      duration: (transcription as any).duration,
      language: (transcription as any).language,
    };
  }
}

export const audioService = new AudioService();
