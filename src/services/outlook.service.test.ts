import { describe, it, expect, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { calendarService } from './calendar.service.js';
import { UpdateDispatcher } from './dispatcher.js';
import { pool } from '../db/pool.js';
import { userRepo } from '../db/user.repo.js';

describe('Outlook Calendar Sync & Teams Integration (Step 24)', () => {
  let testUserId: string;
  const testChatId = 7700998822;

  beforeEach(async () => {
    await pool.query('DELETE FROM calendar_events;');
    await pool.query('DELETE FROM users WHERE telegram_chat_id = $1;', [testChatId]);

    const { user } = await userRepo.findOrCreate(testChatId, testChatId, 'OutlookUser', 'en');
    testUserId = user.id;
  });

  it('schedules an event with Outlook provider and Microsoft Teams meeting link', async () => {
    const res = await calendarService.createEvent({
      userId: testUserId,
      title: 'Executive Sync',
      userTimezone: 'Asia/Kolkata',
      provider: 'OUTLOOK',
      durationMinutes: 45,
    });

    expect(res.event.title).toBe('Executive Sync');
    expect(res.event.provider).toBe('OUTLOOK');
    expect(res.event.meetUrl).toMatch(/^https:\/\/teams\.microsoft\.com\/l\/meetup-join\//);
    expect(res.formattedText).toContain('Outlook Calendar');
    expect(res.formattedText).toContain('Microsoft Teams');
    expect(res.formattedText).toContain('https://teams.microsoft.com');
  });

  it('filters events by provider (OUTLOOK vs GOOGLE vs ALL)', async () => {
    const tomorrow = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).toISO()!.slice(0, 19);

    // Create 1 Google event
    await calendarService.createEvent({
      userId: testUserId,
      title: 'Google Brainstorm',
      userTimezone: 'Asia/Kolkata',
      provider: 'GOOGLE',
      startLocal: tomorrow,
    });

    // Create 1 Outlook event
    await calendarService.createEvent({
      userId: testUserId,
      title: 'Outlook Strategy Review',
      userTimezone: 'Asia/Kolkata',
      provider: 'OUTLOOK',
      startLocal: tomorrow,
    });

    // Filter ALL
    const allEvents = await calendarService.listEvents(testUserId, 'Asia/Kolkata', 'WEEK', 'ALL');
    expect(allEvents.events.length).toBe(2);

    // Filter OUTLOOK only
    const outlookEvents = await calendarService.listEvents(testUserId, 'Asia/Kolkata', 'WEEK', 'OUTLOOK');
    expect(outlookEvents.events.length).toBe(1);
    expect(outlookEvents.events[0].title).toBe('Outlook Strategy Review');
    expect(outlookEvents.events[0].provider).toBe('OUTLOOK');

    // Filter GOOGLE only
    const googleEvents = await calendarService.listEvents(testUserId, 'Asia/Kolkata', 'WEEK', 'GOOGLE');
    expect(googleEvents.events.length).toBe(1);
    expect(googleEvents.events[0].title).toBe('Google Brainstorm');
    expect(googleEvents.events[0].provider).toBe('GOOGLE');
  });

  it('executes Outlook schedule and view tool calls via dispatcher', async () => {
    const user = await userRepo.findById(testUserId);
    expect(user).toBeDefined();

    const sentMessages: string[] = [];
    const mockTg: any = {
      sendMessage: async (_chatId: any, text: string) => {
        sentMessages.push(text);
        return { message_id: 1001 };
      },
    };

    const dispatcher = new UpdateDispatcher(mockTg);
    const tomorrow = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).toISO()!.slice(0, 19);

    // Call schedule_calendar_event tool with OUTLOOK provider
    await (dispatcher as any).executeToolCall(
      user!,
      testChatId,
      {
        name: 'schedule_calendar_event',
        args: {
          title: 'Quarterly Board Meeting',
          provider: 'OUTLOOK',
          start_local: tomorrow,
          duration_minutes: 60,
          location: 'HQ Boardroom 4A',
        },
      }
    );

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Quarterly Board Meeting');
    expect(sentMessages[0]).toContain('Outlook Calendar');
    expect(sentMessages[0]).toContain('Microsoft Teams');

    // Call view_calendar tool with OUTLOOK provider filter
    await (dispatcher as any).executeToolCall(
      user!,
      testChatId,
      {
        name: 'view_calendar',
        args: { timeframe: 'WEEK', provider: 'OUTLOOK' },
      }
    );

    expect(sentMessages.length).toBe(2);
    expect(sentMessages[1]).toContain('Quarterly Board Meeting');
    expect(sentMessages[1]).toContain('Outlook Calendar');
  });
});
