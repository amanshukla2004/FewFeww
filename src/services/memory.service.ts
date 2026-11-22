import { pool } from '../db/pool.js';

export interface MemoryItem {
  id: string;
  userId: string;
  keyPhrase: string;
  content: string;
  category: string;
  createdAt: Date;
  updatedAt: Date;
}

export class MemoryService {
  /**
   * Save or update a personal fact, preference, or credential in long-term AI memory.
   */
  async remember(
    userId: string,
    keyPhrase: string,
    content: string,
    category: string = 'GENERAL'
  ): Promise<{ memory: MemoryItem; formattedText: string }> {
    const cleanKey = keyPhrase.trim();
    const cleanContent = content.trim();

    // Check if an existing memory for this key exists to update it
    const existing = await pool.query(
      `
      SELECT id FROM ai_memories
      WHERE user_id = $1 AND lower(key_phrase) = lower($2)
      LIMIT 1;
      `,
      [userId, cleanKey]
    );

    let res;
    if (existing.rowCount && existing.rowCount > 0) {
      res = await pool.query(
        `
        UPDATE ai_memories
        SET content = $2, category = $3, updated_at = now()
        WHERE id = $1
        RETURNING *;
        `,
        [existing.rows[0].id, cleanContent, category]
      );
    } else {
      res = await pool.query(
        `
        INSERT INTO ai_memories (user_id, key_phrase, content, category)
        VALUES ($1, $2, $3, $4)
        RETURNING *;
        `,
        [userId, cleanKey, cleanContent, category]
      );
    }

    const row = res.rows[0];
    const memory: MemoryItem = {
      id: String(row.id),
      userId: String(row.user_id),
      keyPhrase: row.key_phrase,
      content: row.content,
      category: row.category,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    const formattedText = [
      `🧠 <b>Stored in AI Memory!</b>`,
      ``,
      `• <b>Subject:</b> <code>${memory.keyPhrase}</code>`,
      `• <b>Details:</b> ${memory.content}`,
      `• <b>Category:</b> <code>${memory.category}</code>`,
      ``,
      `<i>You can ask me anytime: "what is my ${memory.keyPhrase}?" or "forget my ${memory.keyPhrase}".</i>`,
    ].join('\n');

    return { memory, formattedText };
  }

  /**
   * Recall matching memories using PostgreSQL Full-Text Search and trigram similarity
   */
  async recall(userId: string, query: string): Promise<{ memories: MemoryItem[]; formattedText: string }> {
    const trimmed = query.trim();
    if (!trimmed) {
      return {
        memories: [],
        formattedText: `🧠 <b>AI Memory:</b> Please specify what you want to recall (e.g. <i>"what is my car license plate?"</i>).`,
      };
    }

    // 1. Try Full-Text Search
    const ftsRes = await pool.query(
      `
      SELECT id, user_id, key_phrase, content, category, created_at, updated_at,
             ts_rank(search_vector, plainto_tsquery('simple', $2)) AS rank
      FROM ai_memories
      WHERE user_id = $1 AND search_vector @@ plainto_tsquery('simple', $2)
      ORDER BY rank DESC, updated_at DESC
      LIMIT 5;
      `,
      [userId, trimmed]
    );

    let rows = ftsRes.rows;

    // 2. Fallback to Trigram / ILIKE similarity
    if (rows.length === 0) {
      const trgmRes = await pool.query(
        `
        SELECT id, user_id, key_phrase, content, category, created_at, updated_at,
               similarity(key_phrase, $2) AS sml
        FROM ai_memories
        WHERE user_id = $1 AND (similarity(key_phrase, $2) > 0.15 OR key_phrase ILIKE '%' || $2 || '%' OR content ILIKE '%' || $2 || '%')
        ORDER BY sml DESC, updated_at DESC
        LIMIT 5;
        `,
        [userId, trimmed]
      );
      rows = trgmRes.rows;
    }

    const memories: MemoryItem[] = rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      keyPhrase: r.key_phrase,
      content: r.content,
      category: r.category,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    if (memories.length === 0) {
      return {
        memories: [],
        formattedText: `🧠 <b>AI Memory:</b> I couldn't find any saved memories matching <i>"${trimmed}"</i>.\n\nYou can teach me by saying: <i>"Remember that my ${trimmed} is ..."</i>`,
      };
    }

    const lines = [`🧠 <b>AI Memory Recall:</b>`, ``];
    memories.forEach((m) => {
      lines.push(`• <b>${m.keyPhrase}:</b> ${m.content}`);
    });
    lines.push(``);
    lines.push(`<i>Ask "forget [item]" to delete any saved memory.</i>`);

    return { memories, formattedText: lines.join('\n') };
  }

  /**
   * List all stored memories for a user
   */
  async listMemories(userId: string, category?: string): Promise<{ memories: MemoryItem[]; formattedText: string }> {
    let query = `SELECT * FROM ai_memories WHERE user_id = $1`;
    const params: any[] = [userId];

    if (category) {
      query += ` AND lower(category) = lower($2)`;
      params.push(category);
    }
    query += ` ORDER BY updated_at DESC LIMIT 25;`;

    const res = await pool.query(query, params);
    const memories: MemoryItem[] = res.rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      keyPhrase: r.key_phrase,
      content: r.content,
      category: r.category,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    if (memories.length === 0) {
      return {
        memories: [],
        formattedText: `🧠 <b>AI Memory is empty!</b>\n\nYou haven't asked me to remember anything yet. Try saying:\n• <i>"Remember that my wifi password is SolarPass2026"</i>\n• <i>"Remember that I prefer window seats"</i>`,
      };
    }

    const lines = [`🧠 <b>Your Saved AI Memories (${memories.length}):</b>`, ``];
    memories.forEach((m) => {
      lines.push(`• <b>${m.keyPhrase}:</b> ${m.content} <code>[${m.category}]</code>`);
    });

    return { memories, formattedText: lines.join('\n') };
  }

  /**
   * Delete / forget a memory
   */
  async forget(userId: string, query: string): Promise<{ deleted: boolean; formattedText: string }> {
    const trimmed = query.trim();
    const res = await pool.query(
      `
      DELETE FROM ai_memories
      WHERE user_id = $1 AND (lower(key_phrase) = lower($2) OR similarity(key_phrase, $2) > 0.4 OR content ILIKE '%' || $2 || '%')
      RETURNING key_phrase;
      `,
      [userId, trimmed]
    );

    if ((res.rowCount ?? 0) === 0) {
      return {
        deleted: false,
        formattedText: `🧠 <b>AI Memory:</b> No memory found matching <i>"${trimmed}"</i> to forget.`,
      };
    }

    const deletedKeys = res.rows.map((r) => r.key_phrase).join(', ');
    return {
      deleted: true,
      formattedText: `🗑️ <b>Forgotten:</b> Removed <i>"${deletedKeys}"</i> from your AI memory.`,
    };
  }
}

export const memoryService = new MemoryService();
