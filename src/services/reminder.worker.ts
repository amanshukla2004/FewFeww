import { pool } from '../db/pool.js';
import { userRepo } from '../db/user.repo.js';
import { telegram, TelegramClient, TelegramButton } from './telegram.client.js';
import { nudgePolicy, ReminderRecord } from './nudge.policy.js';
import { nudgeService } from './nudge.service.js';
import { resilienceService } from './resilience.service.js';
import { DateTime } from 'luxon';

export class ReminderWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private backoffMinutes = [1, 5, 15, 60, 180];

  constructor(private tg: TelegramClient = telegram) {}

  start(intervalMs = 10000): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), intervalMs);
    console.log(`[ReminderWorker] Started poller (interval: ${intervalMs}ms)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<number> {
    if (this.isRunning) return 0;
    this.isRunning = true;

    try {
      const dueReminders = await this.claimDueReminders(25);
      for (const r of dueReminders) {
        await this.processReminder(r);
      }
      return dueReminders.length;
    } catch (err) {
      console.error('[ReminderWorker] Polling loop error:', err);
      return 0;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Atomic row claiming query using FOR UPDATE SKIP LOCKED
   */
  async claimDueReminders(limit = 25): Promise<ReminderRecord[]> {
    const res = await pool.query(
      `
      UPDATE reminders r
      SET status = 'SENDING', locked_at = now(), attempt_count = attempt_count + 1
      WHERE r.id IN (
        SELECT id FROM reminders
        WHERE status = 'SCHEDULED' AND fire_at <= now()
        ORDER BY fire_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *;
      `,
      [limit]
    );

    return res.rows.map((row) => ({
      id: String(row.id),
      user_id: String(row.user_id),
      task_id: String(row.task_id),
      kind: row.kind,
      nudge_stage: row.nudge_stage,
      fire_at: row.fire_at,
      status: row.status,
      attempt_count: row.attempt_count,
    }));
  }

  async processReminder(r: ReminderRecord): Promise<void> {
    try {
      const user = await userRepo.findById(r.user_id);
      if (!user || user.status !== 'ACTIVE') {
        await pool.query(`UPDATE reminders SET status = 'CANCELLED', last_error = 'user_inactive' WHERE id = $1`, [r.id]);
        return;
      }

      // Check Quiet Hours / Nudge Policy
      const check = nudgePolicy.maySendNow(user, r);
      if (!check.allowed && check.nextAllowed) {
        await pool.query(
          `UPDATE reminders SET status = 'SCHEDULED', fire_at = $2, locked_at = NULL WHERE id = $1`,
          [r.id, check.nextAllowed.toUTC().toJSDate()]
        );
        return;
      }

      // Fetch Task details
      const taskRes = await pool.query(`SELECT title FROM tasks WHERE id = $1`, [r.task_id]);
      const taskTitle = taskRes.rows[0]?.title || 'Your scheduled task';

      let text = `⏰ <b>Reminder:</b> ${taskTitle}`;
      let keyboard: TelegramButton[][] = [
        [
          { text: '✅ Done', callback_data: `r:done:${r.id}` },
          { text: '⏳ 1 Hour', callback_data: `r:snz1:${r.id}` },
        ],
        [
          { text: '☀️ Tomorrow', callback_data: `r:tom:${r.id}` },
          { text: '🗑 Drop', callback_data: `r:drop:${r.id}` },
        ],
      ];

      if (r.kind === 'CALL') {
        text = `🚨📞 <b>INCOMING CALL-ALERT RING!</b> 📞🚨\n\n🔔 <b>Wake-up / Immediate Action:</b> ${taskTitle}!\n<i>Ring time: ${DateTime.fromJSDate(r.fire_at).setZone(user.timezone).toFormat('hh:mm a')}</i>`;
        keyboard = [
          [
            { text: '📞 Answer / Done', callback_data: `r:done:${r.id}` },
            { text: '💤 Snooze 10m', callback_data: `r:snz10:${r.id}` },
          ],
          [
            { text: '☀️ Tomorrow', callback_data: `r:tom:${r.id}` },
            { text: '🗑 Drop', callback_data: `r:drop:${r.id}` },
          ],
        ];
      } else if (r.nudge_stage === 1) {
        text = `💬 <b>Reality Check:</b> Just checking in on <i>"${taskTitle}"</i> — did you finish it, or should we push it?`;
        keyboard = [
          [
            { text: '✅ Done', callback_data: `r:done:${r.id}` },
            { text: '⏳ 1 Hour', callback_data: `r:snz1:${r.id}` },
          ],
          [
            { text: '☀️ Tomorrow', callback_data: `r:tom:${r.id}` },
            { text: '🗑 Drop', callback_data: `r:drop:${r.id}` },
          ],
        ];
      } else if (r.nudge_stage === 2) {
        text = `⚡ <b>Friction Reducer:</b> Feeling resistance on <i>"${taskTitle}"</i>?\n\nLet's not worry about the whole task right now. Just do <b>Step 1 for 2 minutes</b> to break the inertia:\n👉 <i>Open the workspace / document and do the very first step.</i>`;
        keyboard = [
          [
            { text: '✅ Done', callback_data: `r:done:${r.id}` },
            { text: '⏳ 1 Hour', callback_data: `r:snz1:${r.id}` },
          ],
          [
            { text: '☀️ Tomorrow', callback_data: `r:tom:${r.id}` },
            { text: '🗑 Drop', callback_data: `r:drop:${r.id}` },
          ],
        ];
      } else if (r.nudge_stage === 3) {
        text = `⏱️ <b>Timebox Sprint:</b> <i>"${taskTitle}"</i> is still pending.\n\nWant to knock out a quick 15-minute sprint right now, or move it to this evening?`;
        keyboard = [
          [
            { text: '⏱️ 15m Sprint', callback_data: `r:sprint:${r.id}` },
            { text: '🌙 This Evening', callback_data: `r:eve:${r.id}` },
          ],
          [
            { text: '☀️ Tomorrow', callback_data: `r:tom:${r.id}` },
            { text: '🗑 Drop', callback_data: `r:drop:${r.id}` },
          ],
        ];
      } else if (r.nudge_stage === 4) {
        text = `🕊️ <b>Graceful Release:</b> <i>"${taskTitle}"</i> slipped today.\n\nLet's keep your mind clear and prevent to-do backlog debt. Do you want to push this to tomorrow, or drop it guilt-free?`;
        keyboard = [
          [
            { text: '📅 Tomorrow', callback_data: `r:tom:${r.id}` },
            { text: '🗑️ Drop Guilt-Free', callback_data: `r:drop:${r.id}` },
          ],
          [{ text: '✅ Done', callback_data: `r:done:${r.id}` }],
        ];
      }

      // Send to Telegram
      const sendRes = await this.tg.sendMessage(user.telegram_chat_id, text, keyboard);
      const tgMsgId = sendRes?.result?.message_id || null;

      // Mark SENT and log event
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `
          UPDATE reminders
          SET status = 'SENT', sent_at = now(), telegram_message_id = $2
          WHERE id = $1
          `,
          [r.id, tgMsgId]
        );

        await client.query(
          `
          INSERT INTO events (user_id, type, entity_type, entity_id, props)
          VALUES ($1, 'reminder_sent', 'reminder', $2, $3)
          `,
          [r.user_id, r.id, JSON.stringify({ nudge_stage: r.nudge_stage, kind: r.kind })]
        );

        // Schedule next stage in Nudge Ladder
        await nudgeService.scheduleNextStage(r);

        await client.query('COMMIT');
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.error(`[ReminderWorker] Failed processing reminder #${r.id}:`, err);

      // Handle user blocked the bot (HTTP 403 Forbidden)
      if (err?.message?.includes('403') || err?.message?.includes('bot was blocked by the user')) {
        await resilienceService.handleUserBlocked(r.user_id);
        return;
      }

      const backoffMin = this.backoffMinutes[Math.min(r.attempt_count - 1, this.backoffMinutes.length - 1)];
      const nextAttempt = new Date(Date.now() + backoffMin * 60 * 1000);

      const newStatus = r.attempt_count >= 5 ? 'FAILED' : 'SCHEDULED';
      await pool.query(
        `
        UPDATE reminders
        SET status = $2, fire_at = $3, last_error = $4, locked_at = NULL
        WHERE id = $1
        `,
        [r.id, newStatus, nextAttempt, err.message]
      );
    }
  }

  /**
   * 1-Minute Stuck Job Reaper un-sticking rows in SENDING with locked_at > 5 minutes
   */
  async reapStuckRows(): Promise<number> {
    const res = await pool.query(
      `
      UPDATE reminders
      SET status = 'SCHEDULED', locked_at = NULL
      WHERE status = 'SENDING' AND locked_at < now() - interval '5 minutes'
      RETURNING id;
      `
    );
    return res.rowCount || 0;
  }
}

export const reminderWorker = new ReminderWorker();
