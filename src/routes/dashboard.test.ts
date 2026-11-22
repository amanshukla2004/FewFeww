import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildServer } from '../server.js';
import { habitService } from '../services/habit.service.js';
import { taskService } from '../services/task.service.js';
import { circleService } from '../services/circle.service.js';
import { pool } from '../db/pool.js';
import { userRepo } from '../db/user.repo.js';
import { FastifyInstance } from 'fastify';

describe('Web Dashboard & Interactive Habit Graphs (Step 28)', () => {
  let app: FastifyInstance;
  let testUserId: string;
  const testChatId = 7700667788;

  beforeEach(async () => {
    await pool.query('DELETE FROM habit_logs;');
    await pool.query('DELETE FROM habits;');
    await pool.query('DELETE FROM tasks;');
    await pool.query('DELETE FROM circles;');
    await pool.query('DELETE FROM users WHERE telegram_chat_id = $1;', [testChatId]);

    const { user } = await userRepo.findOrCreate(testChatId, testChatId, 'DashUser', 'en');
    testUserId = user.id;

    app = buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves HTML dashboard page with 200 OK (GET /dashboard)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/dashboard?userId=${testUserId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('FewFeww');
    expect(res.body).toContain('Weight Tracking Over Time');
    expect(res.body).toContain('LeetCode Problem Solved Activity');
  });

  it('returns JSON time-series stats for weight, habits, tasks, and circles (GET /api/dashboard/stats)', async () => {
    // 1. Log two weight entries over time
    await habitService.logHabit({
      userId: testUserId,
      habitName: 'Weight',
      value: 90,
      unit: 'kg',
    });
    await habitService.logHabit({
      userId: testUserId,
      habitName: 'Weight',
      value: 88.5,
      unit: 'kg',
    });

    // 2. Log LeetCode problems
    await habitService.logHabit({
      userId: testUserId,
      habitName: 'LeetCode',
      value: 5,
      unit: 'problems',
    });

    // 3. Create a categorized task
    await taskService.createTask({
      userId: testUserId,
      title: 'Review System Architecture',
      category: 'Work',
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    // 4. Create a circle
    await circleService.createCircle(testUserId, 'Core Engineering');

    const res = await app.inject({
      method: 'GET',
      url: `/api/dashboard/stats?userId=${testUserId}`,
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);

    // Habits verification
    expect(data.habits.length).toBe(2);
    const weightData = data.habits.find((h: any) => h.name === 'Weight');
    expect(weightData).toBeDefined();
    expect(weightData.history.length).toBe(2);
    expect(Number(weightData.history[0].value)).toBe(90);
    expect(Number(weightData.history[1].value)).toBe(88.5);

    // Tasks verification
    expect(data.tasks.length).toBe(1);
    expect(data.tasks[0].title).toBe('Review System Architecture');
    expect(data.tasks[0].category).toBe('Work');

    // Circles verification
    expect(data.circles.length).toBe(1);
    expect(data.circles[0].name).toBe('Core Engineering');
    expect(data.circles[0].member_count).toBeGreaterThanOrEqual(1);
  });
});
