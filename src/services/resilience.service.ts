import { pool } from '../db/pool.js';

export interface RateLimitStatus {
  isLimited: boolean;
  remaining: number;
  resetSeconds: number;
}

export class ResilienceService {
  private inMemoryCounts = new Map<string, { count: number; windowStart: number }>();
  private readonly WINDOW_MS = 10 * 60 * 1000; // 10 minutes
  private readonly MAX_MESSAGES = 30; // 30 messages per 10 minutes
  private lastPruneTime = Date.now();

  public degradedModeActive = false;

  private pruneExpired(now: number): void {
    if (now - this.lastPruneTime < 60000) return; // prune at most once a minute
    this.lastPruneTime = now;
    for (const [id, entry] of this.inMemoryCounts.entries()) {
      if (now - entry.windowStart > this.WINDOW_MS) {
        this.inMemoryCounts.delete(id);
      }
    }
  }

  /**
   * Sliding window rate limiter (30 msgs / 10 min) with auto-pruning TTL
   */
  checkRateLimit(userId: string): RateLimitStatus {
    const now = Date.now();
    this.pruneExpired(now);
    const entry = this.inMemoryCounts.get(userId);

    if (!entry || now - entry.windowStart > this.WINDOW_MS) {
      this.inMemoryCounts.set(userId, { count: 1, windowStart: now });
      return { isLimited: false, remaining: this.MAX_MESSAGES - 1, resetSeconds: Math.ceil(this.WINDOW_MS / 1000) };
    }

    if (entry.count >= this.MAX_MESSAGES) {
      const resetSeconds = Math.ceil((entry.windowStart + this.WINDOW_MS - now) / 1000);
      return { isLimited: true, remaining: 0, resetSeconds };
    }

    entry.count++;
    const remaining = this.MAX_MESSAGES - entry.count;
    const resetSeconds = Math.ceil((entry.windowStart + this.WINDOW_MS - now) / 1000);
    return { isLimited: false, remaining, resetSeconds };
  }

  /**
   * Resets rate limit for a user (useful for tests or manual admin unblock)
   */
  resetRateLimit(userId: string): void {
    this.inMemoryCounts.delete(userId);
  }

  /**
   * Handles Telegram HTTP 403 Forbidden (bot was blocked by user)
   */
  async handleUserBlocked(userId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update user status to BLOCKED
      await client.query(
        `UPDATE users SET status = 'BLOCKED', updated_at = now() WHERE id = $1`,
        [userId]
      );

      // Cancel all scheduled reminders
      await client.query(
        `
        UPDATE reminders 
        SET status = 'CANCELLED', last_error = 'user_blocked' 
        WHERE user_id = $1 AND status = 'SCHEDULED'
        `,
        [userId]
      );

      // Log event
      await client.query(
        `INSERT INTO events (user_id, type, entity_type) VALUES ($1, 'bot_blocked', 'user')`,
        [userId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 1-Minute Stuck Job Reaper for reminders
   */
  async reapStuckReminders(olderThanMinutes = 5): Promise<number> {
    const res = await pool.query(
      `
      UPDATE reminders
      SET status = 'SCHEDULED', locked_at = NULL
      WHERE status = 'SENDING' AND locked_at < now() - make_interval(mins => $1)
      RETURNING id;
      `,
      [olderThanMinutes]
    );
    return res.rowCount || 0;
  }

  /**
   * 1-Minute Stuck Job Reaper for inbox updates
   */
  async reapStuckInboxUpdates(olderThanMinutes = 5): Promise<number> {
    const res = await pool.query(
      `
      UPDATE inbox_updates
      SET status = 'PENDING', attempts = attempts + 1
      WHERE status = 'PROCESSING' 
        AND received_at < now() - make_interval(mins => $1)
        AND attempts < 5
      RETURNING update_id;
      `,
      [olderThanMinutes]
    );
    return res.rowCount || 0;
  }

  /**
   * Run all stuck job reapers
   */
  async runReaperCycle(): Promise<{ reapedReminders: number; reapedInbox: number }> {
    const reapedReminders = await this.reapStuckReminders(5);
    const reapedInbox = await this.reapStuckInboxUpdates(5);
    return { reapedReminders, reapedInbox };
  }
}

export const resilienceService = new ResilienceService();
