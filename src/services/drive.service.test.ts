import { describe, it, expect, beforeEach } from 'vitest';
import { driveService } from './drive.service.js';
import { UpdateDispatcher } from './dispatcher.js';
import { pool } from '../db/pool.js';
import { userRepo } from '../db/user.repo.js';

describe('Cloud Drive Storage (Google Drive & OneDrive) - Step 26', () => {
  let testUserId: string;
  const testChatId = 7700554433;

  beforeEach(async () => {
    await pool.query('DELETE FROM cloud_files;');
    await pool.query('DELETE FROM users WHERE telegram_chat_id = $1;', [testChatId]);

    const { user } = await userRepo.findOrCreate(testChatId, testChatId, 'DriveUser', 'en');
    testUserId = user.id;
  });

  it('uploads a file to Google Drive and generates access URL', async () => {
    const res = await driveService.uploadFile({
      userId: testUserId,
      fileName: 'Architecture_Spec.pdf',
      mimeType: 'application/pdf',
      fileSize: 1048576,
      provider: 'GOOGLE_DRIVE',
      folderPath: '/FewFeww/Specs',
      tags: ['spec', 'architecture'],
    });

    expect(res.file.fileName).toBe('Architecture_Spec.pdf');
    expect(res.file.provider).toBe('GOOGLE_DRIVE');
    expect(res.file.storageUrl).toContain('https://drive.google.com/file/d/');
    expect(res.formattedText).toContain('Google Drive');
    expect(res.formattedText).toContain('Architecture_Spec.pdf');
    expect(res.formattedText).toContain('/FewFeww/Specs');
  });

  it('uploads a file to OneDrive with dedicated 1drv link', async () => {
    const res = await driveService.uploadFile({
      userId: testUserId,
      fileName: 'Financials_Q4.xlsx',
      provider: 'ONEDRIVE',
      folderPath: '/FewFeww/Finance',
    });

    expect(res.file.fileName).toBe('Financials_Q4.xlsx');
    expect(res.file.provider).toBe('ONEDRIVE');
    expect(res.file.storageUrl).toContain('https://1drv.ms/u/s!');
    expect(res.formattedText).toContain('OneDrive');
  });

  it('searches files by keyword and provider filtering', async () => {
    await driveService.uploadFile({
      userId: testUserId,
      fileName: 'client_contract.docx',
      provider: 'GOOGLE_DRIVE',
    });
    await driveService.uploadFile({
      userId: testUserId,
      fileName: 'client_invoice.pdf',
      provider: 'ONEDRIVE',
    });

    // Search query "client" across ALL
    const allMatches = await driveService.searchFiles(testUserId, 'client', 'ALL');
    expect(allMatches.files.length).toBe(2);

    // Search query "client" in GOOGLE_DRIVE only
    const gMatches = await driveService.searchFiles(testUserId, 'client', 'GOOGLE_DRIVE');
    expect(gMatches.files.length).toBe(1);
    expect(gMatches.files[0].fileName).toBe('client_contract.docx');

    // Search non-existent
    const noMatches = await driveService.searchFiles(testUserId, 'nonexistent');
    expect(noMatches.files.length).toBe(0);
    expect(noMatches.formattedText).toContain('No Files Found');
  });

  it('lists files in specific directory', async () => {
    await driveService.uploadFile({
      userId: testUserId,
      fileName: 'notes.txt',
      folderPath: '/FewFeww/Notes',
    });

    const notesList = await driveService.listFiles(testUserId, '/FewFeww/Notes');
    expect(notesList.files.length).toBe(1);
    expect(notesList.files[0].fileName).toBe('notes.txt');

    const emptyList = await driveService.listFiles(testUserId, '/FewFeww/Empty');
    expect(emptyList.files.length).toBe(0);
  });

  it('auto-saves forwarded document attachments via UpdateDispatcher', async () => {
    const user = await userRepo.findById(testUserId);
    expect(user).toBeDefined();

    const sentMessages: string[] = [];
    const mockTg: any = {
      sendMessage: async (_chatId: any, text: string) => {
        sentMessages.push(text);
        return { message_id: 3001 };
      },
    };

    const dispatcher = new UpdateDispatcher(mockTg);

    // Simulate incoming document from Telegram
    await (dispatcher as any).handleMessage({
      message_id: 888,
      from: { id: testChatId, first_name: 'DriveUser' },
      chat: { id: testChatId },
      document: {
        file_id: 'doc_tg_999',
        file_name: 'Lecture_Slides.pptx',
        mime_type: 'application/vnd.ms-powerpoint',
        file_size: 204800,
      },
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Saved to Google Drive');
    expect(sentMessages[0]).toContain('Lecture_Slides.pptx');

    // Verify row in DB
    const dbRes = await pool.query('SELECT * FROM cloud_files WHERE user_id = $1', [testUserId]);
    expect(dbRes.rowCount).toBe(1);
    expect(dbRes.rows[0].file_name).toBe('Lecture_Slides.pptx');
  });

  it('executes search_cloud_files and list_cloud_files tool calls via dispatcher', async () => {
    const user = await userRepo.findById(testUserId);
    expect(user).toBeDefined();

    await driveService.uploadFile({
      userId: testUserId,
      fileName: 'Resume_2026.pdf',
      provider: 'GOOGLE_DRIVE',
    });

    const sentMessages: string[] = [];
    const mockTg: any = {
      sendMessage: async (_chatId: any, text: string) => {
        sentMessages.push(text);
        return { message_id: 3002 };
      },
    };

    const dispatcher = new UpdateDispatcher(mockTg);

    // Call search_cloud_files tool
    await (dispatcher as any).executeToolCall(
      user!,
      testChatId,
      {
        name: 'search_cloud_files',
        args: { query: 'Resume' },
      }
    );

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('Resume_2026.pdf');
    expect(sentMessages[0]).toContain('Google Drive');

    // Call list_cloud_files tool
    await (dispatcher as any).executeToolCall(
      user!,
      testChatId,
      {
        name: 'list_cloud_files',
        args: { folder_path: '/FewFeww' },
      }
    );

    expect(sentMessages.length).toBe(2);
    expect(sentMessages[1]).toContain('Resume_2026.pdf');
  });
});
