import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { searchService } from './search.service.js';
import { taskService } from './task.service.js';
import { userRepo } from '../db/user.repo.js';
import { pool } from '../db/pool.js';

describe('Search Service (FTS & Trigram Similarity)', () => {
  const testUserId = 771122;
  let dbUserId: string;

  beforeEach(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'SearchUser', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUserId = user.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('finds tasks using PostgreSQL Full-Text Search (search_vector)', async () => {
    await taskService.createTask({
      userId: dbUserId,
      title: 'Submit DBMS practical lab assignment',
      details: 'Include schema diagrams and ER models',
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    await taskService.createTask({
      userId: dbUserId,
      title: 'Buy almond milk and coffee beans',
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    const res = await searchService.search(dbUserId, 'DBMS', 'TASKS');
    expect(res.results.length).toBe(1);
    expect(res.results[0].title).toContain('DBMS');
    expect(res.formattedText).toContain('Submit DBMS practical');
  });

  it('matches tasks with slight typos using pg_trgm similarity fallback', async () => {
    await taskService.createTask({
      userId: dbUserId,
      title: 'Microprocessor lab viva preparation',
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    // Slight typo "Microprossesor" (FTS fails, trigram catches)
    const res = await searchService.search(dbUserId, 'Microprossesor', 'TASKS');
    expect(res.results.length).toBeGreaterThanOrEqual(1);
    expect(res.results[0].title).toContain('Microprocessor');
  });

  it('finds notes by content search', async () => {
    await taskService.saveNote(dbUserId, 'Remember to check out the new Fastify v5 plugins documentation', 'Fastify Docs');

    const res = await searchService.search(dbUserId, 'Fastify', 'NOTES');
    expect(res.results.length).toBe(1);
    expect(res.results[0].type).toBe('NOTE');
    expect(res.formattedText).toContain('Fastify Docs');
  });

  it('returns clean empty notice when nothing matches', async () => {
    const res = await searchService.search(dbUserId, 'quantum teleportation algorithm', 'ALL');
    expect(res.results.length).toBe(0);
    expect(res.formattedText).toContain('No items found');
  });
});
