import { JobMessagingAdapter, JobMessagePayload } from './job.types.js';
import { telegram, TelegramClient, TelegramButton } from './telegram.client.js';

export class TelegramJobMessagingAdapter implements JobMessagingAdapter {
  constructor(private tg: TelegramClient = telegram) {}

  async sendMessage(chatId: number | string, payload: JobMessagePayload): Promise<{ messageId: number | string }> {
    const keyboard = this.toTelegramKeyboard(payload.buttons);
    const res = await this.tg.sendMessage(chatId, payload.text, keyboard);
    const messageId = res?.result?.message_id || 0;
    return { messageId };
  }

  async editMessage(chatId: number | string, messageId: number | string, payload: JobMessagePayload): Promise<boolean> {
    try {
      const keyboard = this.toTelegramKeyboard(payload.buttons);
      await this.tg.editMessageText(chatId, Number(messageId), payload.text, keyboard);
      return true;
    } catch (err: any) {
      // If message cannot be edited (e.g. text identical or expired), fallback to sendMessage
      await this.sendMessage(chatId, payload);
      return false;
    }
  }

  private toTelegramKeyboard(buttons?: { text: string; callbackData: string }[][]): TelegramButton[][] | undefined {
    if (!buttons || buttons.length === 0) return undefined;
    return buttons.map((row) =>
      row.map((btn) => ({
        text: btn.text,
        callback_data: btn.callbackData,
      }))
    );
  }
}

export const telegramJobMessagingAdapter = new TelegramJobMessagingAdapter();
