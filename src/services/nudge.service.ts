import { pool } from '../db/pool.js';
import { ReminderRecord } from './nudge.policy.js';
import { TelegramButton } from './telegram.client.js';

export class NudgeService {
  /**
   * Automatically schedules the next stage in the 5-Stage Nudge Ladder
   */
  async scheduleNextStage(r: ReminderRecord): Promise<void> {
    let nextStage: number | null = null;
    let delayMs = 0;

    switch (r.nudge_stage) {
      case 0:
        // Stage 1 (Reality Check): +15 minutes after initial reminder
        nextStage = 1;
        delayMs = 15 * 60 * 1000;
        break;
      case 1:
        // Stage 2 (Friction Reducer): +30 minutes after Stage 1 (+45 mins overdue)
        nextStage = 2;
        delayMs = 30 * 60 * 1000;
        break;
      case 2:
        // Stage 3 (Timebox Sprint choice): +2 hours after Stage 2 (~3 hours overdue)
        nextStage = 3;
        delayMs = 2 * 60 * 60 * 1000;
        break;
      case 3:
        // Stage 4 (End of Day Graceful Drop): +5 hours after Stage 3 (End of day)
        nextStage = 4;
        delayMs = 5 * 60 * 60 * 1000;
        break;
      default:
        // Stage 4 is the final stage
        return;
    }

    const fireAt = new Date(Date.now() + delayMs);

    await pool.query(
      `
      INSERT INTO reminders (user_id, task_id, kind, nudge_stage, fire_at, status)
      VALUES ($1, $2, 'NUDGE', $3, $4, 'SCHEDULED')
      `,
      [r.user_id, r.task_id, nextStage, fireAt]
    );
  }

  /**
   * Anti-Annoyance Circuit Breaker:
   * Checks if user has ignored 3 consecutive nudges.
   */
  async shouldTriggerCircuitBreaker(userId: string): Promise<boolean> {
    const res = await pool.query(
      `
      SELECT status, acked_at
      FROM reminders
      WHERE user_id = $1 AND kind = 'NUDGE' AND status IN ('SENT', 'ACKED')
      ORDER BY sent_at DESC
      LIMIT 3;
      `,
      [userId]
    );

    if ((res.rowCount ?? 0) < 3) return false;
    return res.rows.every((row) => row.status === 'SENT' && !row.acked_at);
  }

  getCircuitBreakerMessage(): { text: string; keyboard: TelegramButton[][] } {
    return {
      text: `🔔 <b>Notice:</b> You have a few unacknowledged reminders. Would you prefer fewer follow-up nudges or a temporary pause?`,
      keyboard: [
        [
          { text: '⏸ Pause for 3 Days', callback_data: 'pause:3' },
          { text: '👌 Keep Current Settings', callback_data: 'cfg:keep' },
        ],
      ],
    };
  }

  /**
   * Cancels all scheduled reminders & nudges when a task is completed, dropped, or rescheduled.
   */
  async cancelTaskReminders(taskId: string): Promise<void> {
    await pool.query(
      `
      UPDATE reminders
      SET status = 'CANCELLED'
      WHERE task_id = $1 AND status = 'SCHEDULED'
      `,
      [taskId]
    );
  }
}

export const nudgeService = new NudgeService();
