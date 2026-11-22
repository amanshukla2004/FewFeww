import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { userRepo } from '../db/user.repo.js';
import { onboardingService } from './onboarding.service.js';
import { commandRouter } from './command.router.js';
import { pool } from '../db/pool.js';

describe('Onboarding State Machine & Command Router', () => {
  const testTgUserId = 99112233;
  const testChatId = 99112233;

  beforeEach(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testTgUserId)]);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testTgUserId)]);
    await pool.end();
  });

  it('progresses through 4 onboarding steps to ACTIVE', async () => {
    // 1. Initial creation
    const { user: user0, isNew } = await userRepo.findOrCreate(testTgUserId, testChatId, 'Raj', 'en');
    expect(isNew).toBe(true);
    expect(user0.onboarding_state).toBe('NEW');

    // 2. /start command moves to AWAITING_CONSENT
    const startStep = await onboardingService.startOnboarding(user0);
    expect(startStep.text).toContain('Welcome to FewFeww');
    expect(startStep.keyboard[0][0].callback_data).toBe('ob:consent');

    const user1 = await userRepo.findByTelegramId(testTgUserId);
    expect(user1?.onboarding_state).toBe('AWAITING_CONSENT');

    // 3. User taps "I Agree" -> moves to AWAITING_TZ
    const tzStep = await onboardingService.handleConsent(user1!);
    expect(tzStep.text).toContain('timezone');
    expect(tzStep.keyboard[0][0].callback_data).toBe('ob:tz:Asia/Kolkata');

    const user2 = await userRepo.findByTelegramId(testTgUserId);
    expect(user2?.onboarding_state).toBe('AWAITING_TZ');
    expect(user2?.consented_at).not.toBeNull();

    // 4. User selects timezone -> moves to AWAITING_TIME
    const timeStep = await onboardingService.handleTimezone(user2!, 'Asia/Kolkata');
    expect(timeStep.text).toContain('Default Reminder Time');
    expect(timeStep.keyboard[0][1].callback_data).toBe('ob:time:09:00');

    const user3 = await userRepo.findByTelegramId(testTgUserId);
    expect(user3?.onboarding_state).toBe('AWAITING_TIME');
    expect(user3?.timezone).toBe('Asia/Kolkata');

    // 5. User selects 09:00 AM -> moves to ACTIVE
    const finishStep = await onboardingService.handleDefaultTime(user3!, '09:00');
    expect(finishStep.text).toContain("You're all set!");

    const userActive = await userRepo.findByTelegramId(testTgUserId);
    expect(userActive?.onboarding_state).toBe('ACTIVE');
    expect(userActive?.default_reminder_time).toBe('09:00:00');
  });

  it('blocks free-text tasks before user is ACTIVE', async () => {
    const { user } = await userRepo.findOrCreate(testTgUserId, testChatId, 'Raj', 'en');
    const updatedUser = await userRepo.setOnboardingState(user.id, 'AWAITING_TZ');

    const prompt = onboardingService.getPendingStepPrompt(updatedUser);
    expect(prompt.text).toContain('Please select your timezone first');
    expect(prompt.keyboard).toBeDefined();
  });

  it('routes commands correctly for ACTIVE user', async () => {
    const { user } = await userRepo.findOrCreate(testTgUserId, testChatId, 'Raj', 'en');
    const activeUser = await userRepo.setOnboardingState(user.id, 'ACTIVE');

    // Test /help
    const helpRes = await commandRouter.handleCommand(activeUser, '/help');
    expect(helpRes.text).toContain('Cheatsheet & Tips');

    // Test /settings
    const settingsRes = await commandRouter.handleCommand(activeUser, '/settings');
    expect(settingsRes.text).toContain('Your FewFeww Settings');
    expect(settingsRes.keyboard).toBeDefined();

    // Test /start for active user
    const startRes = await commandRouter.handleCommand(activeUser, '/start');
    expect(startRes.text).toContain('Welcome back, Raj!');
  });

  it('guarantees all onboarding callback payloads are well under 64 bytes', () => {
    const callbacks = ['ob:consent', 'ob:tz:Asia/Kolkata', 'ob:tz:UTC', 'ob:time:08:00', 'ob:time:09:00', 'ob:time:10:00'];
    for (const cb of callbacks) {
      const byteLen = Buffer.byteLength(cb, 'utf8');
      expect(byteLen).toBeLessThanOrEqual(64);
      expect(byteLen).toBeLessThan(25); // strict headroom check
    }
  });
});
