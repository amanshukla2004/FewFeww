import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { taskService } from './task.service.js';
import { userRepo } from '../db/user.repo.js';
import { pool } from '../db/pool.js';

describe('Rich Notes Appending & Tagging (Step 17)', () => {
  const testUserId = 771199;
  let dbUserId: string;

  beforeEach(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'NotesUser', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUserId = user.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('saves a note with tags and formats confirmation with tags', async () => {
    const res = await taskService.saveNote(
      dbUserId,
      'Review system architecture for Q1',
      'System Architecture',
      ['work', 'architecture']
    );

    expect(res.text).toContain('System Architecture');
    expect(res.text).toContain('#work');
    expect(res.text).toContain('#architecture');

    const noteCheck = await pool.query('SELECT tags FROM notes WHERE id = $1', [res.taskId]);
    expect(noteCheck.rows[0].tags).toEqual(['work', 'architecture']);
  });

  it('appends text to an existing note with timestamp divider', async () => {
    const original = await taskService.saveNote(
      dbUserId,
      'Discuss quarterly OKRs',
      'Meeting Agenda',
      ['meeting']
    );

    const appendRes = await taskService.appendNote(
      dbUserId,
      'Meeting Agenda',
      'Also review hiring plan'
    );

    expect(appendRes.text).toContain('Appended to Note:');
    expect(appendRes.text).toContain('Also review hiring plan');

    const updatedNote = await pool.query('SELECT content FROM notes WHERE id = $1', [original.taskId]);
    expect(updatedNote.rows[0].content).toContain('Discuss quarterly OKRs');
    expect(updatedNote.rows[0].content).toContain('--- [Added');
    expect(updatedNote.rows[0].content).toContain('Also review hiring plan');
  });

  it('creates a new note if appendNote does not find a match', async () => {
    const res = await taskService.appendNote(
      dbUserId,
      'Packing List',
      'Passport and travel adapter'
    );

    expect(res.text).toContain('Couldn\'t find existing note matching "Packing List", so I created a new one');

    const noteCheck = await pool.query('SELECT title, content FROM notes WHERE id = $1', [res.noteId]);
    expect(noteCheck.rows[0].title).toBe('Packing List');
    expect(noteCheck.rows[0].content).toBe('Passport and travel adapter');
  });

  it('lists notes and filters by tag', async () => {
    await taskService.saveNote(dbUserId, 'Buy presents', 'Birthday Ideas', ['personal']);
    await taskService.saveNote(dbUserId, 'API redesign', 'Backend Task', ['work']);

    const allNotes = await taskService.listNotes(dbUserId);
    expect(allNotes.text).toContain('Birthday Ideas');
    expect(allNotes.text).toContain('Backend Task');

    const filtered = await taskService.listNotes(dbUserId, 'work');
    expect(filtered.text).toContain('Backend Task');
    expect(filtered.text).not.toContain('Birthday Ideas');
  });
});
