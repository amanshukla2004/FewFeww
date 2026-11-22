import { pool } from '../db/pool.js';
import { userRepo } from '../db/user.repo.js';
import { telegram, TelegramClient, TelegramButton } from './telegram.client.js';
import { nudgePolicy, ReminderRecord } from './nudge.policy.js';
import { nudgeService } from './nudge.service.js';

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

      if (r.nudge_stage === 1) {
        text = `💬 <b>Follow-up:</b> Still planning to do <i>"${taskTitle}"</i>?`;
        keyboard = [
          [
            { text: '✅ Done', callback_data: `r:done:${r.id}` },
            { text: '☀️ Tomorrow', callback_data: `r:tom:${r.id}` },
          ],
          [{ text: '🗑 Drop', callback_data: `r:drop:${r.id}` }],
        ];
      } else if (r.nudge_stage === 3) {
        text = `⚠️ <b>3-Day Check-in:</b> <i>"${taskTitle}"</i> has been open for 3 days. Reschedule or drop?`;
        keyboard = [
          [
            { text: '☀️ Tomorrow', callback_data: `r:tom:${r.id}` },
            { text: '🗑 Drop', callback_data: `r:drop:${r.id}` },
          ],
          [{ text: '👌 Keep', callback_data: `r:keep:${r.id}` }],
        ];
      } else if (r.nudge_stage === 4) {
        text = `📦 <b>Archive Suggestion:</b> <i>"${taskTitle}"</i> has been open for 7 days. Want me to archive this task?`;
        keyboard = [
          [
            { text: '🗑 Archive/Drop', callback_data: `r:drop:${r.id}` },
            { text: '👌 Keep', callback_data: `r:keep:${r.id}` },
          ],
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
