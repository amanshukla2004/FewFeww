import { pool } from './pool.js';

export interface InboxUpdate {
  update_id: number;
  telegram_user_id: number | null;
  payload: any;
  status: 'PENDING' | 'PROCESSING' | 'APPLIED' | 'DONE' | 'FAILED';
  attempts: number;
  error?: string | null;
  received_at: Date;
  processed_at?: Date | null;
}

export class InboxRepository {
  /**
   * Idempotently insert incoming update.
   * Returns true if newly inserted, false if it was a duplicate delivery.
   */
  async insertIfAbsent(updateId: number, telegramUserId: number | null, payload: any): Promise<boolean> {
    const query = `
      INSERT INTO inbox_updates (update_id, telegram_user_id, payload, status)
      VALUES ($1, $2, $3, 'PENDING')
      ON CONFLICT (update_id) DO NOTHING
      RETURNING update_id;
    `;

    const res = await pool.query(query, [updateId, telegramUserId, JSON.stringify(payload)]);
    return (res.rowCount ?? 0) === 1;
  }

  async markStatus(updateId: number, status: InboxUpdate['status'], error: string | null = null): Promise<void> {
    await pool.query(
      `
      UPDATE inbox_updates
      SET status = $2,
          error = $3,
          attempts = attempts + 1,
          processed_at = CASE WHEN $2 IN ('DONE', 'FAILED') THEN now() ELSE processed_at END
      WHERE update_id = $1
      `,
      [updateId, status, error]
    );
  }

  async getUpdate(updateId: number): Promise<InboxUpdate | null> {
    const res = await pool.query('SELECT * FROM inbox_updates WHERE update_id = $1', [updateId]);
    return res.rows[0] || null;
  }
}

export const inboxRepo = new InboxRepository();
