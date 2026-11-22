import { DateTime } from 'luxon';
import * as chrono from 'chrono-node';

export interface DateResolverOptions {
  timezone?: string;
  defaultReminderTime?: string; // HH:mm or HH:mm:ss, e.g. "09:00"
  referenceNow?: DateTime;
}

export type DateResolutionResult =
  | {
      kind: 'RESOLVED';
      utcDate: Date; // UTC Instant for Postgres
      localIso: string; // ISO string in user timezone
      timeIsExplicit: boolean;
      diffMinutesFromNow: number;
    }
  | {
      kind: 'NEEDS_CLARIFICATION';
      reason: 'in_the_past' | 'too_far' | 'ambiguous' | 'invalid_date';
      message: string;
    };

export class DateResolver {
  /**
   * Resolves a proposed date/time from the LLM or structured tool call according to the 10 Golden Rules.
   */
  resolveProposed(
    proposedStr: string | null | undefined,
    timeIsExplicit: boolean,
    opts: DateResolverOptions = {}
  ): DateResolutionResult {
    if (!proposedStr || proposedStr.trim() === '') {
      return {
        kind: 'NEEDS_CLARIFICATION',
        reason: 'ambiguous',
        message: 'No date or time was provided.',
      };
    }

    const zone = opts.timezone || 'Asia/Kolkata';
    const now = (opts.referenceNow || DateTime.now()).setZone(zone);
    const defaultTimeStr = opts.defaultReminderTime || '09:00';
    const [defH, defM] = defaultTimeStr.split(':').map((s) => parseInt(s, 10));

    let parsed = DateTime.fromISO(proposedStr.trim(), { zone });

    if (!parsed.isValid) {
      // Fallback: try parsing SQL or common formats
      parsed = DateTime.fromSQL(proposedStr.trim(), { zone });
    }

    if (!parsed.isValid) {
      // Fallback: try chrono natural parse
      return this.resolveNatural(proposedStr, opts);
    }

    // Rule 1: Date given, no explicit time -> Apply defaultReminderTime
    if (!timeIsExplicit) {
      parsed = parsed.set({
        hour: defH,
        minute: defM,
        second: 0,
        millisecond: 0,
      });
    }

    return this.validateAndFinalize(parsed, now, timeIsExplicit);
  }

  /**
   * Resolves natural text phrases (e.g. "Friday 6pm", "kal subah", "in 30 minutes", "at 5")
   * strictly adhering to the 10 deterministic rules.
   */
  resolveNatural(text: string, opts: DateResolverOptions = {}): DateResolutionResult {
    const zone = opts.timezone || 'Asia/Kolkata';
    const now = (opts.referenceNow || DateTime.now()).setZone(zone);
    const defaultTimeStr = opts.defaultReminderTime || '09:00';
    const [defH, defM] = defaultTimeStr.split(':').map((s) => parseInt(s, 10));

    const clean = text.trim();

    // Hinglish normalizer
    const normalized = clean
      .replace(/\bkal\s+subah\b/gi, 'tomorrow 9:00 am')
      .replace(/\bkal\s+shaam\b/gi, 'tomorrow 6:00 pm')
      .replace(/\bkal\s+dopahar\b/gi, 'tomorrow 3:00 pm')
      .replace(/\bkal\s+raat\b/gi, 'tomorrow 8:00 pm')
      .replace(/\bkal\b/gi, 'tomorrow')
      .replace(/\bparso\b/gi, 'day after tomorrow')
      .replace(/\baaj\b/gi, 'today')
      .replace(/\bsubah\b/gi, 'morning')
      .replace(/\bdopahar\b/gi, 'afternoon')
      .replace(/\bshaam\b/gi, 'evening')
      .replace(/\braat\b/gi, 'tonight');

    // Rule 7: Colloquial periods
    let targetTime: { hour: number; minute: number } | null = null;
    let explicitTime = false;

    if (/\bmorning\b/i.test(normalized)) {
      targetTime = { hour: 9, minute: 0 };
      explicitTime = true;
    } else if (/\bafternoon\b/i.test(normalized)) {
      targetTime = { hour: 15, minute: 0 };
      explicitTime = true;
    } else if (/\bevening\b/i.test(normalized)) {
      targetTime = { hour: 18, minute: 0 };
      explicitTime = true;
    } else if (/\btonight\b/i.test(normalized)) {
      targetTime = { hour: 20, minute: 0 };
      explicitTime = true;
    }

    // Rule 6: Bare hour 1 to 7 without am/pm ("at 5" -> 17:00, "at 9" -> 09:00)
    const bareHourMatch = normalized.match(/\bat\s+([1-9]|1[0-2])(?!\s*[:\d]|am|pm)\b/i);
    if (bareHourMatch && !targetTime) {
      const h = parseInt(bareHourMatch[1], 10);
      if (h >= 1 && h <= 7) {
        targetTime = { hour: h + 12, minute: 0 }; // 1-7 -> PM
      } else {
        targetTime = { hour: h, minute: 0 }; // 8-11 -> AM, 12 -> 12 PM
      }
      explicitTime = true;
    }

    // Chrono parse relative to user's timezone reference instant with forwardDate: true
    const parsedResults = chrono.parse(
      normalized,
      { instant: now.toJSDate(), timezone: now.offset },
      { forwardDate: true }
    );
    if (parsedResults.length === 0) {
      return {
        kind: 'NEEDS_CLARIFICATION',
        reason: 'ambiguous',
        message: `I couldn't clearly recognize a date or time in "${text}".`,
      };
    }

    const first = parsedResults[0];
    const components = first.start;

    const hasExplicitHour = components.isCertain('hour');
    const hasExplicitDay = components.isCertain('day') || components.isCertain('weekday');

    let resolvedDt = DateTime.fromJSDate(first.date(), { zone });

    // Rule 3: Bare weekday ("Friday") -> Next such day strictly after today, never today
    const bareWeekdayMatch = clean.match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i);
    if (bareWeekdayMatch) {
      while (resolvedDt <= now || resolvedDt.hasSame(now, 'day')) {
        resolvedDt = resolvedDt.plus({ days: 7 });
      }
    }

    // Apply colloquial period override if detected
    if (targetTime) {
      resolvedDt = resolvedDt.set(targetTime);
      explicitTime = true;
    } else if (hasExplicitHour) {
      explicitTime = true;
      // Rule 6 fallback for chrono if it didn't specify meridiem for hour 1-7
      if (!components.isCertain('meridiem') && resolvedDt.hour >= 1 && resolvedDt.hour <= 7) {
        resolvedDt = resolvedDt.set({ hour: resolvedDt.hour + 12 });
      }
    } else {
      // Rule 1: Date given, no time -> Apply user's default reminder time
      resolvedDt = resolvedDt.set({
        hour: defH,
        minute: defM,
        second: 0,
        millisecond: 0,
      });
      explicitTime = false;
    }

    // Rule 2: Time given, no date ("at 4pm") -> Next occurrence in future
    if (hasExplicitHour && !hasExplicitDay && !/\btomorrow\b|\byesterday\b|\bkal\b/i.test(clean)) {
      if (resolvedDt < now) {
        resolvedDt = resolvedDt.plus({ days: 1 });
      }
    }

    return this.validateAndFinalize(resolvedDt, now, explicitTime);
  }

  /**
   * Enforces Rule 8 (past time), Rule 9 (>2 years), and Rule 10 (UTC conversion).
   */
  private validateAndFinalize(target: DateTime, now: DateTime, timeIsExplicit: boolean): DateResolutionResult {
    // 1-minute grace period for network jitter
    const diffMin = target.diff(now, 'minutes').minutes;
    if (diffMin < -1.0) {
      return {
        kind: 'NEEDS_CLARIFICATION',
        reason: 'in_the_past',
        message: 'That date/time has already passed. When would you prefer?',
      };
    }

    // Rule 9: Max 2 years in future
    if (target > now.plus({ years: 2 })) {
      return {
        kind: 'NEEDS_CLARIFICATION',
        reason: 'too_far',
        message: 'That date is more than 2 years in the future. Please double-check the year.',
      };
    }

    // Rule 10: Convert to UTC Instant and formatted Local ISO
    return {
      kind: 'RESOLVED',
      utcDate: target.toUTC().toJSDate(),
      localIso: target.toISO() || target.toString(),
      timeIsExplicit,
      diffMinutesFromNow: Math.round(diffMin),
    };
  }
}

export const dateResolver = new DateResolver();
