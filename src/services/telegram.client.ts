import { config } from '../config.js';

export interface TelegramButton {
  text: string;
  callback_data: string; // Strictly <= 64 bytes
}

export class TelegramClient {
  private baseUrl: string;
  private token: string;

  constructor(token: string = config.telegram.botToken) {
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async sendMessage(chatId: number | string, text: string, keyboard?: TelegramButton[][]): Promise<any> {
    const body: Record<string, any> = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    };

    if (keyboard && keyboard.length > 0) {
      body.reply_markup = { inline_keyboard: keyboard };
    }

    return this.post('sendMessage', body);
  }

  async editMessageText(chatId: number | string, messageId: number, text: string, keyboard?: TelegramButton[][]): Promise<any> {
    const body: Record<string, any> = {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
    };

    if (keyboard) {
      body.reply_markup = { inline_keyboard: keyboard };
    }

    return this.post('editMessageText', body);
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<any> {
    return this.post('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
    });
  }

  async getFile(fileId: string): Promise<{ ok: boolean; result?: { file_id: string; file_path?: string; file_size?: number } }> {
    return this.post('getFile', { file_id: fileId });
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    const url = `https://api.telegram.org/file/bot${this.token}/${filePath}`;
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Telegram API Error [downloadFile]: ${res.status} ${err}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async sendDocument(
    chatId: number | string,
    fileBuffer: Buffer | Uint8Array,
    filename: string,
    caption?: string
  ): Promise<any> {
    const formData = new FormData();
    formData.append('chat_id', String(chatId));
    formData.append('document', new Blob([fileBuffer as any]), filename);
    if (caption) {
      formData.append('caption', caption);
      formData.append('parse_mode', 'HTML');
    }

    const res = await fetch(`${this.baseUrl}/sendDocument`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Telegram API Error [sendDocument]: ${res.status} ${err}`);
    }

    return res.json();
  }

  private async post(method: string, payload: any): Promise<any> {
    const res = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Telegram API Error [${method}]: ${res.status} ${err}`);
    }

    return res.json();
  }
}

export const telegram = new TelegramClient();
