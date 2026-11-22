import { pool } from '../db/pool.js';
import { DateTime } from 'luxon';
import crypto from 'crypto';

export interface CalendarEvent {
  id: string;
  userId: string;
  provider: 'GOOGLE' | 'OUTLOOK';
  title: string;
  description?: string | null;
  location?: string | null;
  startTime: Date;
  endTime: Date;
  attendees: string[];
  meetUrl?: string | null;
  createdAt: Date;
}

export interface CreateCalendarEventInput {
  userId: string;
  title: string;
  userTimezone: string;
  provider?: 'GOOGLE' | 'OUTLOOK';
  startLocal?: string;
  endLocal?: string;
  durationMinutes?: number;
  attendees?: string[];
  location?: string | null;
  description?: string | null;
  generateMeet?: boolean;
}

export class CalendarService {
  /**
   * Schedule a calendar event on Google or Outlook Calendar with Meet links and attendees.
   */
  async createEvent(
    input: CreateCalendarEventInput
  ): Promise<{ event: CalendarEvent; formattedText: string }> {
    const zone = input.userTimezone || 'Asia/Kolkata';
    const provider = input.provider || 'GOOGLE';
    const cleanTitle = input.title.trim();

    // Parse start time (default to tomorrow 10am if not specified)
    let startDt = input.startLocal
      ? DateTime.fromISO(input.startLocal, { zone })
      : DateTime.now().setZone(zone).plus({ days: 1 }).set({ hour: 10, minute: 0, second: 0 });

    if (!startDt.isValid) {
      startDt = DateTime.now().setZone(zone).plus({ days: 1 }).set({ hour: 10, minute: 0, second: 0 });
    }

    const durationMin = input.durationMinutes && input.durationMinutes > 0 ? input.durationMinutes : 60;

    let endDt = input.endLocal
      ? DateTime.fromISO(input.endLocal, { zone })
      : startDt.plus({ minutes: durationMin });

    if (!endDt.isValid || endDt <= startDt) {
      endDt = startDt.plus({ minutes: durationMin });
    }

    // Clean attendees
    const attendees = (input.attendees || [])
      .map((a) => a.trim().toLowerCase())
      .filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));

    // Generate Google Meet URL if requested
    let meetUrl: string | null = null;
    if (input.generateMeet || provider === 'GOOGLE') {
      const p1 = crypto.randomBytes(2).toString('hex').slice(0, 3);
      const p2 = crypto.randomBytes(2).toString('hex').slice(0, 4);
      const p3 = crypto.randomBytes(2).toString('hex').slice(0, 3);
      meetUrl = `https://meet.google.com/${p1}-${p2}-${p3}`;
    }

    const res = await pool.query(
      `
      INSERT INTO calendar_events (
        user_id, provider, title, description, location,
        start_time, end_time, attendees, meet_url
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, user_id, provider, title, description, location,
                start_time, end_time, attendees, meet_url, created_at;
      `,
      [
        input.userId,
        provider,
        cleanTitle,
        input.description || null,
        input.location || null,
        startDt.toUTC().toJSDate(),
        endDt.toUTC().toJSDate(),
        attendees,
        meetUrl,
      ]
    );

    const row = res.rows[0];
    const event: CalendarEvent = {
      id: String(row.id),
      userId: String(row.user_id),
      provider: row.provider,
      title: row.title,
      description: row.description,
      location: row.location,
      startTime: row.start_time,
      endTime: row.end_time,
      attendees: row.attendees || [],
      meetUrl: row.meet_url,
      createdAt: row.created_at,
    };

    const dateStr = startDt.toFormat('cccc, LLL dd, yyyy');
    const timeRange = `${startDt.toFormat('hh:mm a')} – ${endDt.toFormat('hh:mm a')}`;

    let details = '';
    if (event.location) details += `\n📍 <b>Location:</b> ${event.location}`;
    if (event.attendees.length > 0) details += `\n👥 <b>Attendees:</b> ${event.attendees.join(', ')}`;
    if (event.meetUrl) details += `\n📹 <b>Google Meet:</b> <a href="${event.meetUrl}">${event.meetUrl}</a>`;
    if (event.description) details += `\n📝 <b>Notes:</b> ${event.description}`;

    const formattedText =
      `📅 <b>Event Scheduled on ${provider === 'GOOGLE' ? 'Google' : 'Outlook'} Calendar</b>\n\n` +
      `📌 <b>${event.title}</b>\n` +
      `🗓 <b>Date:</b> ${dateStr}\n` +
      `⏰ <b>Time:</b> ${timeRange} (${zone})` +
      details;

    return { event, formattedText };
  }

  /**
   * List calendar events for a specific user and timeframe.
   */
  async listEvents(
    userId: string,
    userTimezone = 'Asia/Kolkata',
    timeframe: 'TODAY' | 'TOMORROW' | 'WEEK' = 'WEEK'
  ): Promise<{ events: CalendarEvent[]; formattedText: string }> {
    const zone = userTimezone;
    const now = DateTime.now().setZone(zone);

    let startRange: DateTime;
    let endRange: DateTime;

    if (timeframe === 'TODAY') {
      startRange = now.startOf('day');
      endRange = now.endOf('day');
    } else if (timeframe === 'TOMORROW') {
      startRange = now.plus({ days: 1 }).startOf('day');
      endRange = now.plus({ days: 1 }).endOf('day');
    } else {
      startRange = now.startOf('day');
      endRange = now.plus({ days: 7 }).endOf('day');
    }

    const res = await pool.query(
      `
      SELECT id, user_id, provider, title, description, location,
             start_time, end_time, attendees, meet_url, created_at
      FROM calendar_events
      WHERE user_id = $1 AND start_time >= $2 AND start_time <= $3
      ORDER BY start_time ASC;
      `,
      [userId, startRange.toUTC().toJSDate(), endRange.toUTC().toJSDate()]
    );

    const events: CalendarEvent[] = res.rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      provider: r.provider,
      title: r.title,
      description: r.description,
      location: r.location,
      startTime: r.start_time,
      endTime: r.end_time,
      attendees: r.attendees || [],
      meetUrl: r.meet_url,
      createdAt: r.created_at,
    }));

    if (events.length === 0) {
      return {
        events,
        formattedText: `📅 <b>Calendar Schedule:</b>\n\nNo events scheduled for ${timeframe.toLowerCase()}.\nSchedule one by saying: <i>"schedule a meeting tomorrow at 3 PM"</i>.`,
      };
    }

    let text = `📅 <b>Your Calendar Events (${timeframe}):</b>\n\n`;
    for (const ev of events) {
      const s = DateTime.fromJSDate(ev.startTime).setZone(zone);
      const e = DateTime.fromJSDate(ev.endTime).setZone(zone);
      text += `• <b>${ev.title}</b> [${ev.provider === 'GOOGLE' ? 'Google' : 'Outlook'}]\n`;
      text += `  ⏰ ${s.toFormat('ccc, LLL dd • hh:mm a')} – ${e.toFormat('hh:mm a')}\n`;
      if (ev.location) text += `  📍 ${ev.location}\n`;
      if (ev.meetUrl) text += `  📹 ${ev.meetUrl}\n`;
      text += '\n';
    }

    return { events, formattedText: text.trim() };
  }
}

export const calendarService = new CalendarService();
