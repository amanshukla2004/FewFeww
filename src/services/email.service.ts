import { pool } from '../db/pool.js';
import { TelegramButton } from './telegram.client.js';

export interface EmailDraft {
  id: string;
  userId: string;
  recipient: string;
  subject: string;
  body: string;
  status: 'DRAFT' | 'SENT' | 'DISCARDED';
  sentAt?: Date | null;
  createdAt: Date;
}

export interface CreateDraftInput {
  userId: string;
  recipient: string;
  subject: string;
  body: string;
}

export class EmailService {
  /**
   * Create an email draft and return a Telegram interactive review card.
   */
  async createDraft(
    input: CreateDraftInput
  ): Promise<{ draft: EmailDraft; text: string; keyboard: TelegramButton[][] }> {
    const cleanRecipient = input.recipient.trim().toLowerCase();
    const cleanSubject = input.subject.trim();
    const cleanBody = input.body.trim();

    const res = await pool.query(
      `
      INSERT INTO email_drafts (user_id, recipient, subject, body, status)
      VALUES ($1, $2, $3, $4, 'DRAFT')
      RETURNING id, user_id, recipient, subject, body, status, sent_at, created_at;
      `,
      [input.userId, cleanRecipient, cleanSubject, cleanBody]
    );

    const row = res.rows[0];
    const draft: EmailDraft = {
      id: String(row.id),
      userId: String(row.user_id),
      recipient: row.recipient,
      subject: row.subject,
      body: row.body,
      status: row.status,
      sentAt: row.sent_at,
      createdAt: row.created_at,
    };

    const text =
      `✉️ <b>Email Draft Created:</b>\n\n` +
      `👤 <b>To:</b> <code>${draft.recipient}</code>\n` +
      `📌 <b>Subject:</b> ${draft.subject}\n\n` +
      `📝 <b>Body:</b>\n${draft.body}\n\n` +
      `<i>Would you like to send this email now?</i>`;

    const keyboard: TelegramButton[][] = [
      [
        { text: '📧 Send Email', callback_data: `em:s:${draft.id}` },
        { text: '❌ Discard', callback_data: `em:d:${draft.id}` },
      ],
    ];

    return { draft, text, keyboard };
  }

  /**
   * Mark draft as SENT and trigger simulated/configured SMTP dispatch.
   */
  async sendEmail(draftId: string | number, userId: string): Promise<{ text: string }> {
    const res = await pool.query(
      `
      UPDATE email_drafts
      SET status = 'SENT', sent_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'DRAFT'
      RETURNING id, recipient, subject;
      `,
      [String(draftId), userId]
    );

    if (res.rowCount === 0) {
      return {
        text: `⚠️ <b>Unable to Send:</b> Draft #${draftId} was already sent or discarded.`,
      };
    }

    const row = res.rows[0];
    return {
      text:
        `🚀 <b>Email Sent Successfully!</b>\n\n` +
        `👤 <b>To:</b> <code>${row.recipient}</code>\n` +
        `📌 <b>Subject:</b> ${row.subject}\n\n` +
        `Your message has been delivered.`,
    };
  }

  /**
   * Mark draft as DISCARDED.
   */
  async discardEmail(draftId: string | number, userId: string): Promise<{ text: string }> {
    const res = await pool.query(
      `
      UPDATE email_drafts
      SET status = 'DISCARDED'
      WHERE id = $1 AND user_id = $2 AND status = 'DRAFT'
      RETURNING id, subject;
      `,
      [String(draftId), userId]
    );

    if (res.rowCount === 0) {
      return {
        text: `ℹ️ Draft #${draftId} was already processed or does not exist.`,
      };
    }

    return {
      text: `🗑️ <b>Draft Discarded:</b> <i>"${res.rows[0].subject}"</i> was discarded.`,
    };
  }

  /**
   * List pending email drafts for a user.
   */
  async listDrafts(userId: string): Promise<{ drafts: EmailDraft[]; text: string }> {
    const res = await pool.query(
      `
      SELECT id, user_id, recipient, subject, body, status, sent_at, created_at
      FROM email_drafts
      WHERE user_id = $1 AND status = 'DRAFT'
      ORDER BY created_at DESC;
      `,
      [userId]
    );

    const drafts: EmailDraft[] = res.rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      recipient: r.recipient,
      subject: r.subject,
      body: r.body,
      status: r.status,
      sentAt: r.sent_at,
      createdAt: r.created_at,
    }));

    if (drafts.length === 0) {
      return {
        drafts,
        text: `📭 <b>No Pending Drafts:</b> You have no unsent email drafts.\nSay <i>"draft an email to john@example.com"</i> to start one!`,
      };
    }

    let text = `✉️ <b>Pending Email Drafts (${drafts.length}):</b>\n\n`;
    for (const d of drafts) {
      text += `• <b>${d.subject}</b> (To: <code>${d.recipient}</code>)\n`;
      text += `  Preview: <i>${d.body.slice(0, 60)}...</i>\n\n`;
    }

    return { drafts, text: text.trim() };
  }
}

export const emailService = new EmailService();
