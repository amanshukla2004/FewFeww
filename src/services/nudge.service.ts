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
        // Stage 1: 2 hours after initial reminder
        nextStage = 1;
        delayMs = 2 * 60 * 60 * 1000;
        break;
      case 1:
        // Stage 3: 3 days after task creation
        nextStage = 3;
        delayMs = 3 * 24 * 60 * 60 * 1000;
        break;
      case 3:
        // Stage 4: 7 days after task creation
        nextStage = 4;
        delayMs = 4 * 24 * 60 * 60 * 1000;
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
