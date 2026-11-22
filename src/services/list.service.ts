import { pool } from '../db/pool.js';
import { TelegramButton } from './telegram.client.js';

export interface TodoList {
  id: string;
  name: string;
  openCount?: number;
}

export class ListService {
  async createList(userId: string, name: string): Promise<{ id: string; name: string }> {
    const cleanName = name.trim();
    const res = await pool.query(
      `
      INSERT INTO todo_lists (user_id, name)
      VALUES ($1, $2)
      ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name;
      `,
      [userId, cleanName]
    );
    return {
      id: String(res.rows[0].id),
      name: res.rows[0].name,
    };
  }

  async getOrCreateList(userId: string, name: string): Promise<{ id: string; name: string }> {
    const cleanName = name.trim();
    const existing = await pool.query(
      `SELECT id, name FROM todo_lists WHERE user_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
      [userId, cleanName]
    );

    if (existing.rowCount && existing.rowCount > 0) {
      return {
        id: String(existing.rows[0].id),
        name: existing.rows[0].name,
      };
    }

    return this.createList(userId, cleanName);
  }

  async getUserLists(userId: string): Promise<Array<{ id: string; name: string; openCount: number }>> {
    const res = await pool.query(
      `
      SELECT 
        l.id, 
        l.name, 
        COUNT(t.id) FILTER (WHERE t.status = 'OPEN')::int as open_count
      FROM todo_lists l
      LEFT JOIN tasks t ON t.list_id = l.id
      WHERE l.user_id = $1
      GROUP BY l.id, l.name
      ORDER BY l.name ASC;
      `,
      [userId]
    );

    return res.rows.map((r) => ({
      id: String(r.id),
      name: r.name,
      openCount: r.open_count || 0,
    }));
  }

  async getTasksInList(userId: string, listName: string): Promise<Array<{ id: string; title: string; due_at: Date | null }>> {
    const res = await pool.query(
      `
      SELECT t.id, t.title, t.due_at
      FROM tasks t
      LEFT JOIN todo_lists l ON l.id = t.list_id
      WHERE t.user_id = $1 
        AND t.status = 'OPEN'
        AND (LOWER(t.category) = LOWER($2) OR LOWER(l.name) = LOWER($2))
      ORDER BY t.created_at ASC;
      `,
      [userId, listName.trim()]
    );

    return res.rows.map((r) => ({
      id: String(r.id),
      title: r.title,
      due_at: r.due_at,
    }));
  }

  async completeAllInList(userId: string, listName: string): Promise<number> {
    const res = await pool.query(
      `
      UPDATE tasks
      SET status = 'DONE', completed_at = now(), updated_at = now()
      WHERE user_id = $1
        AND status = 'OPEN'
        AND (
          LOWER(category) = LOWER($2) 
          OR list_id IN (SELECT id FROM todo_lists WHERE user_id = $1 AND LOWER(name) = LOWER($2))
        )
      RETURNING id;
      `,
      [userId, listName.trim()]
    );

    return res.rowCount || 0;
  }

  async formatListsOverview(userId: string): Promise<{ text: string; keyboard?: TelegramButton[][] }> {
    const lists = await this.getUserLists(userId);

    // Also count uncategorized open tasks
    const uncatRes = await pool.query(
      `SELECT count(*)::int as count FROM tasks WHERE user_id = $1 AND status = 'OPEN' AND list_id IS NULL AND (category IS NULL OR category = '')`,
      [userId]
    );
    const uncatCount = uncatRes.rows[0]?.count || 0;

    if (lists.length === 0 && uncatCount === 0) {
      return {
        text: `📁 <b>Your To-Do Lists</b>\n\nYou don't have any to-do lists or open tasks yet!\nTry saying:\n• <code>create a todo list called Shopping</code>\n• <code>add buy groceries to my shopping list</code>`,
      };
    }

    let text = `📁 <b>Your To-Do Lists & Categories</b>\n\n`;
    const keyboard: TelegramButton[][] = [];

    for (const l of lists) {
      text += `• <b>${l.name}</b> (${l.openCount} open)\n`;
      keyboard.push([
        { text: `📋 ${l.name} (${l.openCount})`, callback_data: `l:v:${l.name}` },
      ]);
    }

    if (uncatCount > 0) {
      text += `• <b>General / Uncategorized</b> (${uncatCount} open)\n`;
      keyboard.push([
        { text: `📝 General Tasks (${uncatCount})`, callback_data: `l:v:General` },
      ]);
    }

    text += `\n<i>Tap a category to view its tasks or reply "show my &lt;category&gt; todos".</i>`;

    return { text, keyboard };
  }

  async formatListItems(userId: string, listName: string): Promise<{ text: string; keyboard?: TelegramButton[][] }> {
    const cleanName = listName.trim();
    let tasks: Array<{ id: string; title: string; due_at: Date | null }> = [];

    if (cleanName.toLowerCase() === 'general') {
      const res = await pool.query(
        `SELECT id, title, due_at FROM tasks WHERE user_id = $1 AND status = 'OPEN' AND list_id IS NULL AND (category IS NULL OR category = '') ORDER BY created_at ASC`,
        [userId]
      );
      tasks = res.rows.map((r) => ({ id: String(r.id), title: r.title, due_at: r.due_at }));
    } else {
      tasks = await this.getTasksInList(userId, cleanName);
    }

    if (tasks.length === 0) {
      return {
        text: `📋 <b>${cleanName} List</b>\n\nNo open tasks in this list right now! 🎉`,
        keyboard: [[{ text: '🔙 All Lists', callback_data: 'l:back' }]],
      };
    }

    let text = `📋 <b>${cleanName} List (${tasks.length} open):</b>\n\n`;
    for (let i = 0; i < tasks.length; i++) {
      text += `${i + 1}. • ${tasks[i].title}\n`;
    }

    const keyboard: TelegramButton[][] = [
      [{ text: `✅ Complete All (${cleanName})`, callback_data: `l:doneall:${cleanName}` }],
      [{ text: '🔙 Back to Lists', callback_data: 'l:back' }],
    ];

    return { text, keyboard };
  }
}

export const listService = new ListService();
