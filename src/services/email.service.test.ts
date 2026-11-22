import { describe, it, expect, beforeEach } from 'vitest';
import { emailService } from './email.service.js';
import { CallbackRouter } from './callback.router.js';
import { UpdateDispatcher } from './dispatcher.js';
import { pool } from '../db/pool.js';
import { userRepo } from '../db/user.repo.js';

describe('Email Management (Gmail Drafting & Direct Send) - Step 25', () => {
  let testUserId: string;
  const testChatId = 7700112233;

  beforeEach(async () => {
    await pool.query('DELETE FROM email_drafts;');
    await pool.query('DELETE FROM users WHERE telegram_chat_id = $1;', [testChatId]);

    const { user } = await userRepo.findOrCreate(testChatId, testChatId, 'EmailUser', 'en');
    testUserId = user.id;
  });

  it('creates an email draft with formatted review card and action buttons', async () => {
    const res = await emailService.createDraft({
      userId: testUserId,
      recipient: 'JOHN@EXAMPLE.COM ',
      subject: 'Quarterly Project Update',
      body: 'Hi John,\nHere is the updated roadmap and KPI summary.',
    });

    expect(res.draft.recipient).toBe('john@example.com'); // sanitized & lowercased
    expect(res.draft.subject).toBe('Quarterly Project Update');
    expect(res.draft.status).toBe('DRAFT');
    expect(res.text).toContain('john@example.com');
    expect(res.text).toContain('Quarterly Project Update');
    expect(res.keyboard.length).toBe(1);
    expect(res.keyboard[0][0].text).toContain('Send Email');
    expect(res.keyboard[0][0].callback_data).toBe(`em:s:${res.draft.id}`);
    expect(res.keyboard[0][1].text).toContain('Discard');
    expect(res.keyboard[0][1].callback_data).toBe(`em:d:${res.draft.id}`);
  });

  it('sends an email draft and updates status to SENT with timestamp', async () => {
    const { draft } = await emailService.createDraft({
      userId: testUserId,
      recipient: 'sarah@work.com',
      subject: 'Sync Call Follow-up',
      body: 'Thanks for chatting today!',
    });

    const sendRes = await emailService.sendEmail(draft.id, testUserId);
    expect(sendRes.text).toContain('Email Sent Successfully');
    expect(sendRes.text).toContain('sarah@work.com');

    // Verify DB row
    const dbRes = await pool.query('SELECT * FROM email_drafts WHERE id = $1', [draft.id]);
    expect(dbRes.rows[0].status).toBe('SENT');
    expect(dbRes.rows[0].sent_at).not.toBeNull();
  });

  it('discards an email draft and prevents re-sending', async () => {
    const { draft } = await emailService.createDraft({
      userId: testUserId,
      recipient: 'client@startup.com',
      subject: 'Proposal draft',
      body: 'Old pitch content...',
    });

    const discardRes = await emailService.discardEmail(draft.id, testUserId);
    expect(discardRes.text).toContain('Draft Discarded');

    const sendAttempt = await emailService.sendEmail(draft.id, testUserId);
    expect(sendAttempt.text).toContain('Unable to Send');
  });

  it('lists only pending un-sent drafts', async () => {
    // Empty case
    const emptyList = await emailService.listDrafts(testUserId);
    expect(emptyList.drafts.length).toBe(0);
    expect(emptyList.text).toContain('No Pending Drafts');

    // Create 2 drafts
    const d1 = await emailService.createDraft({
      userId: testUserId,
      recipient: 'alice@example.com',
      subject: 'Subject 1',
      body: 'Body 1',
    });
    await emailService.createDraft({
      userId: testUserId,
      recipient: 'bob@example.com',
      subject: 'Subject 2',
      body: 'Body 2',
    });

    // Send 1 draft
    await emailService.sendEmail(d1.draft.id, testUserId);

    const pendingList = await emailService.listDrafts(testUserId);
    expect(pendingList.drafts.length).toBe(1);
    expect(pendingList.drafts[0].subject).toBe('Subject 2');
  });

  it('handles inline callback buttons em:s:<id> and em:d:<id> via callbackRouter', async () => {
    const { draft } = await emailService.createDraft({
      userId: testUserId,
      recipient: 'hr@company.com',
      subject: 'Leave Request',
      body: 'I will be on leave tomorrow.',
    });

    const editedMessages: string[] = [];
    const mockTg: any = {
      answerCallbackQuery: async () => true,
      editMessageText: async (_chatId: any, _msgId: any, text: string) => {
        editedMessages.push(text);
        return true;
      },
      sendMessage: async () => ({ message_id: 1 }),
    };

    const cbRouter = new CallbackRouter(mockTg);

    // Click [Send Email]
    await cbRouter.handleCallback({
      id: 'cq_send',
      from: { id: testChatId, first_name: 'EmailUser' },
      message: { message_id: 55, chat: { id: testChatId } },
      data: `em:s:${draft.id}`,
    });

    expect(editedMessages.length).toBe(1);
    expect(editedMessages[0]).toContain('Email Sent Successfully');
  });

  it('executes draft_email and send_email tool calls via UpdateDispatcher', async () => {
    const user = await userRepo.findById(testUserId);
    expect(user).toBeDefined();

    const sentMessages: Array<{ text: string; keyboard?: any }> = [];
    const mockTg: any = {
      sendMessage: async (_chatId: any, text: string, keyboard?: any) => {
        sentMessages.push({ text, keyboard });
        return { message_id: 2001 };
      },
    };

    const dispatcher = new UpdateDispatcher(mockTg);

    // Call draft_email tool
    await (dispatcher as any).executeToolCall(
      user!,
      testChatId,
      {
        name: 'draft_email',
        args: {
          recipient: 'dev@github.com',
          subject: 'Issue report #402',
          body: 'Found regression in latest commit.',
        },
      }
    );

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].text).toContain('Email Draft Created');
    expect(sentMessages[0].text).toContain('dev@github.com');
    expect(sentMessages[0].keyboard).toBeDefined();

    // Call send_email directly
    await (dispatcher as any).executeToolCall(
      user!,
      testChatId,
      {
        name: 'send_email',
        args: {
          recipient: 'partner@corp.com',
          subject: 'Direct send test',
          body: 'This is sent directly through AI.',
        },
      }
    );

    expect(sentMessages.length).toBe(2);
    expect(sentMessages[1].text).toContain('Email Sent Successfully');
    expect(sentMessages[1].text).toContain('partner@corp.com');
  });
});
