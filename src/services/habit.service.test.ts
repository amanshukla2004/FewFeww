import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { habitService } from './habit.service.js';
import { userRepo } from '../db/user.repo.js';
import { pool } from '../db/pool.js';
import { DateTime } from 'luxon';

describe('Built-in Habit & Metric Tracker (Step 18)', () => {
  const testUserId = 665544;
  let dbUserId: string;

  beforeEach(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'HabitUser', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUserId = user.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('logs weight metric and calculates delta from previous entry', async () => {
    // 1st entry: 92 kg
    const first = await habitService.logHabit({
      userId: dbUserId,
      habitName: 'Weight',
      value: 92,
      unit: 'kg',
      loggedAt: DateTime.now().minus({ days: 30 }).toJSDate(),
    });
    expect(first.value).toBe(92);
    expect(first.delta).toBeNull();
    expect(first.formattedText).toContain('Logged Weight:</b> 92 kg');

    // 2nd entry: 90 kg
    const second = await habitService.logHabit({
      userId: dbUserId,
      habitName: 'Weight',
      value: 90,
      unit: 'kg',
      loggedAt: new Date(),
    });
    expect(second.value).toBe(90);
    expect(second.delta).toBe(-2);
    expect(second.formattedText).toContain('-2 since');
    expect(second.formattedText).toContain('Logged Weight:</b> 90 kg');
  });

  it('logs LeetCode problems and calculates rolling weekly sum and active days', async () => {
    // Yesterday: 3 problems
    await habitService.logHabit({
      userId: dbUserId,
      habitName: 'LeetCode',
      value: 3,
      unit: 'problems',
      loggedAt: DateTime.now().minus({ days: 1 }).toJSDate(),
    });

    // Today: 5 problems
    const today = await habitService.logHabit({
      userId: dbUserId,
      habitName: 'LeetCode',
      value: 5,
      unit: 'problems',
      loggedAt: new Date(),
    });

    expect(today.weeklySum).toBe(8);
    expect(today.streak).toBe(2);
    expect(today.formattedText).toContain('7-Day Total:</b> 8 problems solved');
  });

  it('formats time-series dataPoints for web dashboard graphs', async () => {
    await habitService.logHabit({
      userId: dbUserId,
      habitName: 'Water',
      value: 2.5,
      unit: 'liters',
      notes: 'hydrated well',
    });

    const series = await habitService.getHabitTimeSeries(dbUserId, 'Water', 7);
    expect(series.habit.name).toBe('Water');
    expect(series.habit.unit).toBe('liters');
    expect(series.dataPoints.length).toBe(1);
    expect(series.dataPoints[0].value).toBe(2.5);
    expect(series.dataPoints[0].notes).toBe('hydrated well');
    expect(series.dataPoints[0].timestamp).toBeDefined();
  });

  it('formats habit stats overview and specific habit history', async () => {
    await habitService.logHabit({
      userId: dbUserId,
      habitName: 'Reading',
      value: 20,
      unit: 'pages',
    });

    // All habits overview
    const overview = await habitService.formatHabitStats(dbUserId);
    expect(overview.text).toContain('Reading:</b> 20 pages');

    // Specific habit summary
    const specific = await habitService.formatHabitStats(dbUserId, 'Reading');
    expect(specific.text).toContain('Reading Summary:');
    expect(specific.text).toContain('20 pages');
  });
});
