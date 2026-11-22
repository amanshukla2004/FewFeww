import { pool } from '../db/pool.js';
import { User, userRepo } from '../db/user.repo.js';
import { telegram, TelegramClient } from './telegram.client.js';
import crypto from 'crypto';

export interface Circle {
  id: string;
  ownerId: string;
  name: string;
  inviteCode: string;
  createdAt: Date;
  memberCount?: number;
}

export class CircleService {
  constructor(private tg: TelegramClient = telegram) {}

  /**
   * Create a new circle and generate a unique cryptographic invitation deep link.
   */
  async createCircle(
    ownerId: string,
    name: string
  ): Promise<{ circle: Circle; inviteUrl: string; formattedText: string }> {
    const cleanName = name.trim();
    const token = `${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4)}_${crypto.randomBytes(4).toString('hex')}`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const circleRes = await client.query(
        `
        INSERT INTO circles (owner_id, name, invite_code)
        VALUES ($1, $2, $3)
        ON CONFLICT (owner_id, name) DO UPDATE
        SET invite_code = EXCLUDED.invite_code
        RETURNING id, owner_id, name, invite_code, created_at;
        `,
        [ownerId, cleanName, token]
      );

      const row = circleRes.rows[0];
      const circle: Circle = {
        id: String(row.id),
        ownerId: String(row.owner_id),
        name: row.name,
        inviteCode: row.invite_code,
        createdAt: row.created_at,
        memberCount: 1,
      };

      // Add owner as active member
      await client.query(
        `
        INSERT INTO circle_members (circle_id, user_id, status)
        VALUES ($1, $2, 'ACTIVE')
        ON CONFLICT (circle_id, user_id) DO NOTHING;
        `,
        [circle.id, ownerId]
      );

      await client.query('COMMIT');

      const inviteUrl = `https://t.me/FewFewwDevBot?start=join_${circle.inviteCode}`;
      const formattedText =
        `⭕ <b>Circle Created:</b> <b>${circle.name}</b>\n\n` +
        `Share this link to invite family, friends, or teammates to this circle:\n` +
        `🔗 <code>${inviteUrl}</code>\n\n` +
        `<i>Anyone with this link will automatically join your circle and receive group reminders!</i>`;

      return { circle, inviteUrl, formattedText };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Join a circle via cryptographic token (e.g. from /start join_<token>).
   */
  async joinCircleByToken(
    token: string,
    user: User
  ): Promise<{ success: boolean; circleName: string; ownerId: string; formattedText: string }> {
    const cleanToken = token.replace(/^join_/, '').trim();

    const circleRes = await pool.query(
      `
      SELECT c.id, c.name, c.owner_id, u.first_name as owner_name, u.telegram_chat_id as owner_chat_id
      FROM circles c
      JOIN users u ON u.id = c.owner_id
      WHERE c.invite_code = $1;
      `,
      [cleanToken]
    );

    if (!circleRes.rowCount || circleRes.rowCount === 0) {
      return {
        success: false,
        circleName: '',
        ownerId: '',
        formattedText: `⚠️ <b>Invalid Invitation Link:</b> This circle invitation does not exist or has expired.`,
      };
    }

    const circle = circleRes.rows[0];
    await pool.query(
      `
      INSERT INTO circle_members (circle_id, user_id, status)
      VALUES ($1, $2, 'ACTIVE')
      ON CONFLICT (circle_id, user_id) DO UPDATE
      SET status = 'ACTIVE', joined_at = now();
      `,
      [circle.id, user.id]
    );

    // Notify circle owner if different user
    if (String(circle.owner_id) !== String(user.id) && circle.owner_chat_id) {
      try {
        await this.tg.sendMessage(
          circle.owner_chat_id,
          `🔔 <b>New Circle Member:</b> <b>${user.first_name || 'A new contact'}</b> has joined your circle <i>"${circle.name}"</i>!`
        );
      } catch (err) {
        // Ignored if Telegram error
      }
    }

    const formattedText =
      `🎉 <b>Joined Circle!</b>\n\n` +
      `You are now a member of <b>${circle.name}</b> (created by ${circle.owner_name || 'an organizer'}).\n` +
      `You will receive reminders and updates sent to this circle!`;

    return {
      success: true,
      circleName: circle.name,
      ownerId: String(circle.owner_id),
      formattedText,
    };
  }

  /**
   * List all circles the user owns or belongs to.
   */
  async listUserCircles(userId: string): Promise<{ circles: Circle[]; formattedText: string }> {
    const res = await pool.query(
      `
      SELECT c.id, c.owner_id, c.name, c.invite_code, c.created_at,
             COUNT(m.id) as member_count
      FROM circles c
      LEFT JOIN circle_members m ON m.circle_id = c.id AND m.status = 'ACTIVE'
      WHERE c.owner_id = $1 OR c.id IN (SELECT circle_id FROM circle_members WHERE user_id = $1 AND status = 'ACTIVE')
      GROUP BY c.id
      ORDER BY c.created_at DESC;
      `,
      [userId]
    );

    const circles: Circle[] = res.rows.map((r) => ({
      id: String(r.id),
      ownerId: String(r.owner_id),
      name: r.name,
      inviteCode: r.invite_code,
      createdAt: r.created_at,
      memberCount: Number(r.member_count),
    }));

    if (circles.length === 0) {
      return {
        circles,
        formattedText:
          `⭕ <b>Circles:</b>\n\nYou haven't joined or created any circles yet.\n` +
          `Create one by saying: <i>"create a circle called Family"</i> or <i>"create Dev Team circle"</i>.`,
      };
    }

    let text = `⭕ <b>Your Circles (${circles.length}):</b>\n\n`;
    for (const c of circles) {
      const isOwner = String(c.ownerId) === String(userId);
      text += `• <b>${c.name}</b> (${c.memberCount} member${c.memberCount === 1 ? '' : 's'})${isOwner ? ' 👑 <i>Owner</i>' : ''}\n`;
      text += `  🔗 <code>https://t.me/FewFewwDevBot?start=join_${c.inviteCode}</code>\n\n`;
    }

    return { circles, formattedText: text.trim() };
  }

  /**
   * Broadcast a reminder to all active members of a circle.
   */
  async broadcastCircleReminder(
    sender: User,
    circleName: string,
    reminderText: string,
    scheduledLocal?: string
  ): Promise<{ sentCount: number; formattedText: string }> {
    const circleRes = await pool.query(
      `
      SELECT c.id, c.name
      FROM circles c
      WHERE LOWER(c.name) = LOWER($1)
        AND (c.owner_id = $2 OR c.id IN (SELECT circle_id FROM circle_members WHERE user_id = $2))
      LIMIT 1;
      `,
      [circleName.trim(), sender.id]
    );

    if (!circleRes.rowCount || circleRes.rowCount === 0) {
      return {
        sentCount: 0,
        formattedText: `⚠️ <b>Circle Not Found:</b> Could not find a circle named <i>"${circleName}"</i> in your account.`,
      };
    }

    const circleId = circleRes.rows[0].id;

    // Fetch all active members with chat_id
    const membersRes = await pool.query(
      `
      SELECT u.id, u.telegram_chat_id, u.first_name
      FROM circle_members m
      JOIN users u ON u.id = m.user_id
      WHERE m.circle_id = $1 AND m.status = 'ACTIVE';
      `,
      [circleId]
    );

    const alertMessage =
      `🔔 <b>Circle Reminder:</b> <b>${circleName}</b>\n\n` +
      `<i>"${reminderText}"</i>\n\n` +
      (scheduledLocal ? `🗓 <b>Scheduled:</b> ${scheduledLocal}\n` : '') +
      `👤 <b>From:</b> ${sender.first_name || 'Circle Member'}`;

    let sentCount = 0;
    for (const member of membersRes.rows) {
      // Don't send duplicate to sender if they are creating it
      if (String(member.id) === String(sender.id)) continue;

      try {
        await this.tg.sendMessage(member.telegram_chat_id, alertMessage);
        sentCount++;
      } catch (err) {
        console.error(`Failed to send circle reminder to user ${member.id}:`, err);
      }
    }

    const confirmation =
      `📢 <b>Circle Broadcast Sent!</b>\n\n` +
      `Dispatched reminder <i>"${reminderText}"</i> to <b>${sentCount} member(s)</b> of <b>${circleName}</b>.`;

    return { sentCount, formattedText: confirmation };
  }
}

export const circleService = new CircleService();
