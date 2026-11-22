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
import { dateResolver } from './date.resolver.js';
import { DateTime } from 'luxon';
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
      await this.sendBotMessage(user.id, chatId, step.text, step.keyboard);
      return;
    }

    if (data.startsWith('ob:tz:')) {
      const tz = data.replace('ob:tz:', '');
      const step = await onboardingService.handleTimezone(user, tz);
      await this.sendBotMessage(user.id, chatId, step.text, step.keyboard);
      return;
    }

    if (data.startsWith('ob:time:')) {
      const time = data.replace('ob:time:', '');
      const step = await onboardingService.handleDefaultTime(user, time);
      await this.sendBotMessage(user.id, chatId, step.text, step.keyboard);
      return;
    }

    // Handle Undo Task Creation
    if (data.startsWith('u:task:')) {
      const taskId = data.replace('u:task:', '');
      const undoMsg = await taskService.undoTaskCreation(user.id, taskId);
      if (cq.message?.message_id) {
        await this.tg.editMessageText(chatId, cq.message.message_id, undoMsg);
        await this.logMessage(user.id, 'OUTBOUND', cq.message.message_id, 'TEXT', undoMsg);
      } else {
        await this.sendBotMessage(user.id, chatId, undoMsg);
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

    // Fetch conversation history BEFORE logging the current message to prevent duplication
    const messageHistory = await this.getRecentMessageHistory(user.id, 8);

    // Save inbound message log
    await this.logMessage(user.id, 'INBOUND', msg.message_id, 'TEXT', text);

    // 1. Command Routing (e.g. /start, /help, /settings)
    if (text.startsWith('/')) {
      const res = await commandRouter.handleCommand(user, text);
      await this.sendBotMessage(user.id, chatId, res.text, res.keyboard);
      return;
    }

    // 2. Strict Onboarding Gate: If not ACTIVE, prompt user to finish onboarding
    if (user.onboarding_state !== 'ACTIVE') {
      const prompt = onboardingService.getPendingStepPrompt(user);
      await this.sendBotMessage(user.id, chatId, prompt.text, prompt.keyboard);
      return;
    }

    // 2.2 Active Clarification State check (e.g. user answering when to schedule)
    const stateRes = await pool.query(
      `SELECT context FROM conversation_state WHERE user_id = $1 AND kind = 'CLARIFY_TIME' AND expires_at > now()`,
      [user.id]
    );

    if (stateRes.rowCount && stateRes.rowCount > 0) {
      const pendingTitle = stateRes.rows[0].context.pending_title || 'New Task';
      const lower = text.toLowerCase().trim();

      // If user says "skip", "no time", "open task", "none", "no", "later"
      if (['skip', 'no', 'none', 'no time', 'open task', 'later', 'cancel', 'dont set time', 'just save'].includes(lower)) {
        await pool.query('DELETE FROM conversation_state WHERE user_id = $1', [user.id]);
        const res = await taskService.createTask({
          userId: user.id,
          title: pendingTitle,
          userTimezone: user.timezone,
          defaultReminderTime: user.default_reminder_time,
          sourceMessageId: msg.message_id,
        });
        await this.sendBotMessage(user.id, chatId, res.text, res.keyboard);
        return;
      }

      // Try resolving user text as date/time
      const resolved = dateResolver.resolveProposed(text, false, {
        timezone: user.timezone,
        defaultReminderTime: user.default_reminder_time,
      });

      if (resolved.kind === 'RESOLVED') {
        await pool.query('DELETE FROM conversation_state WHERE user_id = $1', [user.id]);
        const res = await taskService.createTask({
          userId: user.id,
          title: pendingTitle,
          dueLocal: DateTime.fromJSDate(resolved.utcDate).setZone(user.timezone).toISO(),
          timeIsExplicit: resolved.timeIsExplicit,
          userTimezone: user.timezone,
          defaultReminderTime: user.default_reminder_time,
          sourceMessageId: msg.message_id,
        });
        await this.sendBotMessage(user.id, chatId, res.text, res.keyboard);
        return;
      }

      // If text doesn't resolve as a date and isn't skip, remove state and continue to LLM
      await pool.query('DELETE FROM conversation_state WHERE user_id = $1', [user.id]);
    }

    // 2.5 Rate Limit & Degraded Mode Safety Net
    const rateCheck = resilienceService.checkRateLimit(user.id);
    if (rateCheck.isLimited) {
      await this.sendBotMessage(
        user.id,
        chatId,
        `⚠️ <b>Rate Limit Exceeded</b>\nYou've sent too many messages in a short period. Please wait ${rateCheck.resetSeconds} seconds before sending another message.`
      );
      return;
    }

    if (resilienceService.degradedModeActive) {
      await taskService.saveNote(user.id, text, 'Saved Thought', null, msg.message_id);
      await this.sendBotMessage(
        user.id,
        chatId,
        `📥 I've saved your thought to your inbox, but AI parsing is temporarily paused for maintenance.`
      );
      return;
    }

    // 3. User is ACTIVE: Run LLM Tool Calling Pipeline with conversation history
    try {
      const openTasks = await taskService.getOpenTasks(user.id);
      const interpretResult = await llmService.interpret(user, text, openTasks, messageHistory);

      if (interpretResult.toolCalls.length === 0) {
        if (interpretResult.rawText) {
          await this.sendBotMessage(user.id, chatId, interpretResult.rawText);
        } else {
          await this.sendBotMessage(
            user.id,
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
      await this.sendBotMessage(
        user.id,
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
          recurrence: call.args.recurrence,
          userTimezone: user.timezone,
          defaultReminderTime: user.default_reminder_time,
          sourceMessageId: messageId,
        });
        await this.sendBotMessage(user.id, chatId, res.text, res.keyboard);
        break;
      }

      case 'create_reminder': {
        const res = await taskService.createTask({
          userId: user.id,
          title: call.args.text,
          dueLocal: call.args.remind_local,
          timeIsExplicit: call.args.time_is_explicit,
          recurrence: call.args.recurrence,
          userTimezone: user.timezone,
          defaultReminderTime: user.default_reminder_time,
          sourceMessageId: messageId,
        });
        await this.sendBotMessage(user.id, chatId, res.text, res.keyboard);
        break;
      }

      case 'save_note': {
        const res = await taskService.saveNote(user.id, call.args.content, call.args.title, call.args.url, messageId);
        await this.sendBotMessage(user.id, chatId, res.text, res.keyboard);
        break;
      }

      case 'complete_task': {
        const res = await taskService.completeTask(user.id, call.args.task_id, call.args.text_hint);
        await this.sendBotMessage(user.id, chatId, res.text, res.keyboard);
        break;
      }

      case 'drop_task': {
        const res = await taskService.dropTask(user.id, call.args.task_id, call.args.text_hint);
        await this.sendBotMessage(user.id, chatId, res.text, res.keyboard);
        break;
      }

      case 'search': {
        const res = await searchService.search(user.id, call.args.query, call.args.scope);
        await this.sendBotMessage(user.id, chatId, res.formattedText);
        break;
      }

      case 'list_items': {
        const text = await morningDigest.buildUpcomingList(user);
        await this.sendBotMessage(user.id, chatId, text);
        break;
      }

      case 'ask_clarification': {
        const title = call.args.pending_title;
        if (title || call.args.reason === 'missing_schedule_time') {
          const taskTitle = title || 'New Task';
          await pool.query(
            `
            INSERT INTO conversation_state (user_id, kind, context, expires_at)
            VALUES ($1, 'CLARIFY_TIME', $2, now() + interval '10 minutes')
            ON CONFLICT (user_id) DO UPDATE
            SET kind = EXCLUDED.kind, context = EXCLUDED.context, expires_at = EXCLUDED.expires_at;
            `,
            [user.id, JSON.stringify({ pending_title: taskTitle })]
          );

          await this.sendBotMessage(
            user.id,
            chatId,
            `❓ <b>When would you like to schedule:</b> <i>"${taskTitle}"</i>?\n\n` +
            `Tap an option below, reply with a time (e.g. <i>"tomorrow 3pm"</i>), or say <i>"skip"</i> to save it as an open task without a deadline.`,
            [
              [
                { text: '☀️ Tomorrow 9am', callback_data: 'c:time:tom' },
                { text: '📅 Friday 9am', callback_data: 'c:time:fri' },
              ],
              [{ text: '📝 Save to Open Tasks (No Time)', callback_data: 'c:time:skip' }],
            ]
          );
        } else {
          await this.sendBotMessage(user.id, chatId, `❓ <b>Clarification Needed:</b> ${call.args.question}`);
        }
        break;
      }

      case 'out_of_scope': {
        await this.sendBotMessage(
          user.id,
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

  private async sendBotMessage(
    userId: string,
    chatId: number | string,
    text: string,
    keyboard?: any
  ): Promise<any> {
    const sent = await this.tg.sendMessage(chatId, text, keyboard);
    await this.logMessage(userId, 'OUTBOUND', sent?.message_id, 'TEXT', text);
    return sent;
  }

  private async getRecentMessageHistory(
    userId: string,
    limit = 8
  ): Promise<Array<{ role: 'user' | 'assistant'; text: string }>> {
    const res = await pool.query(
      `
      SELECT direction, text
      FROM messages
      WHERE user_id = $1 AND kind = 'TEXT' AND text IS NOT NULL AND text != ''
      ORDER BY created_at DESC
      LIMIT $2;
      `,
      [userId, limit]
    );

    return res.rows.reverse().map((r) => ({
      role: r.direction === 'INBOUND' ? 'user' : 'assistant',
      text: r.text,
    }));
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
