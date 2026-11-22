import { inboxRepo } from '../db/inbox.repo.js';
import { userRepo, User } from '../db/user.repo.js';
import { telegram, TelegramClient } from './telegram.client.js';
import { onboardingService } from './onboarding.service.js';
import { commandRouter } from './command.router.js';
import { taskService } from './task.service.js';
import { llmService } from './llm.service.js';
import { callbackRouter } from './callback.router.js';
import { searchService } from './search.service.js';
import { morningDigest } from './morning.digest.js';
import { resilienceService } from './resilience.service.js';
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

    // Handle Undo Task Creation
    if (data.startsWith('u:task:')) {
      const taskId = data.replace('u:task:', '');
      const undoMsg = await taskService.undoTaskCreation(user.id, taskId);
      if (cq.message?.message_id) {
        await this.tg.editMessageText(chatId, cq.message.message_id, undoMsg);
      } else {
        await this.tg.sendMessage(chatId, undoMsg);
      }
      return;
    }

    // Route Reminder, Nudge, and Setting Callbacks
    await callbackRouter.handleCallback(cq);
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

    // 2.5 Rate Limit & Degraded Mode Safety Net
    const rateCheck = resilienceService.checkRateLimit(user.id);
    if (rateCheck.isLimited) {
      await this.tg.sendMessage(
        chatId,
        `⚠️ <b>Rate Limit Exceeded</b>\nYou've sent too many messages in a short period. Please wait ${rateCheck.resetSeconds} seconds before sending another message.`
      );
      return;
    }

    if (resilienceService.degradedModeActive) {
      await taskService.saveNote(user.id, text, 'Saved Thought', null, msg.message_id);
      await this.tg.sendMessage(
        chatId,
        `📥 I've saved your thought to your inbox, but AI parsing is temporarily paused for maintenance.`
      );
      return;
    }

    // 3. User is ACTIVE: Run LLM Tool Calling Pipeline
    try {
      const openTasks = await taskService.getOpenTasks(user.id);
      const interpretResult = await llmService.interpret(user, text, openTasks);

      if (interpretResult.toolCalls.length === 0) {
        if (interpretResult.rawText) {
          await this.tg.sendMessage(chatId, interpretResult.rawText);
        } else {
          await this.tg.sendMessage(
            chatId,
            `I couldn't detect a task or reminder. Try something like <code>Submit DBMS assignment by Friday 6pm</code> or type /help.`
          );
        }
        return;
      }

      // Execute extracted tool calls (max 5 per single message)
      for (const call of interpretResult.toolCalls.slice(0, 5)) {
        await this.executeToolCall(user, chatId, call, msg.message_id);
      }
    } catch (err: any) {
      console.error('[UpdateDispatcher] LLM Pipeline Error:', err);
      // Fallback: Save as note in Degraded Mode
      await taskService.saveNote(user.id, text, 'Saved Thought', null, msg.message_id);
      await this.tg.sendMessage(
        chatId,
        `📥 I've saved your thought to your notes, but couldn't parse the dates right now.`
      );
    }
  }

  private async executeToolCall(user: User, chatId: number | string, call: { name: string; args: any }, messageId?: number): Promise<void> {
    switch (call.name) {
      case 'create_task': {
        const res = await taskService.createTask({
          userId: user.id,
          title: call.args.title,
          details: call.args.details,
          dueLocal: call.args.due_local,
          timeIsExplicit: call.args.time_is_explicit,
          userTimezone: user.timezone,
          defaultReminderTime: user.default_reminder_time,
          sourceMessageId: messageId,
        });
        await this.tg.sendMessage(chatId, res.text, res.keyboard);
        break;
      }

      case 'create_reminder': {
        const res = await taskService.createTask({
          userId: user.id,
          title: call.args.text,
          dueLocal: call.args.remind_local,
          timeIsExplicit: call.args.time_is_explicit,
          userTimezone: user.timezone,
          defaultReminderTime: user.default_reminder_time,
          sourceMessageId: messageId,
        });
        await this.tg.sendMessage(chatId, res.text, res.keyboard);
        break;
      }

      case 'save_note': {
        const res = await taskService.saveNote(user.id, call.args.content, call.args.title, call.args.url, messageId);
        await this.tg.sendMessage(chatId, res.text, res.keyboard);
        break;
      }

      case 'complete_task': {
        const res = await taskService.completeTask(user.id, call.args.task_id, call.args.text_hint);
        await this.tg.sendMessage(chatId, res.text, res.keyboard);
        break;
      }

      case 'drop_task': {
        const res = await taskService.dropTask(user.id, call.args.task_id, call.args.text_hint);
        await this.tg.sendMessage(chatId, res.text, res.keyboard);
        break;
      }

      case 'search': {
        const res = await searchService.search(user.id, call.args.query, call.args.scope);
        await this.tg.sendMessage(chatId, res.formattedText);
        break;
      }

      case 'list_items': {
        const text = await morningDigest.buildUpcomingList(user);
        await this.tg.sendMessage(chatId, text);
        break;
      }

      case 'ask_clarification': {
        await this.tg.sendMessage(chatId, `❓ <b>Clarification Needed:</b> ${call.args.question}`);
        break;
      }

      case 'out_of_scope': {
        await this.tg.sendMessage(
          chatId,
          `👋 I'm FewFeww, your personal task and follow-through assistant. I track deadlines, set reminders, and take notes. Forward me a deadline or type /help to see what I can do!`
        );
        break;
      }

      default:
        console.warn(`[UpdateDispatcher] Unhandled tool call: ${call.name}`);
        break;
    }
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
