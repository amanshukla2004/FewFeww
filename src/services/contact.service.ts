import { pool } from '../db/pool.js';

export interface Contact {
  id: string;
  userId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  telegramUsername?: string | null;
  telegramUserId?: string | null;
  createdAt: Date;
}

export interface AddContactInput {
  userId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  telegramUsername?: string | null;
}

export class ContactService {
  /**
   * Adds or updates a contact in the user's personal directory.
   * Auto-links telegram_user_id if the contact's username is recognized.
   */
  async addContact(input: AddContactInput): Promise<{ contact: Contact; formattedText: string }> {
    const cleanName = input.name.trim();
    const cleanPhone = input.phone?.trim() || null;
    const cleanEmail = input.email?.trim().toLowerCase() || null;
    const cleanUsername = input.telegramUsername ? input.telegramUsername.replace(/^@/, '').trim() : null;

    let linkedTelegramId: string | null = null;
    if (cleanUsername) {
      const userLookup = await pool.query(
        `SELECT telegram_user_id FROM users WHERE LOWER(first_name) = LOWER($1) LIMIT 1`,
        [cleanUsername]
      );
      if (userLookup.rowCount && userLookup.rowCount > 0) {
        linkedTelegramId = String(userLookup.rows[0].telegram_user_id);
      }
    }

    const res = await pool.query(
      `
      INSERT INTO contacts (user_id, name, phone, email, telegram_username, telegram_user_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, user_id, name, phone, email, telegram_username, telegram_user_id, created_at;
      `,
      [input.userId, cleanName, cleanPhone, cleanEmail, cleanUsername, linkedTelegramId]
    );

    const row = res.rows[0];
    const contact: Contact = {
      id: String(row.id),
      userId: String(row.user_id),
      name: row.name,
      phone: row.phone,
      email: row.email,
      telegramUsername: row.telegram_username,
      telegramUserId: row.telegram_user_id ? String(row.telegram_user_id) : null,
      createdAt: row.created_at,
    };

    let details = '';
    if (contact.phone) details += `\n📞 <b>Phone:</b> <code>${contact.phone}</code>`;
    if (contact.email) details += `\n✉️ <b>Email:</b> ${contact.email}`;
    if (contact.telegramUsername) details += `\n💬 <b>Telegram:</b> @${contact.telegramUsername}`;

    const formattedText = `👤 <b>Contact Saved:</b> <b>${contact.name}</b>${details}\n\n<i>You can now set reminders for this contact (e.g. "remind ${contact.name} to call me tomorrow at 5pm").</i>`;

    return { contact, formattedText };
  }

  /**
   * Search for a contact by name or keyword.
   */
  async findContact(userId: string, nameOrQuery: string): Promise<Contact | null> {
    const clean = nameOrQuery.trim();
    const res = await pool.query(
      `
      SELECT id, user_id, name, phone, email, telegram_username, telegram_user_id, created_at
      FROM contacts
      WHERE user_id = $1 AND (name ILIKE $2 OR telegram_username ILIKE $2)
      ORDER BY CASE WHEN LOWER(name) = LOWER($3) THEN 0 ELSE 1 END, name ASC
      LIMIT 1;
      `,
      [userId, `%${clean}%`, clean]
    );

    if (!res.rowCount || res.rowCount === 0) return null;

    const row = res.rows[0];
    return {
      id: String(row.id),
      userId: String(row.user_id),
      name: row.name,
      phone: row.phone,
      email: row.email,
      telegramUsername: row.telegram_username,
      telegramUserId: row.telegram_user_id ? String(row.telegram_user_id) : null,
      createdAt: row.created_at,
    };
  }

  /**
   * List all contacts for a user.
   */
  async listContacts(userId: string): Promise<{ contacts: Contact[]; formattedText: string }> {
    const res = await pool.query(
      `
      SELECT id, user_id, name, phone, email, telegram_username, telegram_user_id, created_at
      FROM contacts
      WHERE user_id = $1
      ORDER BY name ASC;
      `,
      [userId]
    );

    const contacts: Contact[] = res.rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      name: r.name,
      phone: r.phone,
      email: r.email,
      telegramUsername: r.telegram_username,
      telegramUserId: r.telegram_user_id ? String(r.telegram_user_id) : null,
      createdAt: r.created_at,
    }));

    if (contacts.length === 0) {
      return {
        contacts,
        formattedText: `📇 <b>Contacts:</b>\n\nYou don't have any contacts saved yet.\nAdd someone by saying: <i>"add John to my contacts with phone 9876543210"</i>.`,
      };
    }

    let text = `📇 <b>Your Contacts (${contacts.length}):</b>\n\n`;
    for (const c of contacts) {
      text += `• <b>${c.name}</b>`;
      if (c.phone) text += ` — 📞 <code>${c.phone}</code>`;
      if (c.telegramUsername) text += ` — 💬 @${c.telegramUsername}`;
      if (c.email) text += ` — ✉️ ${c.email}`;
      text += '\n';
    }

    return { contacts, formattedText: text.trim() };
  }

  /**
   * Delete a contact by ID or name.
   */
  async deleteContact(userId: string, contactIdOrName: string): Promise<boolean> {
    const isNumeric = /^\d+$/.test(contactIdOrName.trim());
    let res;
    if (isNumeric) {
      res = await pool.query(`DELETE FROM contacts WHERE user_id = $1 AND id = $2 RETURNING id`, [
        userId,
        contactIdOrName.trim(),
      ]);
    } else {
      res = await pool.query(`DELETE FROM contacts WHERE user_id = $1 AND LOWER(name) = LOWER($2) RETURNING id`, [
        userId,
        contactIdOrName.trim(),
      ]);
    }
    return (res.rowCount ?? 0) > 0;
  }
}

export const contactService = new ContactService();
