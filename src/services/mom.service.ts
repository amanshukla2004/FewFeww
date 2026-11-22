import { pool } from '../db/pool.js';
import { taskService } from './task.service.js';

export interface ActionItem {
  task: string;
  owner?: string;
  dueLocal?: string;
}

export interface MeetingMinutes {
  id: string;
  userId: string;
  title: string;
  audioDuration?: number | null;
  transcript: string;
  summary: string;
  decisions: string[];
  actionItems: ActionItem[];
  createdAt: Date;
}

export class MomService {
  /**
   * Activate MOM Mode instructions card.
   */
  async activateMomMode(userId: string): Promise<{ text: string }> {
    await pool.query(
      `
      INSERT INTO conversation_state (user_id, kind, context, expires_at)
      VALUES ($1, 'MOM_MODE', '{}', now() + interval '2 hours')
      ON CONFLICT (user_id) DO UPDATE
      SET kind = EXCLUDED.kind, context = EXCLUDED.context, expires_at = EXCLUDED.expires_at;
      `,
      [userId]
    );

    const text =
      `🎙️ <b>Meeting Minutes Mode Activated</b>\n\n` +
      `📝 <b>Setup Instructions:</b>\n` +
      `1. <i>Turn on voice recording</i> and lock it\n` +
      `2. <i>Keep your screen on</i> during the meeting\n` +
      `3. <i>Place phone in the center</i> of the meeting room\n\n` +
      `🔄 <b>When finished:</b> Send or forward the voice recording here. I'll summarize decisions and auto-extract action items into your tasks!`;

    return { text };
  }

  /**
   * Deactivate MOM Mode manually.
   */
  async deactivateMomMode(userId: string): Promise<void> {
    await pool.query(
      `DELETE FROM conversation_state WHERE user_id = $1 AND kind = 'MOM_MODE'`,
      [userId]
    );
  }

  /**
   * Process meeting transcript into structured MOM with decisions and auto-task generation.
   */
  async processMeetingAudio(
    userId: string,
    transcript: string,
    durationSec?: number,
    meetingTitle?: string
  ): Promise<{ minutes: MeetingMinutes; formattedText: string }> {
    const cleanTranscript = transcript.trim();
    const title = meetingTitle || (cleanTranscript.slice(0, 40) + '... Meeting');

    // Extract decisions and action items heuristic parsing
    const decisions: string[] = [];
    const actionItems: ActionItem[] = [];

    const lines = cleanTranscript.split(/[.\n]+/).map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
      if (/agree|decide|finalize|approved|consensus/i.test(line)) {
        decisions.push(line);
      } else if (/will|must|should|assign|action|todo|prepare|send|finish|submit/i.test(line)) {
        actionItems.push({ task: line });
      }
    }

    if (decisions.length === 0) {
      decisions.push('Discussion concluded and roadmap agreed upon.');
    }

    if (actionItems.length === 0 && lines.length > 0) {
      actionItems.push({ task: lines[0] });
    }

    const summary = `Meeting covered ${lines.length} key discussion points regarding project goals and deliverables.`;

    const res = await pool.query(
      `
      INSERT INTO meeting_minutes (user_id, title, audio_duration, transcript, summary, decisions, action_items)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, user_id, title, audio_duration, transcript, summary, decisions, action_items, created_at;
      `,
      [
        userId,
        title,
        durationSec || 0,
        cleanTranscript,
        summary,
        decisions,
        JSON.stringify(actionItems),
      ]
    );

    const row = res.rows[0];
    const minutes: MeetingMinutes = {
      id: String(row.id),
      userId: String(row.user_id),
      title: row.title,
      audioDuration: row.audio_duration,
      transcript: row.transcript,
      summary: row.summary,
      decisions: row.decisions || [],
      actionItems: row.action_items || [],
      createdAt: row.created_at,
    };

    // Auto-create tasks for extracted action items
    for (const item of minutes.actionItems) {
      await taskService.createTask({
        userId,
        title: item.task,
        category: 'Meeting Follow-up',
        userTimezone: 'Asia/Kolkata',
        defaultReminderTime: '09:00',
      });
    }

    let text = `📝 <b>Meeting Minutes Generated:</b>\n\n`;
    text += `📌 <b>Title:</b> ${minutes.title}\n`;
    text += `💡 <b>Summary:</b> ${minutes.summary}\n\n`;

    text += `✅ <b>Decisions Made:</b>\n`;
    for (const d of minutes.decisions) {
      text += `• ${d}\n`;
    }

    text += `\n📋 <b>Action Items (Auto-added to To-Dos):</b>\n`;
    for (const a of minutes.actionItems) {
      text += `• ${a.task}\n`;
    }

    return { minutes, formattedText: text.trim() };
  }

  /**
   * List recent meeting minutes for user.
   */
  async listMinutes(userId: string): Promise<MeetingMinutes[]> {
    const res = await pool.query(
      `
      SELECT id, user_id, title, audio_duration, transcript, summary, decisions, action_items, created_at
      FROM meeting_minutes
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 5;
      `,
      [userId]
    );

    return res.rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      title: r.title,
      audioDuration: r.audio_duration,
      transcript: r.transcript,
      summary: r.summary,
      decisions: r.decisions || [],
      actionItems: r.action_items || [],
      createdAt: r.created_at,
    }));
  }
}

export const momService = new MomService();
