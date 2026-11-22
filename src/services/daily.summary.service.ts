import { pool } from '../db/pool.js';
import { User, userRepo } from '../db/user.repo.js';
import { telegram, TelegramClient } from './telegram.client.js';
import { DateTime } from 'luxon';

export interface SummaryConfigOptions {
  enabled?: boolean;
  morningTime?: string;
  eveningTime?: string;
  summaryType?: 'MORNING' | 'EVENING' | 'BOTH';
}

export class DailySummaryService {
  constructor(private tg: TelegramClient = telegram) {}

  /**
   * Configures summary preferences (enable/disable, custom times, type)
   */
  async configure(userId: string, opts: SummaryConfigOptions): Promise<{ user: User; formattedText: string }> {
    const user = await userRepo.findById(userId);
    if (!user) throw new Error(`User ${userId} not found`);

    let morningEnabled = user.morning_plan_enabled;
    let eveningEnabled = user.evening_checkin_enabled;
    let morningTime = user.morning_plan_time || '08:30';
    let eveningTime = (user as any).evening_checkin_time || '20:00';
    let summaryType = (user as any).daily_summary_type || 'MORNING';

    if (opts.enabled !== undefined) {
      if (opts.summaryType === 'EVENING') {
        eveningEnabled = opts.enabled;
      } else if (opts.summaryType === 'BOTH') {
        morningEnabled = opts.enabled;
        eveningEnabled = opts.enabled;
      } else {
        morningEnabled = opts.enabled;
      }
    }

    if (opts.summaryType) {
      summaryType = opts.summaryType;
      if (summaryType === 'EVENING') {
        eveningEnabled = true;
      } else if (summaryType === 'BOTH') {
        morningEnabled = true;
        eveningEnabled = true;
      }
    }

    if (opts.morningTime) {
      morningTime = opts.morningTime;
      morningEnabled = true;
    }

    if (opts.eveningTime) {
      eveningTime = opts.eveningTime;
      eveningEnabled = true;
    }

    const res = await pool.query(
      `
      UPDATE users
      SET morning_plan_enabled = $2,
          morning_plan_time = $3,
          evening_checkin_enabled = $4,
          evening_checkin_time = $5,
          daily_summary_type = $6,
          updated_at = now()
      WHERE id = $1
      RETURNING *;
      `,
      [userId, morningEnabled, morningTime, eveningEnabled, eveningTime, summaryType]
    );

    const updatedUser = res.rows[0];

    const isEnabled = morningEnabled || eveningEnabled;
    const formattedText = [
      `⚙️ <b>Daily Summary Preferences Updated!</b>`,
      ``,
      `• <b>Status:</b> ${isEnabled ? '✅ Enabled' : '⏸️ Disabled'}`,
      `• <b>Mode:</b> ${summaryType}`,
      `• <b>Morning Brief:</b> ${morningEnabled ? `⏰ ${morningTime}` : '⏸️ Off'}`,
      `• <b>Evening Recap:</b> ${eveningEnabled ? `🌙 ${eveningTime}` : '⏸️ Off'}`,
      ``,
      `<i>You can ask me anytime: "show my summary", "disable daily summary", or "change summary time to 8 PM".</i>`,
    ].join('\n');

    return { user: updatedUser, formattedText };
  }

  /**
   * Builds an instant or scheduled daily summary combining tasks, habits, and meetings
   */
  async buildSummary(user: User, mode: 'MORNING' | 'EVENING' | 'INSTANT' = 'INSTANT'): Promise<string> {
    const name = user.first_name || 'there';
    const nowLocal = DateTime.now().setZone(user.timezone);
    const todayDate = nowLocal.toISODate();

    // 1. Overdue tasks
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

    // 2. Today's pending tasks
    const todayRes = await pool.query(
      `
      SELECT id, title, due_at, due_has_time
      FROM tasks
      WHERE user_id = $1 AND status = 'OPEN'
        AND (due_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date
      ORDER BY due_at ASC;
      `,
      [user.id, user.timezone]
    );

    // 3. Completed tasks today
    const completedRes = await pool.query(
      `
      SELECT id, title, completed_at
      FROM tasks
      WHERE user_id = $1 AND status = 'COMPLETED'
        AND (completed_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date
      ORDER BY completed_at DESC
      LIMIT 5;
      `,
      [user.id, user.timezone]
    );

    // 4. Habits logged today
    const habitRes = await pool.query(
      `
      SELECT h.name, hl.value, h.unit
      FROM habit_logs hl
      JOIN habits h ON hl.habit_id = h.id
      WHERE hl.user_id = $1
        AND (hl.logged_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date
      ORDER BY hl.logged_at DESC;
      `,
      [user.id, user.timezone]
    );

    // 5. Today's calendar events
    const calRes = await pool.query(
      `
      SELECT title, start_time, meet_url, provider
      FROM calendar_events
      WHERE user_id = $1
        AND (start_time AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date
      ORDER BY start_time ASC;
      `,
      [user.id, user.timezone]
    );

    const titlePrefix =
      mode === 'MORNING'
        ? `☀️ <b>Good Morning, ${name}! Here is your Day Brief:</b>`
        : mode === 'EVENING'
        ? `🌙 <b>Good Evening, ${name}! Here is your Daily Recap:</b>`
        : `📊 <b>Daily Summary for ${name} (${nowLocal.toFormat('dd LLL yyyy')}):</b>`;

    const sections: string[] = [titlePrefix, ''];

    // Overdue items
    if ((overdueRes.rowCount ?? 0) > 0) {
      sections.push(`⚠️ <b>Overdue Items (${overdueRes.rowCount}):</b>`);
      overdueRes.rows.forEach((t) => {
        const timeStr = DateTime.fromJSDate(t.due_at).setZone(user.timezone).toFormat('dd LLL, hh:mm a');
        sections.push(`• <b>${t.title}</b> (was due ${timeStr})`);
      });
      sections.push('');
    }

    // Today's Agenda
    if ((todayRes.rowCount ?? 0) > 0) {
      sections.push(`📌 <b>Pending Today (${todayRes.rowCount}):</b>`);
      todayRes.rows.forEach((t) => {
        let timeStr = 'Today';
        if (t.due_has_time && t.due_at) {
          timeStr = DateTime.fromJSDate(t.due_at).setZone(user.timezone).toFormat('hh:mm a');
        }
        sections.push(`• <b>${timeStr}</b> — ${t.title}`);
      });
      sections.push('');
    }

    // Completed today
    if ((completedRes.rowCount ?? 0) > 0) {
      sections.push(`✅ <b>Completed Today (${completedRes.rowCount}):</b>`);
      completedRes.rows.forEach((t) => {
        sections.push(`• <s>${t.title}</s>`);
      });
      sections.push('');
    }

    // Habits logged
    if ((habitRes.rowCount ?? 0) > 0) {
      sections.push(`📈 <b>Habits & Metrics Logged:</b>`);
      habitRes.rows.forEach((h) => {
        sections.push(`• <b>${h.name}:</b> ${h.value} ${h.unit || ''}`);
      });
      sections.push('');
    }

    // Calendar events
    if ((calRes.rowCount ?? 0) > 0) {
      sections.push(`📅 <b>Today's Meetings:</b>`);
      calRes.rows.forEach((c) => {
        const tStr = DateTime.fromJSDate(c.start_time).setZone(user.timezone).toFormat('hh:mm a');
        const link = c.meet_url ? ` (<a href="${c.meet_url}">Join</a>)` : '';
        sections.push(`• <b>${tStr}</b>: ${c.title}${link}`);
      });
      sections.push('');
    }

    if (sections.length <= 2) {
      sections.push(`✨ No tasks, habits, or meetings recorded for today! You're completely free.`);
    } else {
      sections.push(`<i>Ask me to "add a task", "log weight", or "schedule a meeting" anytime!</i>`);
    }

    return sections.join('\n').trim();
  }
}

export const dailySummaryService = new DailySummaryService();
