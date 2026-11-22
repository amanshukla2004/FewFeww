import { inboxRepo } from '../db/inbox.repo.js';
import { userRepo, User } from '../db/user.repo.js';
import { telegram, TelegramClient } from './telegram.client.js';
import { onboardingService } from './onboarding.service.js';
import { commandRouter } from './command.router.js';
import { pool } from '../db/pool.js';

export class UpdateDispatcher {
  constructor(private tg: TelegramClient = telegram) {}

  dispatchAsync(updateId: number): void {
    setImmediate(async () => {
      try {
        await this.processUpdate(updateId);
      } catch (err: any) {
        console.error(`[UpdateDispatcher] Error processing update ${updateId}:`, err);
        await inboxRepo.markStatus(updateId, 'FAILED', err?.message || 'Unknown processing error');
      }
    });
  }

  async processUpdate(updateId: number): Promise<void> {
    const record = await inboxRepo.getUpdate(updateId);
    if (!record) return;

    await inboxRepo.markStatus(updateId, 'PROCESSING');
    const update = record.payload;

    try {
      if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query);
      } else if (update.message) {
        await this.handleMessage(update.message);
      }

      await inboxRepo.markStatus(updateId, 'DONE');
    } catch (err: any) {
      await inboxRepo.markStatus(updateId, 'FAILED', err.message);
      throw err;
    }
  }

  private async handleCallbackQuery(cq: any): Promise<void> {
    const from = cq.from;
    const chatId = cq.message?.chat?.id || from.id;
    const data = cq.data || '';

    // Stop button spinner in Telegram UI
    try {
      await this.tg.answerCallbackQuery(cq.id);
    } catch (err) {
      // Ignored if expired
    }

    const { user } = await userRepo.findOrCreate(from.id, chatId, from.first_name, from.language_code);

    // Save message log
    await this.logMessage(user.id, 'INBOUND', cq.message?.message_id, 'CALLBACK', data);

    // Handle Onboarding Callbacks
    if (data === 'ob:consent') {
      const step = await onboardingService.handleConsent(user);
      await this.tg.sendMessage(chatId, step.text, step.keyboard);
      return;
    }

    if (data.startsWith('ob:tz:')) {
      const tz = data.replace('ob:tz:', '');
      const step = await onboardingService.handleTimezone(user, tz);
      await this.tg.sendMessage(chatId, step.text, step.keyboard);
      return;
    }

    if (data.startsWith('ob:time:')) {
      const time = data.replace('ob:time:', '');
      const step = await onboardingService.handleDefaultTime(user, time);
      await this.tg.sendMessage(chatId, step.text, step.keyboard);
      return;
    }

    // Settings & Other Callbacks will be handled in later steps
  }

  private async handleMessage(msg: any): Promise<void> {
    const from = msg.from;
    const chatId = msg.chat?.id || from.id;
    const text = (msg.text || '').trim();

    const { user } = await userRepo.findOrCreate(from.id, chatId, from.first_name, from.language_code);

    // Save message log
    await this.logMessage(user.id, 'INBOUND', msg.message_id, 'TEXT', text);

    // 1. Command Routing (e.g. /start, /help, /settings)
    if (text.startsWith('/')) {
      const res = await commandRouter.handleCommand(user, text);
      await this.tg.sendMessage(chatId, res.text, res.keyboard);
      return;
    }

    // 2. Strict Onboarding Gate: If not ACTIVE, prompt user to finish onboarding
    if (user.onboarding_state !== 'ACTIVE') {
      const prompt = onboardingService.getPendingStepPrompt(user);
      await this.tg.sendMessage(chatId, prompt.text, prompt.keyboard);
      return;
    }

    // 3. User is ACTIVE: In Step 07 this routes to LLM tool calling pipeline
    // For Step 05 verification, save thought acknowledgment
    await this.tg.sendMessage(chatId, `Got it: "${text}". LLM pipeline will parse this in Step 07!`);
  }

  private async logMessage(
    userId: string,
    direction: 'INBOUND' | 'OUTBOUND',
    telegramMsgId: number | undefined,
    kind: string,
    text: string
  ): Promise<void> {
    await pool.query(
      `
      INSERT INTO messages (user_id, direction, telegram_message_id, kind, text)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [userId, direction, telegramMsgId || null, kind, text]
    );
  }
}

export const dispatcher = new UpdateDispatcher();
