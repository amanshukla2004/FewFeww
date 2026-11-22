import { pool } from '../db/pool.js';
import { dateResolver, DateResolutionResult } from './date.resolver.js';
import { TelegramButton } from './telegram.client.js';
import { DateTime } from 'luxon';
import { listService } from './list.service.js';

export interface CreateTaskParams {
  userId: string;
  title: string;
  details?: string | null;
  dueLocal?: string | null;
  timeIsExplicit?: boolean;
  recurrence?: string | null;
  category?: string | null;
  userTimezone?: string;
  defaultReminderTime?: string;
  sourceMessageId?: number | null;
  callAlert?: boolean;
}

export interface TaskResult {
  text: string;
  keyboard?: TelegramButton[][];
  taskId?: string;
}

export class TaskService {
  /**
   * Creates a new task and registers associated reminders and telemetry events atomically.
   */
  async createTask(params: CreateTaskParams): Promise<TaskResult> {
    const { userId, title, details, dueLocal, timeIsExplicit, recurrence, category, sourceMessageId } = params;
    const userTimezone = params.userTimezone || 'Asia/Kolkata';
    const defaultReminderTime = params.defaultReminderTime || '09:00';

    let dueUtc: Date | null = null;
    let hasExplicitTime = false;
    let localFormatted: string | null = null;
    let listId: string | null = null;
    let cleanCategory: string | null = null;

    if (category) {
      cleanCategory = category.trim();
      const list = await listService.getOrCreateList(userId, cleanCategory);
      listId = list.id;
    }

    if (dueLocal) {
      const resolved = dateResolver.resolveProposed(dueLocal, timeIsExplicit ?? false, {
        timezone: userTimezone,
        defaultReminderTime,
      });

      if (resolved.kind === 'NEEDS_CLARIFICATION') {
        return {
          text: `❓ ${resolved.message}\n\nTask: <i>${title}</i>`,
        };
      }

      dueUtc = resolved.utcDate;
      hasExplicitTime = resolved.timeIsExplicit;
      localFormatted = DateTime.fromJSDate(dueUtc).setZone(userTimezone).toFormat('cccc, dd LLL yyyy, hh:mm a');
    } else if (recurrence) {
      // Default initial run for recurring task
      const [h, m] = defaultReminderTime.split(':').map((s) => parseInt(s, 10));
      let nextRun = DateTime.now().setZone(userTimezone).set({ hour: h, minute: m, second: 0, millisecond: 0 });
      if (nextRun.toMillis() <= Date.now()) {
        nextRun = nextRun.plus({ days: 1 });
      }
      dueUtc = nextRun.toUTC().toJSDate();
      localFormatted = nextRun.toFormat('cccc, dd LLL yyyy, hh:mm a');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Insert Task
      const taskRes = await client.query(
        `
        INSERT INTO tasks (user_id, title, details, due_at, due_has_time, recurrence, category, list_id, source_message_id, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'OPEN')
        RETURNING id, title, due_at;
        `,
        [
          userId,
          title.trim(),
          details || null,
          dueUtc,
          hasExplicitTime,
          recurrence ? JSON.stringify({ freq: recurrence }) : null,
          cleanCategory || null,
          listId ? parseInt(listId, 10) : null,
          sourceMessageId || null,
        ]
      );

      const taskId = String(taskRes.rows[0].id);

      // 2. Insert User Reminder if due date set
      if (dueUtc) {
        const reminderKind = params.callAlert ? 'CALL' : 'USER';
        await client.query(
          `
          INSERT INTO reminders (user_id, task_id, kind, nudge_stage, fire_at, status)
          VALUES ($1, $2, $3, 0, $4, 'SCHEDULED')
          `,
          [userId, taskId, reminderKind, dueUtc]
        );
      }

      // 3. Log Analytics Event
      await client.query(
        `
        INSERT INTO events (user_id, type, entity_type, entity_id, props)
        VALUES ($1, 'task_created', 'task', $2, $3)
        `,
        [userId, taskId, JSON.stringify({ hasDue: !!dueUtc, hasExplicitTime, callAlert: !!params.callAlert })]
      );

      await client.query('COMMIT');

      let reply = params.callAlert
        ? `🚨📞 <b>Call-Style Ring Alert Scheduled!</b>\n\nI will ring your device at <b>${localFormatted || 'scheduled time'}</b> for: <i>"${title.trim()}"</i>.`
        : `✅ <b>Task Created:</b> ${title.trim()}`;
      if (localFormatted) {
        reply += `\n⏰ <b>Due:</b> ${localFormatted}`;
      } else {
        reply += `\n📝 <i>No deadline set (added to Open Tasks)</i>`;
      }
      if (recurrence) {
        reply += `\n🔁 <b>Repeats:</b> ${recurrence.toLowerCase()}`;
      }
      if (cleanCategory) {
        reply += `\n📁 <b>List:</b> ${cleanCategory}`;
      }

      const keyboard: TelegramButton[][] = [
        [{ text: '↩️ Undo', callback_data: `u:task:${taskId}` }],
      ];

      return { text: reply, keyboard, taskId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async saveNote(
    userId: string,
    content: string,
    title?: string | null,
    tagsOrUrl?: string[] | string | null,
    url?: string | null,
    sourceMessageId?: number | null
  ): Promise<TaskResult> {
    let cleanTags: string[] = [];
    let finalUrl = url;

    if (Array.isArray(tagsOrUrl)) {
      cleanTags = tagsOrUrl.map((t) => t.trim().toLowerCase());
    } else if (typeof tagsOrUrl === 'string') {
      finalUrl = tagsOrUrl;
    }

    const res = await pool.query(
      `
      INSERT INTO notes (user_id, title, content, tags, url, source_message_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, title, content, tags;
      `,
      [userId, title || null, content.trim(), cleanTags, finalUrl || null, sourceMessageId || null]
    );

    const noteId = String(res.rows[0].id);
    let reply = `📌 <b>Saved Note:</b> ${title || content.slice(0, 60)}`;
    if (cleanTags.length > 0) {
      reply += `\n🏷️ <b>Tags:</b> ${cleanTags.map((t) => `#${t}`).join(' ')}`;
    }

    return {
      text: reply,
      taskId: noteId,
    };
  }

  async appendNote(
    userId: string,
    targetHint: string,
    addition: string
  ): Promise<{ text: string; noteId?: string }> {
    const cleanHint = targetHint.trim();
    const matchRes = await pool.query(
      `
      SELECT id, title, content, tags
      FROM notes
      WHERE user_id = $1 AND (title ILIKE $2 OR content ILIKE $2)
      ORDER BY similarity(coalesce(title, ''), $3) DESC, created_at DESC
      LIMIT 1;
      `,
      [userId, `%${cleanHint}%`, cleanHint]
    );

    if (matchRes.rowCount === 0) {
      const created = await this.saveNote(userId, addition, cleanHint);
      return {
        text: `📝 Couldn't find existing note matching "${cleanHint}", so I created a new one:\n\n${created.text}`,
        noteId: created.taskId,
      };
    }

    const note = matchRes.rows[0];
    const timestamp = DateTime.now().toFormat('dd LLL, hh:mm a');
    const updatedContent = `${note.content}\n\n--- [Added ${timestamp}] ---\n${addition.trim()}`;

    await pool.query(
      `UPDATE notes SET content = $2, updated_at = now() WHERE id = $1`,
      [note.id, updatedContent]
    );

    return {
      text: `📝 <b>Appended to Note:</b> <i>"${note.title || cleanHint}"</i>\n\n${addition.trim()}`,
      noteId: String(note.id),
    };
  }

  async listNotes(userId: string, tag?: string | null, limit = 10): Promise<{ text: string }> {
    let query = `SELECT id, title, content, tags, created_at FROM notes WHERE user_id = $1`;
    const params: any[] = [userId];

    if (tag) {
      params.push(tag.trim().toLowerCase());
      query += ` AND $${params.length} = ANY(tags)`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const res = await pool.query(query, params);

    if (res.rowCount === 0) {
      return {
        text: tag
          ? `📌 No notes found tagged with <b>#${tag}</b>.`
          : `📌 <b>Your Notes:</b>\n\nYou don't have any notes yet! Tell me "save this to my notes: [idea]" to create one.`,
      };
    }

    let text = tag ? `📌 <b>Notes tagged #${tag} (${res.rowCount}):</b>\n\n` : `📌 <b>Your Recent Notes (${res.rowCount}):</b>\n\n`;

    for (const r of res.rows) {
      const snippet = r.content.length > 80 ? r.content.slice(0, 80) + '...' : r.content;
      text += `• <b>${r.title || 'Untitled'}</b>\n  <i>${snippet}</i>\n`;
      if (r.tags && r.tags.length > 0) {
        text += `  🏷️ ${r.tags.map((t: string) => `#${t}`).join(' ')}\n`;
      }
      text += `\n`;
    }

    return { text: text.trim() };
  }

  /**
   * Completes a task by ID or fuzzy text hint, cancels pending reminders, and logs telemetry.
   */
  async completeTask(userId: string, taskId?: number | string | null, textHint?: string | null): Promise<TaskResult> {
    let targetId = taskId;

    // Fuzzy resolve task ID by textHint if not explicitly passed
    if (!targetId && textHint) {
      const matchRes = await pool.query(
        `
        SELECT id, title FROM tasks
        WHERE user_id = $1 AND status = 'OPEN' AND (title ILIKE $2 OR title % $3)
        ORDER BY similarity(title, $3) DESC LIMIT 1;
        `,
        [userId, `%${textHint}%`, textHint]
      );
      if (matchRes.rowCount && matchRes.rowCount > 0) {
        targetId = matchRes.rows[0].id;
      }
    }

    if (!targetId) {
      return { text: `❓ Couldn't find an open task matching "${textHint || ''}".` };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const updateRes = await client.query(
        `
        UPDATE tasks 
        SET status = 'DONE', completed_at = now(), updated_at = now()
        WHERE id = $1 AND user_id = $2
        RETURNING id, title;
        `,
        [String(targetId), userId]
      );

      if (updateRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { text: `❓ Task #${targetId} not found or already completed.` };
      }

      // Cancel any pending reminders/nudges for this task
      await client.query(
        `UPDATE reminders SET status = 'CANCELLED' WHERE task_id = $1 AND status = 'SCHEDULED'`,
        [String(targetId)]
      );

      await client.query(
        `INSERT INTO events (user_id, type, entity_type, entity_id) VALUES ($1, 'task_done', 'task', $2)`,
        [userId, String(targetId)]
      );

      await client.query('COMMIT');

      return {
        text: `🎉 <b>Marked Done:</b> ${updateRes.rows[0].title}`,
        keyboard: [[{ text: '↩️ Undo', callback_data: `u:done:${targetId}` }]],
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Drops a task by ID or fuzzy text hint and cancels its reminders.
   */
  async dropTask(userId: string, taskId?: number | string | null, textHint?: string | null): Promise<TaskResult> {
    let targetId = taskId;

    if (!targetId && textHint) {
      const match = await pool.query(
        `
        SELECT id FROM tasks 
        WHERE user_id = $1 AND status = 'OPEN' AND (title ILIKE $2 OR title % $3)
        ORDER BY similarity(title, $3) DESC 
        LIMIT 1;
        `,
        [userId, `%${textHint}%`, textHint]
      );
      if (match.rowCount && match.rowCount > 0) {
        targetId = match.rows[0].id;
      }
    }

    if (!targetId) {
      return {
        text: `❓ Couldn't identify which task to drop. Try /list or specify the task title.`,
      };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const updateRes = await client.query(
        `
        UPDATE tasks 
        SET status = 'DROPPED', updated_at = now()
        WHERE id = $1 AND user_id = $2
        RETURNING id, title;
        `,
        [String(targetId), userId]
      );

      if (updateRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { text: `❓ Task #${targetId} not found.` };
      }

      await client.query(
        `UPDATE reminders SET status = 'CANCELLED' WHERE task_id = $1 AND status = 'SCHEDULED'`,
        [String(targetId)]
      );

      await client.query(
        `INSERT INTO events (user_id, type, entity_type, entity_id) VALUES ($1, 'task_dropped', 'task', $2)`,
        [userId, String(targetId)]
      );

      await client.query('COMMIT');

      return {
        text: `🗑 <b>Dropped task:</b> ${updateRes.rows[0].title}`,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async undoTaskCreation(userId: string, taskId: string): Promise<string> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        `DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING title;`,
        [taskId, userId]
      );
      await client.query('COMMIT');

      if (res.rowCount === 0) return 'Task already removed.';
      return `↩️ Undone: "${res.rows[0].title}" has been deleted.`;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getOpenTasks(userId: string, limit = 30): Promise<Array<{ id: string; title: string; due_at: Date | null }>> {
    const res = await pool.query(
      `
      SELECT id, title, due_at 
      FROM tasks 
      WHERE user_id = $1 AND status = 'OPEN' 
      ORDER BY due_at ASC NULLS LAST, created_at DESC 
      LIMIT $2;
      `,
      [userId, limit]
    );
    return res.rows.map((r) => ({ id: String(r.id), title: r.title, due_at: r.due_at }));
  }
}

export const taskService = new TaskService();
