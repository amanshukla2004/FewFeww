import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { circleService, CircleService } from './circle.service.js';
import { CommandRouter } from './command.router.js';
import { UpdateDispatcher } from './dispatcher.js';
import { TelegramClient } from './telegram.client.js';
import { userRepo } from '../db/user.repo.js';
import { pool } from '../db/pool.js';

describe('Circles & Deep-Link Invitation Engine (Step 22)', () => {
  const ownerTgId = 443322;
  const memberTgId = 443323;
  let ownerUser: any;
  let memberUser: any;
  let mockTg: TelegramClient;
  let dispatcher: UpdateDispatcher;
  let router: CommandRouter;

  beforeEach(async () => {
    mockTg = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 777 }),
      editMessageText: vi.fn().mockResolvedValue({ message_id: 777 }),
      answerCallbackQuery: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as TelegramClient;

    dispatcher = new UpdateDispatcher(mockTg);
    router = new CommandRouter();

    // Clean up test users
    await pool.query('DELETE FROM users WHERE telegram_user_id IN ($1, $2)', [
      String(ownerTgId),
      String(memberTgId),
    ]);

    const ownerRes = await userRepo.findOrCreate(ownerTgId, ownerTgId, 'AliceOwner', 'en');
    await userRepo.setOnboardingState(ownerRes.user.id, 'ACTIVE');
    ownerUser = ownerRes.user;

    const memberRes = await userRepo.findOrCreate(memberTgId, memberTgId, 'BobMember', 'en');
    await userRepo.setOnboardingState(memberRes.user.id, 'ACTIVE');
    memberUser = memberRes.user;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id IN ($1, $2)', [
      String(ownerTgId),
      String(memberTgId),
    ]);
    await pool.end();
  });

  it('creates circle and generates cryptographic invite link', async () => {
    const res = await circleService.createCircle(ownerUser.id, 'Family');

    expect(res.circle.name).toBe('Family');
    expect(res.circle.inviteCode).toMatch(/^fami_[a-f0-9]{8}$/);
    expect(res.inviteUrl).toContain(`start=join_${res.circle.inviteCode}`);
    expect(res.formattedText).toContain('Circle Created:</b> <b>Family</b>');

    // Verify owner added as member in DB
    const memberCheck = await pool.query(
      `SELECT status FROM circle_members WHERE circle_id = $1 AND user_id = $2`,
      [res.circle.id, ownerUser.id]
    );
    expect(memberCheck.rowCount).toBe(1);
    expect(memberCheck.rows[0].status).toBe('ACTIVE');
  });

  it('allows another user to join circle via token and notifies owner', async () => {
    const customService = new CircleService(mockTg);
    const { circle } = await customService.createCircle(ownerUser.id, 'Flatmates');

    // Bob joins via token
    const joinRes = await customService.joinCircleByToken(circle.inviteCode, memberUser);

    expect(joinRes.success).toBe(true);
    expect(joinRes.circleName).toBe('Flatmates');
    expect(joinRes.formattedText).toContain('You are now a member of <b>Flatmates</b>');

    // Check Bob is active member in DB
    const memberCheck = await pool.query(
      `SELECT status FROM circle_members WHERE circle_id = $1 AND user_id = $2`,
      [circle.id, memberUser.id]
    );
    expect(memberCheck.rowCount).toBe(1);
    expect(memberCheck.rows[0].status).toBe('ACTIVE');

    // Check owner was notified
    expect(mockTg.sendMessage).toHaveBeenCalledWith(
      String(ownerTgId),
      expect.stringContaining('has joined your circle')
    );
  });

  it('handles /start join_<token> command routing', async () => {
    const { circle } = await circleService.createCircle(ownerUser.id, 'Dev Team');

    const cmdRes = await router.handleCommand(memberUser, `/start join_${circle.inviteCode}`);
    expect(cmdRes.text).toContain('You are now a member of <b>Dev Team</b>');

    const memberCheck = await pool.query(
      `SELECT status FROM circle_members WHERE circle_id = $1 AND user_id = $2`,
      [circle.id, memberUser.id]
    );
    expect(memberCheck.rowCount).toBe(1);
  });

  it('lists user circles with member counts and deep links', async () => {
    const { circle } = await circleService.createCircle(ownerUser.id, 'Study Group');
    await circleService.joinCircleByToken(circle.inviteCode, memberUser);

    const listRes = await circleService.listUserCircles(ownerUser.id);
    expect(listRes.circles.length).toBeGreaterThanOrEqual(1);

    const study = listRes.circles.find((c) => c.name === 'Study Group');
    expect(study).toBeDefined();
    expect(study?.memberCount).toBe(2);
    expect(listRes.formattedText).toContain('<b>Study Group</b> (2 members)');
    expect(listRes.formattedText).toContain(`start=join_${study?.inviteCode}`);
  });

  it('broadcasts circle reminder to all other active members', async () => {
    const customService = new CircleService(mockTg);
    const { circle } = await customService.createCircle(ownerUser.id, 'Dinner Club');
    await customService.joinCircleByToken(circle.inviteCode, memberUser);

    const broadcastRes = await customService.broadcastCircleReminder(
      ownerUser,
      'Dinner Club',
      'Table booked at 8pm tonight'
    );

    expect(broadcastRes.sentCount).toBe(1);
    expect(broadcastRes.formattedText).toContain('Dispatched reminder <i>"Table booked at 8pm tonight"</i> to <b>1 member(s)</b>');

    // Bob received message
    expect(mockTg.sendMessage).toHaveBeenCalledWith(
      String(memberTgId),
      expect.stringContaining('Table booked at 8pm tonight')
    );
  });

  it('executes create_circle and show_circles tool calls via UpdateDispatcher', async () => {
    await (dispatcher as any).executeToolCall(ownerUser, ownerTgId, {
      name: 'create_circle',
      args: { name: 'Book Club' },
    });

    expect(mockTg.sendMessage).toHaveBeenCalledWith(
      ownerTgId,
      expect.stringContaining('Book Club'),
      undefined
    );

    await (dispatcher as any).executeToolCall(ownerUser, ownerTgId, {
      name: 'show_circles',
      args: {},
    });

    expect(mockTg.sendMessage).toHaveBeenCalledWith(
      ownerTgId,
      expect.stringContaining('Book Club'),
      undefined
    );
  });
});
