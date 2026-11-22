import { pool } from '../db/pool.js';
import { User } from '../db/user.repo.js';
import { telegram, TelegramClient } from './telegram.client.js';

export interface ExportData {
  user: {
    id: string;
    telegram_user_id: string;
    first_name: string | null;
    timezone: string;
    default_reminder_time: string;
    created_at: Date;
  };
  tasks: Array<{
    id: string;
    title: string;
    details: string | null;
    status: string;
    due_at: Date | null;
    created_at: Date;
    completed_at: Date | null;
  }>;
  notes: Array<{
    id: string;
    title: string | null;
    content: string;
    url: string | null;
    created_at: Date;
  }>;
  reminders: Array<{
    id: string;
    task_id: string;
    kind: string;
    nudge_stage: number;
    fire_at: Date;
    status: string;
    sent_at: Date | null;
    acked_at: Date | null;
    ack_action: string | null;
  }>;
  messages_count: number;
}

export class PrivacyService {
  constructor(private tg: TelegramClient = telegram) {}

  /**
   * Generates structured dump of all user data
   */
  async getUserExportPayload(userId: string): Promise<ExportData> {
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const u = userRes.rows[0];

    const tasksRes = await pool.query(
      `SELECT id, title, details, status, due_at, created_at, completed_at FROM tasks WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId]
    );

    const notesRes = await pool.query(
      `SELECT id, title, content, url, created_at FROM notes WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId]
    );

    const remRes = await pool.query(
      `SELECT id, task_id, kind, nudge_stage, fire_at, status, sent_at, acked_at, ack_action FROM reminders WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId]
    );

    const msgCountRes = await pool.query(
      `SELECT count(*)::int AS count FROM messages WHERE user_id = $1`,
      [userId]
    );

    return {
      user: {
        id: String(u.id),
        telegram_user_id: String(u.telegram_user_id),
        first_name: u.first_name,
        timezone: u.timezone,
        default_reminder_time: u.default_reminder_time,
        created_at: u.created_at,
      },
      tasks: tasksRes.rows.map((r) => ({
        id: String(r.id),
        title: r.title,
        details: r.details,
        status: r.status,
        due_at: r.due_at,
        created_at: r.created_at,
        completed_at: r.completed_at,
      })),
      notes: notesRes.rows.map((r) => ({
        id: String(r.id),
        title: r.title,
        content: r.content,
        url: r.url,
        created_at: r.created_at,
      })),
      reminders: remRes.rows.map((r) => ({
        id: String(r.id),
        task_id: String(r.task_id),
        kind: r.kind,
        nudge_stage: r.nudge_stage,
        fire_at: r.fire_at,
        status: r.status,
        sent_at: r.sent_at,
        acked_at: r.acked_at,
        ack_action: r.ack_action,
      })),
      messages_count: msgCountRes.rows[0]?.count || 0,
    };
  }

  /**
   * Generates RFC 4180 compliant CSV string for user tasks
   */
  generateTasksCsv(tasks: ExportData['tasks']): string {
    const headers = ['ID', 'Title', 'Details', 'Status', 'Due Date (UTC)', 'Created At (UTC)', 'Completed At (UTC)'];
    const rows = tasks.map((t) => [
      t.id,
      this.escapeCsv(t.title),
      this.escapeCsv(t.details || ''),
      t.status,
      t.due_at ? new Date(t.due_at).toISOString() : '',
      new Date(t.created_at).toISOString(),
      t.completed_at ? new Date(t.completed_at).toISOString() : '',
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  private escapeCsv(val: string): string {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  }

  /**
   * Compiles data into JSON & CSV and sends them as Telegram documents
   */
  async exportAndSend(user: User, chatId: number | string): Promise<void> {
    const payload = await this.getUserExportPayload(user.id);

    // 1. Send JSON document
    const jsonStr = JSON.stringify(payload, null, 2);
    const jsonBuf = Buffer.from(jsonStr, 'utf-8');
    await this.tg.sendDocument(
      chatId,
      jsonBuf,
      `fewfeww-export-${user.telegram_user_id}.json`,
      `📦 <b>FewFeww Data Export (JSON)</b>\nFull structured archive of your account, tasks, notes, and reminders.`
    );

    // 2. Send CSV document
    const csvStr = this.generateTasksCsv(payload.tasks);
    const csvBuf = Buffer.from(csvStr, 'utf-8');
    await this.tg.sendDocument(
      chatId,
      csvBuf,
      `fewfeww-tasks-${user.telegram_user_id}.csv`,
      `📊 <b>FewFeww Tasks Export (CSV)</b>\nSpreadsheet view of your tasks.`
    );

    // Log event
    await pool.query(
      `INSERT INTO events (user_id, type, entity_type) VALUES ($1, 'user_data_exported', 'privacy')`,
      [user.id]
    );
  }

  /**
   * Permanently hard deletes user and cascades across all related tables (DPDP compliance)
   */
  async deleteUserCascade(userId: string): Promise<boolean> {
    const res = await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    return (res.rowCount ?? 0) > 0;
  }
}

export const privacyService = new PrivacyService();
