import { User, userRepo } from '../db/user.repo.js';
import { TelegramClient, telegram, TelegramButton } from './telegram.client.js';

export class OnboardingService {
  constructor(private tg: TelegramClient = telegram) {}

  async startOnboarding(user: User): Promise<{ text: string; keyboard: TelegramButton[][] }> {
    await userRepo.setOnboardingState(user.id, 'AWAITING_CONSENT');

    const text =
      `👋 <b>Welcome to FewFeww!</b>\n\n` +
      `I am your personal follow-through assistant. Forward me class announcements, project deadlines, or quick thoughts, and I'll make sure you get them done.\n\n` +
      `🔒 <b>Privacy First:</b> Your data is private and secure. You can export or delete all your data at any time via /export or /deleteme.\n\n` +
      `Tap below to agree to terms and get started:`;

    const keyboard: TelegramButton[][] = [
      [{ text: '✅ I Agree & Continue', callback_data: 'ob:consent' }],
    ];

    return { text, keyboard };
  }

  async handleConsent(user: User): Promise<{ text: string; keyboard: TelegramButton[][] }> {
    const updated = await userRepo.setConsent(user.id);

    const text =
      `🌐 <b>What is your timezone?</b>\n\n` +
      `This ensures your reminders, digests, and quiet hours match your exact local clock.`;

    const keyboard: TelegramButton[][] = [
      [{ text: '🇮🇳 Asia/Kolkata (IST)', callback_data: 'ob:tz:Asia/Kolkata' }],
      [{ text: '🌍 UTC', callback_data: 'ob:tz:UTC' }],
    ];

    return { text, keyboard };
  }

  async handleTimezone(user: User, tz: string): Promise<{ text: string; keyboard: TelegramButton[][] }> {
    const updated = await userRepo.setTimezone(user.id, tz);

    const text =
      `⏰ <b>Default Reminder Time</b>\n\n` +
      `When you set a task without a specific hour (e.g. <i>"submit report on Friday"</i>), when should I alert you?`;

    const keyboard: TelegramButton[][] = [
      [
        { text: '08:00 AM', callback_data: 'ob:time:08:00' },
        { text: '09:00 AM (Recommended)', callback_data: 'ob:time:09:00' },
        { text: '10:00 AM', callback_data: 'ob:time:10:00' },
      ],
    ];

    return { text, keyboard };
  }

  async handleDefaultTime(user: User, time: string): Promise<{ text: string; keyboard?: TelegramButton[][] }> {
    const updated = await userRepo.setDefaultReminderTime(user.id, time);

    const text =
      `🎉 <b>You're all set!</b>\n\n` +
      `FewFeww is now active and ready. Try sending or forwarding a message right now:\n\n` +
      `• <code>Submit DBMS assignment by Friday 6pm</code>\n` +
      `• <code>Buy milk kal subah</code>\n` +
      `• <code>Call Rohit in 30 minutes</code>\n\n` +
      `Type /help anytime to view all available commands.`;

    return { text };
  }

  getPendingStepPrompt(user: User): { text: string; keyboard?: TelegramButton[][] } {
    switch (user.onboarding_state) {
      case 'NEW':
      case 'AWAITING_CONSENT':
        return {
          text: `Please tap below to accept terms before sending tasks:`,
          keyboard: [[{ text: '✅ I Agree & Continue', callback_data: 'ob:consent' }]],
        };
      case 'AWAITING_TZ':
        return {
          text: `Please select your timezone first:`,
          keyboard: [
            [{ text: '🇮🇳 Asia/Kolkata (IST)', callback_data: 'ob:tz:Asia/Kolkata' }],
            [{ text: '🌍 UTC', callback_data: 'ob:tz:UTC' }],
          ],
        };
      case 'AWAITING_TIME':
        return {
          text: `Please select your default reminder time:`,
          keyboard: [
            [
              { text: '08:00 AM', callback_data: 'ob:time:08:00' },
              { text: '09:00 AM', callback_data: 'ob:time:09:00' },
              { text: '10:00 AM', callback_data: 'ob:time:10:00' },
            ],
          ],
        };
      default:
        return { text: `Your account is ready! Send any task or reminder.` };
    }
  }
}

export const onboardingService = new OnboardingService();
