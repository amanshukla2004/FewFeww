import { User } from '../db/user.repo.js';
import { onboardingService } from './onboarding.service.js';
import { TelegramButton } from './telegram.client.js';
import { morningDigest } from './morning.digest.js';
import { privacyService } from './privacy.service.js';
import { contactService } from './contact.service.js';
import { circleService } from './circle.service.js';
import { calendarService } from './calendar.service.js';
import { momService } from './mom.service.js';
import { dailySummaryService } from './daily.summary.service.js';

export interface CommandResponse {
  text: string;
  keyboard?: TelegramButton[][];
}

export class CommandRouter {
  async handleCommand(user: User, commandText: string): Promise<CommandResponse> {
    const parts = commandText.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = parts[1] || '';

    // Handle Deep-Link Circle Joins: /start join_<token>
    if (cmd === '/start' && arg.startsWith('join_')) {
      const joinRes = await circleService.joinCircleByToken(arg, user);
      if (user.onboarding_state !== 'ACTIVE') {
        const obStep = await onboardingService.startOnboarding(user);
        return {
          text: `${joinRes.formattedText}\n\n${obStep.text}`,
          keyboard: obStep.keyboard,
        };
      }
      return { text: joinRes.formattedText };
    }

    switch (cmd) {
      case '/start':
        if (user.onboarding_state !== 'ACTIVE') {
          return onboardingService.startOnboarding(user);
        }
        return {
          text:
            `👋 <b>Welcome back, ${user.first_name || 'friend'}!</b>\n\n` +
            `I'm active and tracking your tasks. Forward me a deadline message or type a task directly.\n\n` +
            `<b>Commands:</b>\n` +
            `• /today — View today's priorities\n` +
            `• /list — View upcoming 7-day schedule\n` +
            `• /contacts — View contact directory\n` +
            `• /circles — View circles & invite links\n` +
            `• /settings — Timezone, default time & quiet hours\n` +
            `• /pause — Pause nudges temporarily\n` +
            `• /help — Cheatsheet and tips`,
        };

      case '/help':
        return {
          text:
            `📖 <b>FewFeww Cheatsheet & Tips</b>\n\n` +
            `<b>1. Natural Date Parsing:</b>\n` +
            `• <i>"Submit DBMS assignment by Friday 6pm"</i>\n` +
            `• <i>"Buy groceries kal subah"</i> (Hinglish supported)\n` +
            `• <i>"Call mom in 45 minutes"</i>\n\n` +
            `<b>2. Forwarding Announcements:</b>\n` +
            `Forward any WhatsApp or Telegram class announcement directly to me. I'll extract deadlines automatically.\n\n` +
            `<b>3. Follow-Through Nudges:</b>\n` +
            `When a reminder fires, use the inline buttons:\n` +
            `[Done] • [Snooze 1h] • [Tomorrow] • [Drop]\n\n` +
            `<b>Commands:</b>\n` +
            `/today • /list • /settings • /pause • /export • /deleteme`,
        };

      case '/language':
        return {
          text: `🌐 <b>Preferred Output Language</b>\n\nCurrent: <b>${user.output_language || 'English'}</b>\n\nI can understand messages in any language, and I will always respond in your chosen language below:`,
          keyboard: [
            [
              { text: '🇬🇧 English', callback_data: 'cfg:lang:English' },
              { text: '🇮🇳 हिन्दी (Hindi)', callback_data: 'cfg:lang:Hindi' },
            ],
            [
              { text: '🗣️ Hinglish', callback_data: 'cfg:lang:Hinglish' },
              { text: '🇪🇸 Español', callback_data: 'cfg:lang:Spanish' },
            ],
          ],
        };

      case '/contacts': {
        const res = await contactService.listContacts(user.id);
        return { text: res.formattedText };
      }

      case '/circles': {
        const res = await circleService.listUserCircles(user.id);
        return { text: res.formattedText };
      }

      case '/calendar': {
        const res = await calendarService.listEvents(user.id, user.timezone, 'WEEK');
        return { text: res.formattedText };
      }

      case '/mom': {
        const res = await momService.activateMomMode(user.id);
        return { text: res.text };
      }

      case '/settings':
        return {
          text:
            `⚙️ <b>Your FewFeww Settings</b>\n\n` +
            `• <b>Language:</b> <code>${user.output_language || 'English'}</code>\n` +
            `• <b>Timezone:</b> <code>${user.timezone}</code>\n` +
            `• <b>Default Reminder Time:</b> <code>${user.default_reminder_time}</code>\n` +
            `• <b>Quiet Hours:</b> <code>${user.quiet_start} – ${user.quiet_end}</code>\n` +
            `• <b>Morning Plan:</b> ${user.morning_plan_enabled ? '✅ Enabled (08:30)' : '❌ Disabled'}\n` +
            `• <b>Follow-Through Nudges:</b> ${user.nudges_enabled ? '✅ Active' : '⏸ Paused'}\n\n` +
            `Tap below to update your preferences:`,
          keyboard: [
            [
              { text: '🗣️ Language', callback_data: 'cfg:lang_menu' },
              { text: '🌐 Timezone', callback_data: 'cfg:tz' },
            ],
            [
              { text: '⏰ Default Time', callback_data: 'cfg:time' },
              { text: '🌙 Quiet Hours', callback_data: 'cfg:quiet' },
            ],
            [
              { text: user.nudges_enabled ? '⏸ Pause Nudges' : '▶️ Resume Nudges', callback_data: 'cfg:toggle_nudge' },
            ],
          ],
        };

      case '/summary': {
        const text = await dailySummaryService.buildSummary(user, 'INSTANT');
        return { text };
      }

      case '/today': {
        const text = await morningDigest.buildTodaySummary(user);
        return { text };
      }

      case '/list': {
        const text = await morningDigest.buildUpcomingList(user);
        return { text };
      }

      case '/pause':
        return {
          text:
            `⏸ <b>Pause Proactive Nudges</b>\n\n` +
            `Need some quiet focus time? You can pause follow-up nudges. (Any explicit reminders you set will still fire).\n\n` +
            `Choose duration:`,
          keyboard: [
            [
              { text: '1 Day', callback_data: 'pause:1' },
              { text: '3 Days', callback_data: 'pause:3' },
              { text: 'Indefinitely', callback_data: 'pause:inf' },
            ],
          ],
        };

      case '/export': {
        await privacyService.exportAndSend(user, user.telegram_chat_id);
        return {
          text:
            `📦 <b>Data Export Complete</b>\n\n` +
            `Your complete account history, tasks, notes, and reminders have been uploaded as JSON and CSV files above.`,
        };
      }

      case '/deleteme':
        return {
          text:
            `⚠️ <b>Permanent Account Deletion</b>\n\n` +
            `Are you sure you want to permanently delete your account and all associated tasks, reminders, and history?\n\n` +
            `This action cannot be undone.`,
          keyboard: [
            [
              { text: '🚨 Yes, Delete Everything', callback_data: 'c:del_confirm' },
              { text: 'Cancel', callback_data: 'c:no' },
            ],
          ],
        };

      case '/feedback':
        return {
          text:
            `💬 <b>Send Founder Feedback</b>\n\n` +
            `Type your suggestion, bug report, or idea, and it will be sent directly to our team!`,
        };

      default:
        return {
          text: `Unknown command <code>${cmd}</code>. Type /help to see available commands.`,
        };
    }
  }
}

export const commandRouter = new CommandRouter();
