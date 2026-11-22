import { pool } from '../db/pool.js';
import { DateTime } from 'luxon';

export interface SearchResultItem {
  id: string;
  type: 'TASK' | 'NOTE';
  title: string;
  details?: string | null;
  status?: string;
  dueAt?: Date | null;
  createdAt: Date;
  score?: number;
}

export class SearchService {
  /**
   * Search tasks and notes using PostgreSQL Full-Text Search (simple dictionary)
   * with fallback to pg_trgm trigram similarity for typo tolerance.
   */
  async search(
    userId: string,
    query: string,
    scope: 'TASKS' | 'NOTES' | 'ALL' = 'ALL'
  ): Promise<{ results: SearchResultItem[]; formattedText: string }> {
    const trimmed = query.trim();
    if (!trimmed) {
      return {
        results: [],
        formattedText: `🔍 Please provide search keywords (e.g. <i>"search DBMS"</i>).`,
      };
    }

    const results: SearchResultItem[] = [];

    // 1. Search Tasks
    if (scope === 'ALL' || scope === 'TASKS') {
      // First attempt: FTS using plainto_tsquery('simple', ...)
      const ftsRes = await pool.query(
        `
        SELECT id, title, details, status, due_at, created_at,
               ts_rank(search_vector, plainto_tsquery('simple', $2)) AS rank
        FROM tasks
        WHERE user_id = $1 AND search_vector @@ plainto_tsquery('simple', $2)
        ORDER BY rank DESC, created_at DESC
        LIMIT 10;
        `,
        [userId, trimmed]
      );

      if (ftsRes.rowCount && ftsRes.rowCount > 0) {
        for (const row of ftsRes.rows) {
          results.push({
            id: String(row.id),
            type: 'TASK',
            title: row.title,
            details: row.details,
            status: row.status,
            dueAt: row.due_at,
            createdAt: row.created_at,
            score: Number(row.rank),
          });
        }
      } else {
        // Fallback: Trigram similarity for typo handling
        const trgmRes = await pool.query(
          `
          SELECT id, title, details, status, due_at, created_at,
                 similarity(title, $2) AS sml
          FROM tasks
          WHERE user_id = $1 AND similarity(title, $2) > 0.2
          ORDER BY sml DESC
          LIMIT 5;
          `,
          [userId, trimmed]
        );

        for (const row of trgmRes.rows) {
          results.push({
            id: String(row.id),
            type: 'TASK',
            title: row.title,
            details: row.details,
            status: row.status,
            dueAt: row.due_at,
            createdAt: row.created_at,
            score: Number(row.sml),
          });
        }
      }
    }

    // 2. Search Notes
    if (scope === 'ALL' || scope === 'NOTES') {
      const notesRes = await pool.query(
        `
        SELECT id, title, content, created_at,
               ts_rank(search_vector, plainto_tsquery('simple', $2)) AS rank
        FROM notes
        WHERE user_id = $1 AND search_vector @@ plainto_tsquery('simple', $2)
        ORDER BY rank DESC, created_at DESC
        LIMIT 10;
        `,
        [userId, trimmed]
      );

      for (const row of notesRes.rows) {
        results.push({
          id: String(row.id),
          type: 'NOTE',
          title: row.title || 'Note',
          details: row.content,
          createdAt: row.created_at,
          score: Number(row.rank),
        });
      }
    }

    // Format Telegram HTML message
    if (results.length === 0) {
      return {
        results: [],
        formattedText: `🔍 No items found matching <i>"${trimmed}"</i>.`,
      };
    }

    let text = `🔍 <b>Search results for:</b> <i>"${trimmed}"</i>\n\n`;

    const tasks = results.filter((r) => r.type === 'TASK');
    if (tasks.length > 0) {
      text += `<b>Tasks:</b>\n`;
      tasks.forEach((t) => {
        const icon = t.status === 'DONE' ? '✅' : t.status === 'DROPPED' ? '🗑' : '📌';
        let dueStr = '';
        if (t.dueAt) {
          dueStr = ` (due ${DateTime.fromJSDate(t.dueAt).toFormat('dd LLL, hh:mm a')})`;
        }
        text += `• ${icon} <b>${t.title}</b>${dueStr}\n`;
      });
      text += '\n';
    }

    const notes = results.filter((r) => r.type === 'NOTE');
    if (notes.length > 0) {
      text += `<b>Notes:</b>\n`;
      notes.forEach((n) => {
        text += `• 📝 <b>${n.title}</b>: <i>${n.details || ''}</i>\n`;
      });
    }

    return { results, formattedText: text.trim() };
  }
}

export const searchService = new SearchService();
