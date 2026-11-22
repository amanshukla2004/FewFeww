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
import { listService } from './list.service.js';
import { habitService } from './habit.service.js';
import { audioService } from './audio.service.js';
import { contactService } from './contact.service.js';
import { circleService } from './circle.service.js';
import { calendarService } from './calendar.service.js';
import { emailService } from './email.service.js';
import { driveService } from './drive.service.js';
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

    // Handle List & Category Callbacks
    if (data.startsWith('l:v:')) {
      const listName = data.replace('l:v:', '');
      const res = await listService.formatListItems(user.id, listName);
      if (cq.message?.message_id) {
        await this.tg.editMessageText(chatId, cq.message.message_id, res.text, res.keyboard);
        await this.logMessage(user.id, 'OUTBOUND', cq.message.message_id, 'TEXT', res.text);
      } else {
        await this.sendBotMessage(user.id, chatId, res.text, res.keyboard);
      }
      return;
    }

    if (data.startsWith('l:doneall:')) {
      const listName = data.replace('l:doneall:', '');
      const count = await listService.completeAllInList(user.id, listName);
      const reply = `🎉 <b>Completed:</b> Marked ${count} task(s) in <i>"${listName}"</i> as complete!`;
      if (cq.message?.message_id) {
        await this.tg.editMessageText(chatId, cq.message.message_id, reply, [
          [{ text: '🔙 View All Lists', callback_data: 'l:back' }],
        ]);
        await this.logMessage(user.id, 'OUTBOUND', cq.message.message_id, 'TEXT', reply);
      } else {
        await this.sendBotMessage(user.id, chatId, reply, [
          [{ text: '🔙 View All Lists', callback_data: 'l:back' }],
        ]);
      }
      return;
    }

    if (data === 'l:back') {
      const res = await listService.formatListsOverview(user.id);
      if (cq.message?.message_id) {
        await this.tg.editMessageText(chatId, cq.message.message_id, res.text, res.keyboard);
        await this.logMessage(user.id, 'OUTBOUND', cq.message.message_id, 'TEXT', res.text);
      } else {
        await this.sendBotMessage(user.id, chatId, res.text, res.keyboard);
      }
      return;
    }

    // Route Reminder, Nudge, and Setting Callbacks
    await callbackRouter.handleCallback(cq);
  }

  private async handleMessage(msg: any): Promise<void> {
    const from = msg.from;
    const chatId = msg.chat?.id || from.id;
    let text = (msg.text || '').trim();

    const { user } = await userRepo.findOrCreate(from.id, chatId, from.first_name, from.language_code);

    // Handle Document / File Forwarding to Cloud Drive
    const doc = msg.document;
    if (doc?.file_id && !text) {
      const fileName = doc.file_name || 'document';
      const res = await driveService.uploadFile({
        userId: user.id,
        fileName,
        mimeType: doc.mime_type,
        fileSize: doc.file_size,
        provider: 'GOOGLE_DRIVE',
      });
      await this.sendBotMessage(user.id, chatId, res.formattedText);
      return;
    }

    // Handle Voice Notes & Audio Transcriptions (Groq Whisper large-v3)
    const voice = msg.voice || msg.audio;
    if (voice?.file_id && !text) {
      try {
        await this.tg.sendMessage(chatId, '🎙️ <i>Transcribing your voice note...</i>');
        const fileInfo = await this.tg.getFile(voice.file_id);
        const filePath = fileInfo?.result?.file_path;
        if (filePath) {
          const audioBuf = await this.tg.downloadFile(filePath);
          const mime = voice.mime_type || (msg.voice ? 'audio/ogg' : 'audio/mpeg');
          const ext = msg.voice ? 'voice.ogg' : 'audio.mp3';
          const transcription = await audioService.transcribeAudio(audioBuf, mime, ext);
          text = transcription.text;
          if (text) {
            await this.sendBotMessage(user.id, chatId, `🗣️ <i>"${text}"</i>`);
          }
        }
      } catch (err: any) {
        console.error('[UpdateDispatcher] Voice transcription error:', err);
        await this.sendBotMessage(
          user.id,
          chatId,
          '⚠️ <i>Sorry, I had trouble transcribing that voice note. Please try speaking closer to your mic or send as text.</i>'
        );
        return;
      }
    }

    if (!text) {
      return;
    }

    // Fetch conversation history BEFORE logging the current message to prevent duplication
    const messageHistory = await this.getRecentMessageHistory(user.id, 8);

    // Save inbound message log
    const dbMessageId = await this.logMessage(user.id, 'INBOUND', msg.message_id, voice ? 'VOICE' : 'TEXT', text);

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

    // 2.2 Active Clarification State check (e.g. user answering when to schedule, or choosing task/habit/note)
    const stateRes = await pool.query(
      `SELECT kind, context FROM conversation_state WHERE user_id = $1 AND expires_at > now()`,
      [user.id]
    );

    if (stateRes.rowCount && stateRes.rowCount > 0) {
      const stateKind = stateRes.rows[0].kind;
      const stateContext = stateRes.rows[0].context || {};
      const pendingTitle = stateContext.pending_title || 'New Task';
      const recurrence = stateContext.recurrence;
      const lower = text.toLowerCase().trim();

      // If user says "skip", "no time", "open task", "none", "no", "later"
      if (['skip', 'no', 'none', 'no time', 'open task', 'later', 'cancel', 'dont set time', 'just save'].includes(lower)) {
        await pool.query('DELETE FROM conversation_state WHERE user_id = $1', [user.id]);
        const res = await taskService.createTask({
          userId: user.id,
          title: pendingTitle,
          recurrence,
          userTimezone: user.timezone,
          defaultReminderTime: user.default_reminder_time,
          sourceMessageId: dbMessageId ? Number(dbMessageId) : undefined,
        });
        await this.sendBotMessage(user.id, chatId, res.text, res.keyboard);
        return;
      }

      // If user answers task/habit/note clarification textually
      if (['task', 'to-do', 'todo', 'reminder'].includes(lower)) {
        await pool.query('DELETE FROM conversation_state WHERE user_id = $1', [user.id]);
        const res = await taskService.createTask({
          userId: user.id,
          title: pendingTitle,
          recurrence,
          userTimezone: user.timezone,
          defaultReminderTime: user.default_reminder_time,
          sourceMessageId: dbMessageId ? Number(dbMessageId) : undefined,
        });
        await this.sendBotMessage(user.id, chatId, res.text, res.keyboard);
        return;
      }

      if (['habit', 'daily habit'].includes(lower)) {
        await pool.query('DELETE FROM conversation_state WHERE user_id = $1', [user.id]);
        const res = await habitService.logHabit({
          userId: user.id,
          habitName: pendingTitle,
          value: 1,
          unit: 'times',
        });
        await this.sendBotMessage(user.id, chatId, res.formattedText);
        return;
      }

      if (['note', 'reference note'].includes(lower)) {
        await pool.query('DELETE FROM conversation_state WHERE user_id = $1', [user.id]);
        const res = await taskService.saveNote(user.id, pendingTitle, pendingTitle, ['reference'], undefined, dbMessageId ? Number(dbMessageId) : undefined);
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
          recurrence,
          userTimezone: user.timezone,
          defaultReminderTime: user.default_reminder_time,
          sourceMessageId: dbMessageId ? Number(dbMessageId) : undefined,
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
      await taskService.saveNote(user.id, text, 'Saved Thought', null, null, dbMessageId ? Number(dbMessageId) : undefined);
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
        await this.executeToolCall(user, chatId, call, dbMessageId ? Number(dbMessageId) : undefined);
      }
    } catch (err: any) {
      console.error('[UpdateDispatcher] LLM Pipeline Error:', err);
      // Fallback: Save as note in Degraded Mode
      await taskService.saveNote(user.id, text, 'Saved Thought', null, null, dbMessageId ? Number(dbMessageId) : undefined);
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
          category: call.args.category,
          userTimezone: user.timezone,
          defaultReminderTime: user.default_reminder_time,
          sourceMessageId: messageId,
        });
        await this.sendBotMessage(user.id, chatId, res.text, res.keyboard);
        break;
      }

      case 'create_list': {
        const res = await listService.createList(user.id, call.args.name);
        await this.sendBotMessage(
          user.id,
          chatId,
          `📁 <b>Created To-Do List:</b> <i>"${res.name}"</i>\n\nYou can add tasks to it anytime by saying:\n• <code>add [item] to my ${res.name} list</code>`,
          [[{ text: `📋 View ${res.name} List`, callback_data: `l:v:${res.name}` }]]
        );
        break;
      }

      case 'view_lists': {
        if (call.args.category) {
          const res = await listService.formatListItems(user.id, call.args.category);
          await this.sendBotMessage(user.id, chatId, res.text, res.keyboard);
        } else {
          const res = await listService.formatListsOverview(user.id);
          await this.sendBotMessage(user.id, chatId, res.text, res.keyboard);
        }
        break;
      }

      case 'complete_list': {
        const count = await listService.completeAllInList(user.id, call.args.category);
        if (count > 0) {
          await this.sendBotMessage(
            user.id,
            chatId,
            `🎉 <b>Completed All Items:</b> Marked ${count} task(s) in <i>"${call.args.category}"</i> as complete!`,
            [[{ text: '🔙 View All Lists', callback_data: 'l:back' }]]
          );
        } else {
          await this.sendBotMessage(
            user.id,
            chatId,
            `ℹ️ No open tasks found in <i>"${call.args.category}"</i> to complete.`
          );
        }
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
        const res = await taskService.saveNote(user.id, call.args.content, call.args.title, call.args.tags, call.args.url, messageId);
        await this.sendBotMessage(user.id, chatId, res.text, res.keyboard);
        break;
      }

      case 'append_note': {
        const res = await taskService.appendNote(user.id, call.args.target_note, call.args.content);
        await this.sendBotMessage(user.id, chatId, res.text);
        break;
      }

      case 'list_notes': {
        const res = await taskService.listNotes(user.id, call.args.tag);
        await this.sendBotMessage(user.id, chatId, res.text);
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

      case 'retract_command': {
        const item = call.args.cancelled_intent ? ` for "${call.args.cancelled_intent}"` : '';
        await this.sendBotMessage(
          user.id,
          chatId,
          `👌 Cancelled. I did not create that task${item}.`
        );
        break;
      }

      case 'log_habit': {
        const res = await habitService.logHabit({
          userId: user.id,
          habitName: call.args.habit_name,
          value: Number(call.args.value),
          unit: call.args.unit,
          notes: call.args.notes,
        });
        await this.sendBotMessage(user.id, chatId, res.formattedText);
        break;
      }

      case 'view_habits': {
        const res = await habitService.formatHabitStats(user.id, call.args.habit_name);
        await this.sendBotMessage(user.id, chatId, res.text);
        break;
      }

      case 'set_language': {
        const lang = call.args.language;
        await userRepo.setOutputLanguage(user.id, lang);
        await this.sendBotMessage(
          user.id,
          chatId,
          `🌐 <b>Language Updated!</b>\n\nI will now reply in <b>${lang}</b>. You can continue sending messages in any language!`
        );
        break;
      }

      case 'add_contact': {
        const res = await contactService.addContact({
          userId: user.id,
          name: call.args.name,
          phone: call.args.phone,
          email: call.args.email,
          telegramUsername: call.args.telegram_username,
        });
        await this.sendBotMessage(user.id, chatId, res.formattedText);
        break;
      }

      case 'list_contacts': {
        const res = await contactService.listContacts(user.id);
        await this.sendBotMessage(user.id, chatId, res.formattedText);
        break;
      }

      case 'search_contacts': {
        const c = await contactService.findContact(user.id, call.args.query);
        if (!c) {
          await this.sendBotMessage(
            user.id,
            chatId,
            `🔍 <b>Contact Not Found:</b> No contact found matching <i>"${call.args.query}"</i>.`
          );
        } else {
          let details = '';
          if (c.phone) details += `\n📞 <b>Phone:</b> <code>${c.phone}</code>`;
          if (c.email) details += `\n✉️ <b>Email:</b> ${c.email}`;
          if (c.telegramUsername) details += `\n💬 <b>Telegram:</b> @${c.telegramUsername}`;
          await this.sendBotMessage(user.id, chatId, `👤 <b>${c.name}</b>${details}`);
        }
        break;
      }

      case 'create_circle': {
        const res = await circleService.createCircle(user.id, call.args.name);
        await this.sendBotMessage(user.id, chatId, res.formattedText);
        break;
      }

      case 'show_circles': {
        const res = await circleService.listUserCircles(user.id);
        await this.sendBotMessage(user.id, chatId, res.formattedText);
        break;
      }

      case 'remind_circle': {
        const res = await circleService.broadcastCircleReminder(
          user,
          call.args.circle_name,
          call.args.text,
          call.args.remind_local
        );
        await this.sendBotMessage(user.id, chatId, res.formattedText);
        break;
      }

      case 'schedule_calendar_event': {
        const res = await calendarService.createEvent({
          userId: user.id,
          title: call.args.title,
          userTimezone: user.timezone,
          provider: call.args.provider,
          startLocal: call.args.start_local,
          endLocal: call.args.end_local,
          durationMinutes: call.args.duration_minutes,
          attendees: call.args.attendees,
          location: call.args.location,
          description: call.args.description,
          generateMeet: call.args.generate_meet,
        });
        await this.sendBotMessage(user.id, chatId, res.formattedText);
        break;
      }

      case 'view_calendar': {
        const res = await calendarService.listEvents(
          user.id,
          user.timezone,
          call.args.timeframe || 'WEEK',
          call.args.provider || 'ALL'
        );
        await this.sendBotMessage(user.id, chatId, res.formattedText);
        break;
      }

      case 'draft_email': {
        const res = await emailService.createDraft({
          userId: user.id,
          recipient: call.args.recipient,
          subject: call.args.subject,
          body: call.args.body,
        });
        await this.sendBotMessage(user.id, chatId, res.text, res.keyboard);
        break;
      }

      case 'send_email': {
        if (call.args.draft_id) {
          const res = await emailService.sendEmail(call.args.draft_id, user.id);
          await this.sendBotMessage(user.id, chatId, res.text);
        } else if (call.args.recipient && call.args.subject && call.args.body) {
          const { draft } = await emailService.createDraft({
            userId: user.id,
            recipient: call.args.recipient,
            subject: call.args.subject,
            body: call.args.body,
          });
          const res = await emailService.sendEmail(draft.id, user.id);
          await this.sendBotMessage(user.id, chatId, res.text);
        } else {
          await this.sendBotMessage(
            user.id,
            chatId,
            `⚠️ Please specify recipient, subject, and body to send an email.`
          );
        }
        break;
      }

      case 'list_email_drafts': {
        const res = await emailService.listDrafts(user.id);
        await this.sendBotMessage(user.id, chatId, res.text);
        break;
      }

      case 'upload_cloud_file': {
        const res = await driveService.uploadFile({
          userId: user.id,
          fileName: call.args.file_name,
          provider: call.args.provider,
          folderPath: call.args.folder_path,
        });
        await this.sendBotMessage(user.id, chatId, res.formattedText);
        break;
      }

      case 'search_cloud_files': {
        const res = await driveService.searchFiles(
          user.id,
          call.args.query,
          call.args.provider || 'ALL'
        );
        await this.sendBotMessage(user.id, chatId, res.formattedText);
        break;
      }

      case 'list_cloud_files': {
        const res = await driveService.listFiles(
          user.id,
          call.args.folder_path || '/FewFeww',
          call.args.provider || 'ALL'
        );
        await this.sendBotMessage(user.id, chatId, res.formattedText);
        break;
      }

      case 'ask_clarification': {
        if (call.args.disambiguation_type === 'TASK_OR_NOTE_OR_HABIT') {
          const itemTitle = call.args.pending_title || 'Item';
          await pool.query(
            `
            INSERT INTO conversation_state (user_id, kind, context, expires_at)
            VALUES ($1, 'CLARIFY_KIND', $2, now() + interval '10 minutes')
            ON CONFLICT (user_id) DO UPDATE
            SET kind = EXCLUDED.kind, context = EXCLUDED.context, expires_at = EXCLUDED.expires_at;
            `,
            [user.id, JSON.stringify({ pending_title: itemTitle, question: call.args.question })]
          );

          await this.sendBotMessage(
            user.id,
            chatId,
            `❓ <b>How would you like to track:</b> <i>"${itemTitle}"</i>?`,
            [
              [
                { text: '✅ To-Do Task', callback_data: `c:kind:task:${itemTitle}` },
                { text: '📊 Daily Habit', callback_data: `c:kind:habit:${itemTitle}` },
              ],
              [{ text: '📌 Reference Note', callback_data: `c:kind:note:${itemTitle}` }],
            ]
          );
          break;
        }

        const title = call.args.pending_title;
        if (title || call.args.reason === 'missing_schedule_time' || call.args.disambiguation_type === 'SCHEDULE_TIME') {
          const taskTitle = title || 'New Task';
          await pool.query(
            `
            INSERT INTO conversation_state (user_id, kind, context, expires_at)
            VALUES ($1, 'CLARIFY_TIME', $2, now() + interval '10 minutes')
            ON CONFLICT (user_id) DO UPDATE
            SET kind = EXCLUDED.kind, context = EXCLUDED.context, expires_at = EXCLUDED.expires_at;
            `,
            [user.id, JSON.stringify({ pending_title: taskTitle, question: call.args.question })]
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
          await pool.query(
            `
            INSERT INTO conversation_state (user_id, kind, context, expires_at)
            VALUES ($1, 'CLARIFY_GENERAL', $2, now() + interval '10 minutes')
            ON CONFLICT (user_id) DO UPDATE
            SET kind = EXCLUDED.kind, context = EXCLUDED.context, expires_at = EXCLUDED.expires_at;
            `,
            [user.id, JSON.stringify({ pending_title: call.args.pending_title || 'Item', question: call.args.question })]
          );
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
  ): Promise<string | null> {
    const res = await pool.query(
      `
      INSERT INTO messages (user_id, direction, telegram_message_id, kind, text)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
      `,
      [userId, direction, telegramMsgId || null, kind, text]
    );
    return res.rows[0]?.id ? String(res.rows[0].id) : null;
  }
}

export const dispatcher = new UpdateDispatcher();
