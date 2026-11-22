import { pool } from '../db/pool.js';
import { userRepo, User } from '../db/user.repo.js';
import { telegram, TelegramClient } from './telegram.client.js';
import { nudgeService } from './nudge.service.js';
import { DateTime } from 'luxon';

export class CallbackRouter {
  constructor(private tg: TelegramClient = telegram) {}

  async handleCallback(cq: any): Promise<void> {
    const data: string = cq.data || '';
    const from = cq.from;
    const chatId = cq.message?.chat?.id || from.id;
    const messageId = cq.message?.message_id;

    // Acknowledge callback immediately to dismiss button spinner in client
    try {
      await this.tg.answerCallbackQuery(cq.id);
    } catch {
      // Ignored if expired
    }

    const { user } = await userRepo.findOrCreate(from.id, chatId, from.first_name, from.language_code);

    // 1. Reminder Action Callbacks (r:<action>:<reminderId>)
    if (data.startsWith('r:')) {
      const parts = data.split(':');
      const action = parts[1]; // done, snz1, snz3, tom, drop
      const reminderId = parts[2];

      await this.handleReminderAction(user, chatId, messageId, reminderId, action);
      return;
    }

    // 2. Pause Nudges Callbacks (pause:<days>)
    if (data.startsWith('pause:')) {
      const days = data.split(':')[1];
      await this.handlePauseAction(user, chatId, messageId, days);
      return;
    }

    // 3. Settings Keep Callbacks
    if (data === 'cfg:keep') {
      if (messageId) {
        await this.tg.editMessageText(chatId, messageId, '👌 Keeping your current notification settings.');
      }
      return;
    }
  }

  private async handleReminderAction(
    user: User,
    chatId: number | string,
    messageId: number | undefined,
    reminderId: string,
    action: string
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Fetch reminder and task
      const remRes = await client.query(
        `
        SELECT r.id, r.task_id, r.user_id, r.nudge_stage, t.title 
        FROM reminders r
        JOIN tasks t ON t.id = r.task_id
        WHERE r.id = $1 AND r.user_id = $2
        FOR UPDATE;
        `,
        [reminderId, user.id]
      );

      if (remRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return;
      }

      const r = remRes.rows[0];
      const taskId = String(r.task_id);
      const title = r.title;
      let replyText = '';

      switch (action) {
        case 'done': {
          // Mark task DONE
          await client.query(
            `UPDATE tasks SET status = 'DONE', completed_at = now(), updated_at = now() WHERE id = $1`,
            [taskId]
          );

          // Mark reminder ACKED
          await client.query(
            `UPDATE reminders SET status = 'ACKED', acked_at = now(), ack_action = 'DONE' WHERE id = $1`,
            [reminderId]
          );

          // Cancel any remaining nudges for this task
          await client.query(
            `UPDATE reminders SET status = 'CANCELLED' WHERE task_id = $1 AND status = 'SCHEDULED'`,
            [taskId]
          );

          // Log event
          await client.query(
            `INSERT INTO events (user_id, type, entity_type, entity_id) VALUES ($1, 'task_done', 'task', $2)`,
            [user.id, taskId]
          );

          replyText = `🎉 <b>Marked Done:</b> ${title}`;
          break;
        }

        case 'snz1': {
          // Snooze 1 hour
          const newFireAt = new Date(Date.now() + 60 * 60 * 1000);

          await client.query(
            `UPDATE reminders SET status = 'ACKED', acked_at = now(), ack_action = 'SNOOZE_1H' WHERE id = $1`,
            [reminderId]
          );

          // Cancel pending Stage 1 nudge so it doesn't double-fire
          await client.query(
            `UPDATE reminders SET status = 'CANCELLED' WHERE task_id = $1 AND status = 'SCHEDULED'`,
            [taskId]
          );

          // Insert snoozed reminder
          await client.query(
            `
            INSERT INTO reminders (user_id, task_id, kind, nudge_stage, fire_at, status)
            VALUES ($1, $2, 'USER', 0, $3, 'SCHEDULED')
            `,
            [user.id, taskId, newFireAt]
          );

          replyText = `⏳ <b>Snoozed for 1 hour:</b> ${title}`;
          break;
        }

        case 'tom': {
          // Reschedule for tomorrow morning
          const [defH, defM] = user.default_reminder_time.split(':').map((s) => parseInt(s, 10));
          const tomorrow = DateTime.now()
            .setZone(user.timezone)
            .plus({ days: 1 })
            .set({ hour: defH, minute: defM, second: 0, millisecond: 0 });

          const newFireAt = tomorrow.toUTC().toJSDate();

          await client.query(
            `UPDATE reminders SET status = 'ACKED', acked_at = now(), ack_action = 'TOMORROW' WHERE id = $1`,
            [reminderId]
          );

          await client.query(
            `UPDATE reminders SET status = 'CANCELLED' WHERE task_id = $1 AND status = 'SCHEDULED'`,
            [taskId]
          );

          // Update task due_at
          await client.query(`UPDATE tasks SET due_at = $2, updated_at = now() WHERE id = $1`, [taskId, newFireAt]);

          // Insert new reminder
          await client.query(
            `
            INSERT INTO reminders (user_id, task_id, kind, nudge_stage, fire_at, status)
            VALUES ($1, $2, 'USER', 0, $3, 'SCHEDULED')
            `,
            [user.id, taskId, newFireAt]
          );

          replyText = `☀️ <b>Rescheduled for tomorrow (${tomorrow.toFormat('hh:mm a')}):</b> ${title}`;
          break;
        }

        case 'drop': {
          // Drop task
          await client.query(
            `UPDATE tasks SET status = 'DROPPED', updated_at = now() WHERE id = $1`,
            [taskId]
          );

          await client.query(
            `UPDATE reminders SET status = 'ACKED', acked_at = now(), ack_action = 'DROP' WHERE id = $1`,
            [reminderId]
          );

          await client.query(
            `UPDATE reminders SET status = 'CANCELLED' WHERE task_id = $1 AND status = 'SCHEDULED'`,
            [taskId]
          );

          replyText = `🗑 <b>Dropped task:</b> ${title}`;
          break;
        }

        case 'keep': {
          await client.query(
            `UPDATE reminders SET status = 'ACKED', acked_at = now(), ack_action = 'KEEP' WHERE id = $1`,
            [reminderId]
          );

          replyText = `👌 <b>Keeping task open:</b> ${title}`;
          break;
        }

        default:
          replyText = `Action ${action} executed.`;
          break;
      }

      await client.query('COMMIT');

      // Update message text in Telegram
      if (messageId) {
        await this.tg.editMessageText(chatId, messageId, replyText);
      } else {
        await this.tg.sendMessage(chatId, replyText);
      }

      // Check anti-annoyance circuit breaker
      const shouldPrompt = await nudgeService.shouldTriggerCircuitBreaker(user.id);
      if (shouldPrompt) {
        const breaker = nudgeService.getCircuitBreakerMessage();
        await this.tg.sendMessage(chatId, breaker.text, breaker.keyboard);
      }
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async handlePauseAction(
    user: User,
    chatId: number | string,
    messageId: number | undefined,
    days: string
  ): Promise<void> {
    let pauseUntil: Date | null = null;
    let label = '';

    if (days === '1') {
      pauseUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
      label = '1 day';
    } else if (days === '3') {
      pauseUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      label = '3 days';
    } else {
      pauseUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      label = 'indefinitely';
    }

    await pool.query(
      `
      UPDATE users 
      SET nudges_paused_until = $2, updated_at = now() 
      WHERE id = $1
      `,
      [user.id, pauseUntil]
    );

    const msg = `⏸ Follow-up nudges paused for <b>${label}</b>. (Explicit reminders you create will still fire).`;
    if (messageId) {
      await this.tg.editMessageText(chatId, messageId, msg);
    } else {
      await this.tg.sendMessage(chatId, msg);
    }
  }
}

export const callbackRouter = new CallbackRouter();
