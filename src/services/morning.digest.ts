import { pool } from '../db/pool.js';
import { User } from '../db/user.repo.js';
import { telegram, TelegramClient } from './telegram.client.js';
import { DateTime } from 'luxon';

export class MorningDigest {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(private tg: TelegramClient = telegram) {}

  start(intervalMs = 60000): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), intervalMs);
    console.log(`[MorningDigest] Poller started (interval: ${intervalMs}ms)`);
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
      return await this.checkAndSendDigests();
    } catch (err) {
      console.error('[MorningDigest] Error running digest check:', err);
      return 0;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Identifies active users whose local time passed morning_plan_time today
   */
  async getEligibleUsers(): Promise<User[]> {
    const res = await pool.query(
      `
      SELECT *
      FROM users
      WHERE status = 'ACTIVE'
        AND morning_plan_enabled = true
        AND (last_morning_plan_on IS NULL OR last_morning_plan_on < (now() AT TIME ZONE timezone)::date)
        AND (now() AT TIME ZONE timezone)::time >= morning_plan_time
        AND (now() AT TIME ZONE timezone)::time < morning_plan_time + interval '3 hours';
      `
    );

    return res.rows.map((r) => ({
      id: String(r.id),
      telegram_user_id: String(r.telegram_user_id),
      telegram_chat_id: String(r.telegram_chat_id),
      first_name: r.first_name,
      language_code: r.language_code,
      timezone: r.timezone,
      default_reminder_time: r.default_reminder_time,
      lead_minutes: r.lead_minutes,
      quiet_start: r.quiet_start,
      quiet_end: r.quiet_end,
      morning_plan_enabled: r.morning_plan_enabled,
      morning_plan_time: r.morning_plan_time,
      last_morning_plan_on: r.last_morning_plan_on,
      evening_checkin_enabled: r.evening_checkin_enabled,
      last_evening_on: r.last_evening_on,
      nudges_enabled: r.nudges_enabled,
      nudges_paused_until: r.nudges_paused_until,
      daily_proactive_cap: r.daily_proactive_cap,
      onboarding_state: r.onboarding_state,
      consented_at: r.consented_at,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  }

  async checkAndSendDigests(): Promise<number> {
    const users = await this.getEligibleUsers();
    let sentCount = 0;

    for (const user of users) {
      try {
        const text = await this.buildTodaySummary(user);
        await this.tg.sendMessage(user.telegram_chat_id, text);

        // Update last_morning_plan_on
        await pool.query(
          `
          UPDATE users
          SET last_morning_plan_on = (now() AT TIME ZONE timezone)::date,
              updated_at = now()
          WHERE id = $1
          `,
          [user.id]
        );

        // Record event
        await pool.query(
          `INSERT INTO events (user_id, type, entity_type) VALUES ($1, 'morning_plan_sent', 'digest')`,
          [user.id]
        );

        sentCount++;
      } catch (err) {
        console.error(`[MorningDigest] Failed sending digest to user ${user.id}:`, err);
      }
    }

    return sentCount;
  }

  /**
   * Generates the daily Morning Plan summary for a user
   */
  async buildTodaySummary(user: User): Promise<string> {
    const name = user.first_name || 'there';

    // 1. Overdue tasks (Stage 2 Nudge Ladder inclusion)
    const overdueRes = await pool.query(
      `
      SELECT id, title, due_at
      FROM tasks
      WHERE user_id = $1 AND status = 'OPEN' AND due_at < now()
      ORDER BY due_at ASC
      LIMIT 5;
      `,
      [user.id]
    );

    // 2. Today's tasks
    const todayRes = await pool.query(
      `
      SELECT id, title, due_at, due_has_time
      FROM tasks
      WHERE user_id = $1 AND status = 'OPEN'
        AND due_at >= now()
        AND (due_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date
      ORDER BY due_at ASC;
      `,
      [user.id, user.timezone]
    );

    // 3. No-deadline tasks (limit 3)
    const noDueRes = await pool.query(
      `
      SELECT id, title
      FROM tasks
      WHERE user_id = $1 AND status = 'OPEN' AND due_at IS NULL
      ORDER BY created_at DESC
      LIMIT 3;
      `,
      [user.id]
    );

    const hasItems = (overdueRes.rowCount ?? 0) > 0 || (todayRes.rowCount ?? 0) > 0 || (noDueRes.rowCount ?? 0) > 0;

    let text = `☀️ <b>Good morning, ${name}!</b>\n\n`;

    if (!hasItems) {
      text += `You have clear skies today — no tasks scheduled or overdue!\n\nForward a deadline or send a quick thought to add one.`;
      return text;
    }

    // Overdue Section (Stage 2 Nudge Ladder)
    if ((overdueRes.rowCount ?? 0) > 0) {
      text += `⚠️ <b>Overdue Items:</b>\n`;
      overdueRes.rows.forEach((t) => {
        const timeStr = DateTime.fromJSDate(t.due_at).setZone(user.timezone).toFormat('dd LLL, hh:mm a');
        text += `• <b>${t.title}</b> (was due ${timeStr})\n`;
      });
      text += `\n`;
    }

    // Today's Agenda
    if ((todayRes.rowCount ?? 0) > 0) {
      text += `📌 <b>Today's Agenda:</b>\n`;
      todayRes.rows.forEach((t) => {
        let timeStr = 'Today';
        if (t.due_has_time && t.due_at) {
          timeStr = DateTime.fromJSDate(t.due_at).setZone(user.timezone).toFormat('hh:mm a');
        }
        text += `• <b>${timeStr}</b> — ${t.title}\n`;
      });
      text += `\n`;
    }

    // Other Open Tasks
    if ((noDueRes.rowCount ?? 0) > 0) {
      text += `📝 <b>Other Open Items:</b>\n`;
      noDueRes.rows.forEach((t) => {
        text += `• ${t.title}\n`;
      });
      text += `\n`;
    }

    text += `Have a focused and productive day! Type /today or /list anytime.`;
    return text.trim();
  }

  /**
   * Generates upcoming 7-day schedule (/list)
   */
  async buildUpcomingList(user: User): Promise<string> {
    const res = await pool.query(
      `
      SELECT id, title, status, due_at, due_has_time
      FROM tasks
      WHERE user_id = $1 AND status = 'OPEN'
      ORDER BY due_at NULLS LAST, created_at DESC
      LIMIT 15;
      `,
      [user.id]
    );

    if (res.rowCount === 0) {
      return `📋 <b>Your Schedule:</b>\n\nNo open tasks right now! Send a message to schedule one.`;
    }

    let text = `📋 <b>Your Open Tasks (${res.rowCount}):</b>\n\n`;

    res.rows.forEach((t) => {
      let dueStr = '<i>(no deadline)</i>';
      if (t.due_at) {
        const isPast = new Date(t.due_at).getTime() < Date.now();
        const dateStr = DateTime.fromJSDate(t.due_at).setZone(user.timezone).toFormat('ccc, dd LLL (hh:mm a)');
        dueStr = isPast ? `⚠️ <i>overdue: ${dateStr}</i>` : `⏰ <i>${dateStr}</i>`;
      }
      text += `• <b>${t.title}</b> — ${dueStr}\n`;
    });

    return text.trim();
  }
}

export const morningDigest = new MorningDigest();
