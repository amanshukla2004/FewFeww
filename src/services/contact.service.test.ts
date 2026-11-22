import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { contactService } from './contact.service.js';
import { UpdateDispatcher } from './dispatcher.js';
import { TelegramClient } from './telegram.client.js';
import { userRepo } from '../db/user.repo.js';
import { pool } from '../db/pool.js';

describe('Contact Directory Service (Step 21)', () => {
  const testUserId = 554433;
  let dbUserId: string;
  let mockTg: TelegramClient;
  let dispatcher: UpdateDispatcher;

  beforeEach(async () => {
    mockTg = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 999 }),
      editMessageText: vi.fn().mockResolvedValue({ message_id: 999 }),
      answerCallbackQuery: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as TelegramClient;

    dispatcher = new UpdateDispatcher(mockTg);

    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'ContactOwner', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    dbUserId = user.id;

    // Clean up contacts for this user
    await pool.query('DELETE FROM contacts WHERE user_id = $1', [dbUserId]);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('adds a new contact with phone, email, and telegram username', async () => {
    const res = await contactService.addContact({
      userId: dbUserId,
      name: 'John Doe',
      phone: '+919876543210',
      email: 'john@example.com',
      telegramUsername: '@johndoe',
    });

    expect(res.contact.name).toBe('John Doe');
    expect(res.contact.phone).toBe('+919876543210');
    expect(res.contact.email).toBe('john@example.com');
    expect(res.contact.telegramUsername).toBe('johndoe');
    expect(res.formattedText).toContain('John Doe');
    expect(res.formattedText).toContain('+919876543210');
  });

  it('auto-links telegram_user_id when username matches an existing user in system', async () => {
    // Seed peer user
    const peerTgId = 11223344;
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(peerTgId)]);
    await userRepo.findOrCreate(peerTgId, peerTgId, 'SarahConnor', 'en');

    const res = await contactService.addContact({
      userId: dbUserId,
      name: 'Sarah Connor',
      telegramUsername: 'sarahconnor',
    });

    expect(res.contact.telegramUserId).toBe(String(peerTgId));
  });

  it('searches and finds contact by name or username', async () => {
    await contactService.addContact({
      userId: dbUserId,
      name: 'Michael Scott',
      phone: '555-0199',
    });

    const found = await contactService.findContact(dbUserId, 'michael');
    expect(found).not.toBeNull();
    expect(found?.name).toBe('Michael Scott');
    expect(found?.phone).toBe('555-0199');

    const notFound = await contactService.findContact(dbUserId, 'Dwight');
    expect(notFound).toBeNull();
  });

  it('lists saved contacts formatted in alphabetical order', async () => {
    await contactService.addContact({ userId: dbUserId, name: 'Zack' });
    await contactService.addContact({ userId: dbUserId, name: 'Alice', phone: '123' });

    const listRes = await contactService.listContacts(dbUserId);
    expect(listRes.contacts.length).toBe(2);
    expect(listRes.contacts[0].name).toBe('Alice');
    expect(listRes.contacts[1].name).toBe('Zack');
    expect(listRes.formattedText).toContain('<b>Alice</b> — 📞 <code>123</code>');
    expect(listRes.formattedText).toContain('Zack');
  });

  it('deletes a contact by ID or name', async () => {
    const { contact } = await contactService.addContact({ userId: dbUserId, name: 'Temporary Guy' });
    const deleted = await contactService.deleteContact(dbUserId, contact.id);
    expect(deleted).toBe(true);

    const recheck = await contactService.findContact(dbUserId, 'Temporary Guy');
    expect(recheck).toBeNull();
  });

  it('executes add_contact tool call through UpdateDispatcher', async () => {
    const user = await userRepo.findById(dbUserId);
    await (dispatcher as any).executeToolCall(user, testUserId, {
      name: 'add_contact',
      args: {
        name: 'Doctor Dave',
        phone: '9988776655',
      },
    });

    expect(mockTg.sendMessage).toHaveBeenCalledWith(
      testUserId,
      expect.stringContaining('Doctor Dave'),
      undefined
    );

    const found = await contactService.findContact(dbUserId, 'Doctor Dave');
    expect(found).not.toBeNull();
    expect(found?.phone).toBe('9988776655');
  });
});
