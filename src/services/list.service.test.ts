import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import { listService } from './list.service.js';
import { taskService } from './task.service.js';
import { userRepo } from '../db/user.repo.js';
import { pool } from '../db/pool.js';

describe('Smart To-Do Lists & Category Management (Step 16)', () => {
  const testUserId = 998877;
  let dbUserId: string;

  beforeEach(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'TodoListUser', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUserId = user.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('creates and retrieves a new to-do list', async () => {
    const list = await listService.createList(dbUserId, 'Shopping');
    expect(list.id).toBeDefined();
    expect(list.name).toBe('Shopping');

    const lists = await listService.getUserLists(dbUserId);
    expect(lists.length).toBe(1);
    expect(lists[0].name).toBe('Shopping');
    expect(lists[0].openCount).toBe(0);
  });

  it('reuses existing list case-insensitively with getOrCreateList', async () => {
    const list1 = await listService.getOrCreateList(dbUserId, 'Work');
    const list2 = await listService.getOrCreateList(dbUserId, 'work');

    expect(list1.id).toBe(list2.id);
  });

  it('adds a task to a category list and formats confirmation with list badge', async () => {
    const res = await taskService.createTask({
      userId: dbUserId,
      title: 'buy almond milk',
      category: 'Groceries',
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    expect(res.text).toContain('buy almond milk');
    expect(res.text).toContain('List:</b> Groceries');

    const tasksInList = await listService.getTasksInList(dbUserId, 'Groceries');
    expect(tasksInList.length).toBe(1);
    expect(tasksInList[0].title).toBe('buy almond milk');
  });

  it('completes all items in a category', async () => {
    // Add two items to 'Weekend Plans'
    await taskService.createTask({
      userId: dbUserId,
      title: 'Buy cinema tickets',
      category: 'Weekend Plans',
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });
    await taskService.createTask({
      userId: dbUserId,
      title: 'Book restaurant table',
      category: 'Weekend Plans',
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    const openBefore = await listService.getTasksInList(dbUserId, 'Weekend Plans');
    expect(openBefore.length).toBe(2);

    const completedCount = await listService.completeAllInList(dbUserId, 'Weekend Plans');
    expect(completedCount).toBe(2);

    const openAfter = await listService.getTasksInList(dbUserId, 'Weekend Plans');
    expect(openAfter.length).toBe(0);
  });

  it('formats list overview and item views with interactive buttons', async () => {
    await taskService.createTask({
      userId: dbUserId,
      title: 'Inspect pull request',
      category: 'Work',
      userTimezone: 'Asia/Kolkata',
      defaultReminderTime: '09:00',
    });

    const overview = await listService.formatListsOverview(dbUserId);
    expect(overview.text).toContain('Work');
    expect(overview.keyboard).toBeDefined();
    expect(overview.keyboard?.[0][0].callback_data).toBe('l:v:Work');

    const itemDetails = await listService.formatListItems(dbUserId, 'Work');
    expect(itemDetails.text).toContain('Work List');
    expect(itemDetails.text).toContain('Inspect pull request');
    expect(itemDetails.keyboard?.[0][0].callback_data).toBe('l:doneall:Work');
  });
});
