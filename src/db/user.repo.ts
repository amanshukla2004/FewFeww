import { pool } from './pool.js';

export type OnboardingState = 'NEW' | 'AWAITING_CONSENT' | 'AWAITING_TZ' | 'AWAITING_TIME' | 'ACTIVE';

export interface User {
  id: string; // BIGINT as string in JS
  telegram_user_id: string;
  telegram_chat_id: string;
  first_name: string | null;
  language_code: string | null;
  timezone: string;
  default_reminder_time: string;
  lead_minutes: number;
  quiet_start: string;
  quiet_end: string;
  morning_plan_enabled: boolean;
  morning_plan_time: string;
  last_morning_plan_on: string | null;
  evening_checkin_enabled: boolean;
  last_evening_on: string | null;
  nudges_enabled: boolean;
  nudges_paused_until: Date | null;
  daily_proactive_cap: number;
  output_language: string;
  onboarding_state: OnboardingState;
  consented_at: Date | null;
  status: 'ACTIVE' | 'BLOCKED' | 'DELETED';
  created_at: Date;
  updated_at: Date;
}

export class UserRepository {
  async findOrCreate(
    telegramUserId: number | string,
    telegramChatId: number | string,
    firstName?: string | null,
    languageCode?: string | null
  ): Promise<{ user: User; isNew: boolean }> {
    const existing = await this.findByTelegramId(telegramUserId);
    if (existing) {
      // Keep chat_id, first_name, and language updated
      if (
        existing.telegram_chat_id !== String(telegramChatId) ||
        (firstName && existing.first_name !== firstName)
      ) {
        await pool.query(
          `UPDATE users SET telegram_chat_id = $1, first_name = coalesce($2, first_name), updated_at = now() WHERE id = $3`,
          [String(telegramChatId), firstName || null, existing.id]
        );
      }
      return { user: existing, isNew: false };
    }

    const insertQuery = `
      INSERT INTO users (telegram_user_id, telegram_chat_id, first_name, language_code, onboarding_state)
      VALUES ($1, $2, $3, $4, 'NEW')
      RETURNING *;
    `;
    const res = await pool.query(insertQuery, [
      String(telegramUserId),
      String(telegramChatId),
      firstName || null,
      languageCode || 'en',
    ]);

    return { user: res.rows[0], isNew: true };
  }

  async findByTelegramId(telegramUserId: number | string): Promise<User | null> {
    const res = await pool.query('SELECT * FROM users WHERE telegram_user_id = $1', [String(telegramUserId)]);
    return res.rows[0] || null;
  }

  async findById(id: number | string): Promise<User | null> {
    const res = await pool.query('SELECT * FROM users WHERE id = $1', [String(id)]);
    return res.rows[0] || null;
  }

  async setConsent(userId: number | string): Promise<User> {
    const res = await pool.query(
      `
      UPDATE users 
      SET onboarding_state = 'AWAITING_TZ', consented_at = now(), updated_at = now() 
      WHERE id = $1
      RETURNING *;
      `,
      [String(userId)]
    );
    return res.rows[0];
  }

  async setTimezone(userId: number | string, timezone: string): Promise<User> {
    const res = await pool.query(
      `
      UPDATE users 
      SET timezone = $2, onboarding_state = 'AWAITING_TIME', updated_at = now() 
      WHERE id = $1
      RETURNING *;
      `,
      [String(userId), timezone]
    );
    return res.rows[0];
  }

  async setDefaultReminderTime(userId: number | string, time: string): Promise<User> {
    const res = await pool.query(
      `
      UPDATE users 
      SET default_reminder_time = $2, onboarding_state = 'ACTIVE', updated_at = now() 
      WHERE id = $1
      RETURNING *;
      `,
      [String(userId), time]
    );
    return res.rows[0];
  }

  async setOutputLanguage(userId: number | string, language: string): Promise<User> {
    const res = await pool.query(
      `UPDATE users SET output_language = $2, updated_at = now() WHERE id = $1 RETURNING *;`,
      [String(userId), language.trim()]
    );
    return res.rows[0];
  }

  async setOnboardingState(userId: number | string, state: OnboardingState): Promise<User> {
    const res = await pool.query(
      `UPDATE users SET onboarding_state = $2, updated_at = now() WHERE id = $1 RETURNING *;`,
      [String(userId), state]
    );
    return res.rows[0];
  }
}

export const userRepo = new UserRepository();
