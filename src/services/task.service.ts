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
  userTimezone: string;
  defaultReminderTime: string;
  sourceMessageId?: number | null;
}

export interface TaskResult {
  text: string;
  keyboard?: TelegramButton[][];
  taskId?: string;
}

export class TaskService {
  async createTask(params: CreateTaskParams): Promise<TaskResult> {
    const { userId, title, details, dueLocal, timeIsExplicit, recurrence, category, userTimezone, defaultReminderTime, sourceMessageId } = params;

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
        await client.query(
          `
          INSERT INTO reminders (user_id, task_id, kind, nudge_stage, fire_at, status)
          VALUES ($1, $2, 'USER', 0, $3, 'SCHEDULED')
          `,
          [userId, taskId, dueUtc]
        );
      }

      // 3. Log Analytics Event
      await client.query(
        `
        INSERT INTO events (user_id, type, entity_type, entity_id, props)
        VALUES ($1, 'task_created', 'task', $2, $3)
        `,
        [userId, taskId, JSON.stringify({ hasDue: !!dueUtc, hasExplicitTime })]
      );

      await client.query('COMMIT');

      let reply = `✅ <b>Task Created:</b> ${title.trim()}`;
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

  async saveNote(userId: string, content: string, title?: string | null, url?: string | null, sourceMessageId?: number | null): Promise<TaskResult> {
    const res = await pool.query(
      `
      INSERT INTO notes (user_id, title, content, url, source_message_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, title, content;
      `,
      [userId, title || null, content.trim(), url || null, sourceMessageId || null]
    );

    const noteId = String(res.rows[0].id);

    return {
      text: `📌 <b>Saved Note:</b> ${title || content.slice(0, 60)}`,
      taskId: noteId,
    };
  }

  async completeTask(userId: string, taskId?: number | string | null, textHint?: string | null): Promise<TaskResult> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let targetId = taskId;

      // Fuzzy resolve task ID by textHint if not explicitly passed
      if (!targetId && textHint) {
        const matchRes = await client.query(
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
        await client.query('ROLLBACK');
        return { text: `❓ Couldn't find an open task matching "${textHint || ''}".` };
      }

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

  async dropTask(userId: string, taskId?: number, textHint?: string): Promise<TaskResult> {
    let targetId = taskId;

    if (!targetId && textHint) {
      const match = await pool.query(
        `
        SELECT id FROM tasks 
        WHERE user_id = $1 AND status = 'OPEN' AND similarity(title, $2) > 0.3
        ORDER BY similarity(title, $2) DESC 
        LIMIT 1;
        `,
        [userId, textHint]
      );
      if (match.rowCount && match.rowCount > 0) {
        targetId = Number(match.rows[0].id);
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
