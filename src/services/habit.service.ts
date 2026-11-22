import { pool } from '../db/pool.js';
import { DateTime } from 'luxon';

export interface Habit {
  id: string;
  name: string;
  kind: string;
  unit: string | null;
  targetValue: number | null;
}

export interface HabitLogEntry {
  id: string;
  value: number;
  notes: string | null;
  loggedAt: Date;
}

export interface LogHabitResult {
  habitId: string;
  habitName: string;
  value: number;
  unit: string | null;
  delta: number | null;
  streak: number;
  weeklySum: number;
  formattedText: string;
}

export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
  notes?: string | null;
}

export class HabitService {
  async getOrCreateHabit(
    userId: string,
    name: string,
    unit?: string | null,
    kind = 'METRIC'
  ): Promise<Habit> {
    const cleanName = name.trim();
    const existing = await pool.query(
      `SELECT id, name, kind, unit, target_value FROM habits WHERE user_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
      [userId, cleanName]
    );

    if (existing.rowCount && existing.rowCount > 0) {
      const row = existing.rows[0];
      // Update unit if previously unset
      if (!row.unit && unit) {
        await pool.query(`UPDATE habits SET unit = $1 WHERE id = $2`, [unit.trim(), row.id]);
        row.unit = unit.trim();
      }
      return {
        id: String(row.id),
        name: row.name,
        kind: row.kind,
        unit: row.unit,
        targetValue: row.target_value ? Number(row.target_value) : null,
      };
    }

    const res = await pool.query(
      `
      INSERT INTO habits (user_id, name, kind, unit)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, kind, unit, target_value;
      `,
      [userId, cleanName, kind, unit ? unit.trim() : null]
    );

    const r = res.rows[0];
    return {
      id: String(r.id),
      name: r.name,
      kind: r.kind,
      unit: r.unit,
      targetValue: r.target_value ? Number(r.target_value) : null,
    };
  }

  async logHabit(params: {
    userId: string;
    habitName: string;
    value: number;
    unit?: string | null;
    notes?: string | null;
    loggedAt?: Date;
  }): Promise<LogHabitResult> {
    const { userId, habitName, value, unit, notes, loggedAt } = params;
    const habit = await this.getOrCreateHabit(userId, habitName, unit);

    // 1. Fetch previous log for delta calculation
    const prevRes = await pool.query(
      `
      SELECT value, logged_at
      FROM habit_logs
      WHERE user_id = $1 AND habit_id = $2
      ORDER BY logged_at DESC
      LIMIT 1;
      `,
      [userId, habit.id]
    );

    let delta: number | null = null;
    let prevFormatted = '';
    if (prevRes.rowCount && prevRes.rowCount > 0) {
      const prevVal = Number(prevRes.rows[0].value);
      delta = Number((value - prevVal).toFixed(2));
      const prevDate = DateTime.fromJSDate(prevRes.rows[0].logged_at).toFormat('dd LLL');
      if (delta > 0) {
        prevFormatted = ` (+${delta} since ${prevDate})`;
      } else if (delta < 0) {
        prevFormatted = ` (${delta} since ${prevDate})`;
      } else {
        prevFormatted = ` (same as ${prevDate})`;
      }
    }

    // 2. Insert new log
    const entryTime = loggedAt || new Date();
    await pool.query(
      `
      INSERT INTO habit_logs (user_id, habit_id, value, notes, logged_at)
      VALUES ($1, $2, $3, $4, $5);
      `,
      [userId, habit.id, value, notes || null, entryTime]
    );

    // 3. Compute Streak / Active Days (distinct days with logs)
    const streakRes = await pool.query(
      `
      SELECT COUNT(DISTINCT (logged_at AT TIME ZONE 'UTC')::date) as active_days
      FROM habit_logs
      WHERE user_id = $1 AND habit_id = $2;
      `,
      [userId, habit.id]
    );
    const streak = Number(streakRes.rows[0]?.active_days || 1);

    // 4. Compute 7-day rolling sum (e.g. total LeetCode problems or workout mins)
    const sumRes = await pool.query(
      `
      SELECT COALESCE(SUM(value), 0) as total_week
      FROM habit_logs
      WHERE user_id = $1 AND habit_id = $2
        AND logged_at >= now() - interval '7 days';
      `,
      [userId, habit.id]
    );
    const weeklySum = Number(sumRes.rows[0]?.total_week || value);

    // 5. Select appropriate icon
    const lowerName = habit.name.toLowerCase();
    let icon = '📊';
    if (lowerName.includes('weight') || lowerName.includes('weigh')) icon = '⚖️';
    else if (lowerName.includes('lc') || lowerName.includes('leetcode') || lowerName.includes('code')) icon = '💻';
    else if (lowerName.includes('water')) icon = '💧';
    else if (lowerName.includes('read') || lowerName.includes('book')) icon = '📚';
    else if (lowerName.includes('gym') || lowerName.includes('workout') || lowerName.includes('run')) icon = '🏃';

    const unitStr = habit.unit ? ` ${habit.unit}` : '';
    let text = `${icon} <b>Logged ${habit.name}:</b> ${value}${unitStr}${prevFormatted}\n`;

    if (lowerName.includes('weight')) {
      text += `📈 <i>Check your progress graph on the dashboard!</i> (Total entries: ${streak})`;
    } else if (lowerName.includes('lc') || lowerName.includes('leetcode')) {
      text += `🔥 <b>7-Day Total:</b> ${weeklySum} problems solved! Keep up the momentum!`;
    } else {
      text += `🔥 <b>Active Days:</b> ${streak} day(s) logged this month!`;
    }

    return {
      habitId: habit.id,
      habitName: habit.name,
      value,
      unit: habit.unit,
      delta,
      streak,
      weeklySum,
      formattedText: text,
    };
  }

  async getHabitTimeSeries(userId: string, habitName: string, days = 30): Promise<{
    habit: Habit;
    dataPoints: TimeSeriesPoint[];
  }> {
    const habit = await this.getOrCreateHabit(userId, habitName);
    const res = await pool.query(
      `
      SELECT value, notes, logged_at
      FROM habit_logs
      WHERE user_id = $1 AND habit_id = $2
        AND logged_at >= now() - ($3 || ' days')::interval
      ORDER BY logged_at ASC;
      `,
      [userId, habit.id, days]
    );

    const dataPoints: TimeSeriesPoint[] = res.rows.map((r) => ({
      timestamp: DateTime.fromJSDate(r.logged_at).toISO() || '',
      value: Number(r.value),
      notes: r.notes,
    }));

    return { habit, dataPoints };
  }

  async formatHabitStats(userId: string, habitName?: string): Promise<{ text: string }> {
    if (habitName) {
      const habit = await this.getOrCreateHabit(userId, habitName);
      const history = await this.getHabitTimeSeries(userId, habit.name, 14);

      if (history.dataPoints.length === 0) {
        return {
          text: `📊 <b>${habit.name}:</b> No entries logged yet! Tell me e.g. <i>"today my ${habit.name.toLowerCase()} is [value]"</i> to start tracking.`,
        };
      }

      const latest = history.dataPoints[history.dataPoints.length - 1];
      const unitStr = habit.unit ? ` ${habit.unit}` : '';
      let text = `📊 <b>${habit.name} Summary:</b>\n\n`;
      text += `• <b>Latest:</b> ${latest.value}${unitStr} (${DateTime.fromISO(latest.timestamp).toFormat('dd LLL, hh:mm a')})\n`;
      text += `• <b>Total Logs (14d):</b> ${history.dataPoints.length} check-ins\n\n`;
      text += `<b>Recent Entries:</b>\n`;

      const recent = history.dataPoints.slice(-5).reverse();
      for (const p of recent) {
        const d = DateTime.fromISO(p.timestamp).toFormat('dd LLL');
        text += `• ${d}: <b>${p.value}${unitStr}</b>${p.notes ? ` (<i>${p.notes}</i>)` : ''}\n`;
      }

      text += `\n📈 <i>View full interactive graphs on your web dashboard.</i>`;
      return { text };
    }

    // Overview of all habits
    const res = await pool.query(
      `
      SELECT 
        h.id, 
        h.name, 
        h.unit,
        (SELECT value FROM habit_logs hl WHERE hl.habit_id = h.id ORDER BY logged_at DESC LIMIT 1) as latest_val,
        (SELECT logged_at FROM habit_logs hl WHERE hl.habit_id = h.id ORDER BY logged_at DESC LIMIT 1) as latest_time,
        COUNT(hl.id) as log_count
      FROM habits h
      LEFT JOIN habit_logs hl ON hl.habit_id = h.id
      WHERE h.user_id = $1
      GROUP BY h.id, h.name, h.unit
      ORDER BY h.name ASC;
      `,
      [userId]
    );

    if (res.rowCount === 0) {
      return {
        text: `📊 <b>Your Habits & Tracked Metrics:</b>\n\nYou're not tracking any habits yet!\nTry saying:\n• <code>today my weight is 90</code>\n• <code>did 5 lc today</code>\n• <code>drank 2L water</code>`,
      };
    }

    let text = `📊 <b>Your Tracked Habits & Metrics:</b>\n\n`;
    for (const r of res.rows) {
      const unitStr = r.unit ? ` ${r.unit}` : '';
      const latest = r.latest_val !== null ? `${r.latest_val}${unitStr}` : 'None';
      text += `• <b>${r.name}:</b> ${latest} (${r.log_count} entries)\n`;
    }

    text += `\n<i>Reply "show my &lt;habit&gt; history" to see past trends.</i>`;
    return { text };
  }
}

export const habitService = new HabitService();
