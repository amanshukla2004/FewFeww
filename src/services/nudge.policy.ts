import { DateTime } from 'luxon';
import { User } from '../db/user.repo.js';

export interface ReminderRecord {
  id: string;
  user_id: string;
  task_id: string;
  kind: 'USER' | 'LEAD' | 'NUDGE';
  nudge_stage: number;
  fire_at: Date;
  status: string;
  attempt_count: number;
}

export class NudgePolicy {
  /**
   * Checks whether a message/nudge is allowed to be sent right now based on user's quiet hours
   * and proactive messaging caps.
   * Explicit USER reminders (kind === 'USER' && nudge_stage === 0) ALWAYS fire on time.
   * Proactive nudges (kind === 'NUDGE' or nudge_stage > 0) are held during quiet hours.
   */
  maySendNow(user: User, reminder: ReminderRecord, refNow?: DateTime): { allowed: boolean; nextAllowed?: DateTime } {
    // Explicit user-set reminders always fire on time
    if (reminder.kind === 'USER' && reminder.nudge_stage === 0) {
      return { allowed: true };
    }

    const now = (refNow || DateTime.now()).setZone(user.timezone);
    const [qStartH, qStartM] = user.quiet_start.split(':').map((s) => parseInt(s, 10));
    const [qEndH, qEndM] = user.quiet_end.split(':').map((s) => parseInt(s, 10));

    const quietStart = now.set({ hour: qStartH, minute: qStartM, second: 0, millisecond: 0 });
    let quietEnd = now.set({ hour: qEndH, minute: qEndM, second: 0, millisecond: 0 });

    // Handle overnight quiet hours (e.g. 22:00 to 07:00)
    let isQuiet = false;
    if (qStartH > qEndH) {
      if (now >= quietStart) {
        isQuiet = true;
        quietEnd = quietEnd.plus({ days: 1 });
      } else if (now < quietEnd) {
        isQuiet = true;
      }
    } else {
      isQuiet = now >= quietStart && now < quietEnd;
    }

    if (isQuiet) {
      return {
        allowed: false,
        nextAllowed: quietEnd,
      };
    }

    // Check user nudges pause status
    if (user.nudges_paused_until && new Date() < new Date(user.nudges_paused_until)) {
      return {
        allowed: false,
        nextAllowed: DateTime.fromJSDate(new Date(user.nudges_paused_until)).setZone(user.timezone),
      };
    }

    return { allowed: true };
  }
}

export const nudgePolicy = new NudgePolicy();
