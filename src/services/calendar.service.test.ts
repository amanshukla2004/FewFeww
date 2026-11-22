import { describe, it, expect, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { calendarService } from './calendar.service.js';
import { commandRouter } from './command.router.js';
import { UpdateDispatcher } from './dispatcher.js';
import { pool } from '../db/pool.js';
import { userRepo } from '../db/user.repo.js';

describe('Google Calendar & Meet Sync (Step 23)', () => {
  let testUserId: string;
  const testChatId = 7700889911;

  beforeEach(async () => {
    await pool.query('DELETE FROM calendar_events;');
    await pool.query('DELETE FROM users WHERE telegram_chat_id = $1;', [testChatId]);

    const { user } = await userRepo.findOrCreate(testChatId, testChatId, 'CalUser', 'en');
    testUserId = user.id;
  });

  it('schedules an event with default Google provider, Meet link, and 60m duration', async () => {
    const res = await calendarService.createEvent({
      userId: testUserId,
      title: 'Project Kickoff Meeting',
      userTimezone: 'Asia/Kolkata',
      generateMeet: true,
    });

    expect(res.event.title).toBe('Project Kickoff Meeting');
    expect(res.event.provider).toBe('GOOGLE');
    expect(res.event.meetUrl).toMatch(/^https:\/\/meet\.google\.com\/[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/);
    expect(res.formattedText).toContain('Project Kickoff Meeting');
    expect(res.formattedText).toContain('Google Calendar');
    expect(res.formattedText).toContain('https://meet.google.com/');
  });

  it('schedules an event with custom timeframe, location, and validated attendees', async () => {
    const res = await calendarService.createEvent({
      userId: testUserId,
      title: 'Sprint Planning',
      userTimezone: 'Asia/Kolkata',
      startLocal: '2026-12-01T14:00:00',
      endLocal: '2026-12-01T15:30:00',
      location: 'Conference Room B',
      description: 'Discuss Q1 Roadmap and deliverables',
      attendees: ['alice@example.com', 'invalid-email', 'BOB@WORK.COM'],
      generateMeet: true,
    });

    expect(res.event.title).toBe('Sprint Planning');
    expect(res.event.location).toBe('Conference Room B');
    expect(res.event.description).toBe('Discuss Q1 Roadmap and deliverables');
    expect(res.event.attendees).toEqual(['alice@example.com', 'bob@work.com']); // clean & lowercase, invalid removed
    expect(res.formattedText).toContain('Conference Room B');
    expect(res.formattedText).toContain('alice@example.com');
  });

  it('lists calendar events within timeframe and handles empty schedules', async () => {
    // Empty case
    const emptyRes = await calendarService.listEvents(testUserId, 'Asia/Kolkata', 'WEEK');
    expect(emptyRes.events.length).toBe(0);
    expect(emptyRes.formattedText).toContain('No events scheduled');

    // Add an event for today
    const startLocal = DateTime.now().setZone('Asia/Kolkata').plus({ hours: 1 }).toISO()!.slice(0, 19);
    await calendarService.createEvent({
      userId: testUserId,
      title: 'Daily Standup',
      userTimezone: 'Asia/Kolkata',
      startLocal,
    });

    const populatedRes = await calendarService.listEvents(testUserId, 'Asia/Kolkata', 'WEEK');
    expect(populatedRes.events.length).toBe(1);
    expect(populatedRes.formattedText).toContain('Daily Standup');
  });

  it('handles /calendar command via command router', async () => {
    const user = await userRepo.findById(testUserId);
    expect(user).toBeDefined();

    const cmdRes = await commandRouter.handleCommand(user!, '/calendar');
    expect(cmdRes.text).toContain('Calendar Schedule');
  });

  it('executes schedule_calendar_event and view_calendar tool calls via dispatcher', async () => {
    const user = await userRepo.findById(testUserId);
    expect(user).toBeDefined();

    const sentMessages: string[] = [];
    const mockTg: any = {
      sendMessage: async (_chatId: any, text: string) => {
        sentMessages.push(text);
        return { message_id: 999 };
      },
    };

    const dispatcher = new UpdateDispatcher(mockTg);

    // Call schedule_calendar_event tool
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 19);
    await (dispatcher as any).executeToolCall(
      user!,
      testChatId,
      {
        name: 'schedule_calendar_event',
        args: {
          title: 'Doctor Appointment',
          start_local: tomorrow,
          duration_minutes: 45,
          location: 'City Dental Clinic',
        },
      }
    );

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Doctor Appointment');
    expect(sentMessages[0]).toContain('City Dental Clinic');

    // Call view_calendar tool
    await (dispatcher as any).executeToolCall(
      user!,
      testChatId,
      {
        name: 'view_calendar',
        args: { timeframe: 'WEEK' },
      }
    );

    expect(sentMessages.length).toBe(2);
    expect(sentMessages[1]).toContain('Doctor Appointment');
  });
});
