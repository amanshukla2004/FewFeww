import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { taskService } from './task.service.js';
import { userRepo } from '../db/user.repo.js';
import { pool } from '../db/pool.js';

describe('TaskService & Database Operations', () => {
  const testUserId = 771122;
  let dbUserId: string;

  beforeEach(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'Pooja', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUserId = user.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('creates task with due date and schedules corresponding reminder', async () => {
    const res = await taskService.createTask({
      userId: dbUserId,
      title: 'Submit DBMS assignment',
      dueLocal: '2026-12-04T18:00:00',
      timeIsExplicit: true,
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    expect(res.text).toContain('Task Created');
    expect(res.text).toContain('Submit DBMS assignment');
    expect(res.keyboard).toBeDefined();
    expect(res.keyboard![0][0].callback_data).toContain('u:task:');

    // Verify task in DB
    const taskRes = await pool.query('SELECT * FROM tasks WHERE user_id = $1', [dbUserId]);
    expect(taskRes.rowCount).toBe(1);
    expect(taskRes.rows[0].title).toBe('Submit DBMS assignment');
    expect(taskRes.rows[0].status).toBe('OPEN');

    // Verify reminder in DB
    const remRes = await pool.query('SELECT * FROM reminders WHERE task_id = $1', [taskRes.rows[0].id]);
    expect(remRes.rowCount).toBe(1);
    expect(remRes.rows[0].kind).toBe('USER');
    expect(remRes.rows[0].status).toBe('SCHEDULED');
  });

  it('saves an unstructured note to notes table', async () => {
    const res = await taskService.saveNote(
      dbUserId,
      'Remember to check out Fastify v5 documentation',
      'Fastify Research',
      'https://fastify.dev'
    );

    expect(res.text).toContain('Saved Note');
    const noteRes = await pool.query('SELECT * FROM notes WHERE user_id = $1', [dbUserId]);
    expect(noteRes.rowCount).toBe(1);
    expect(noteRes.rows[0].title).toBe('Fastify Research');
    expect(noteRes.rows[0].url).toBe('https://fastify.dev');
  });

  it('completes task and cancels pending reminders', async () => {
    const created = await taskService.createTask({
      userId: dbUserId,
      title: 'Finish lab work',
      dueLocal: '2026-12-10T15:00:00',
      timeIsExplicit: true,
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    const completeRes = await taskService.completeTask(dbUserId, created.taskId);
    expect(completeRes.text).toContain('Marked Done');

    // Verify task status is DONE
    const taskRes = await pool.query('SELECT * FROM tasks WHERE id = $1', [created.taskId]);
    expect(taskRes.rows[0].status).toBe('DONE');

    // Verify reminder is CANCELLED
    const remRes = await pool.query('SELECT * FROM reminders WHERE task_id = $1', [created.taskId]);
    expect(remRes.rows[0].status).toBe('CANCELLED');
  });

  it('undos task creation when undo is tapped', async () => {
    const created = await taskService.createTask({
      userId: dbUserId,
      title: 'Accidental task',
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    const undoMsg = await taskService.undoTaskCreation(dbUserId, created.taskId!);
    expect(undoMsg).toContain('Undone');

    const checkRes = await pool.query('SELECT * FROM tasks WHERE id = $1', [created.taskId]);
    expect(checkRes.rowCount).toBe(0);
  });
});
