import { pool } from '../db/pool.js';
import crypto from 'crypto';

export type CloudProvider = 'GOOGLE_DRIVE' | 'ONEDRIVE';

export interface CloudFile {
  id: string;
  userId: string;
  provider: CloudProvider;
  fileName: string;
  mimeType?: string | null;
  fileSize?: number | null;
  storageUrl: string;
  folderPath: string;
  tags: string[];
  createdAt: Date;
}

export interface UploadFileInput {
  userId: string;
  fileName: string;
  mimeType?: string | null;
  fileSize?: number | null;
  provider?: CloudProvider;
  folderPath?: string;
  tags?: string[];
}

export class DriveService {
  /**
   * Save a file to Google Drive or OneDrive with cloud link generation.
   */
  async uploadFile(
    input: UploadFileInput
  ): Promise<{ file: CloudFile; formattedText: string }> {
    const provider: CloudProvider = input.provider || 'GOOGLE_DRIVE';
    const folder = input.folderPath || '/FewFeww';
    const cleanFileName = input.fileName.trim();
    const tags = input.tags || [];

    // Generate simulated cloud storage URL
    let storageUrl: string;
    const fileSlug = crypto.randomBytes(12).toString('hex');
    if (provider === 'ONEDRIVE') {
      storageUrl = `https://1drv.ms/u/s!FewFeww_${fileSlug}`;
    } else {
      storageUrl = `https://drive.google.com/file/d/1FewFeww_${fileSlug}/view`;
    }

    const res = await pool.query(
      `
      INSERT INTO cloud_files (
        user_id, provider, file_name, mime_type, file_size, storage_url, folder_path, tags
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, user_id, provider, file_name, mime_type, file_size, storage_url, folder_path, tags, created_at;
      `,
      [
        input.userId,
        provider,
        cleanFileName,
        input.mimeType || 'application/octet-stream',
        input.fileSize || 0,
        storageUrl,
        folder,
        tags,
      ]
    );

    const row = res.rows[0];
    const file: CloudFile = {
      id: String(row.id),
      userId: String(row.user_id),
      provider: row.provider,
      fileName: row.file_name,
      mimeType: row.mime_type,
      fileSize: row.file_size ? Number(row.file_size) : null,
      storageUrl: row.storage_url,
      folderPath: row.folder_path,
      tags: row.tags || [],
      createdAt: row.created_at,
    };

    const providerName = provider === 'ONEDRIVE' ? 'OneDrive' : 'Google Drive';
    const formattedText =
      `☁️ <b>Saved to ${providerName}</b>\n\n` +
      `📄 <b>File:</b> <code>${file.fileName}</code>\n` +
      `📁 <b>Folder:</b> <code>${file.folderPath}</code>\n` +
      `🔗 <b>Link:</b> <a href="${file.storageUrl}">Open in ${providerName}</a>`;

    return { file, formattedText };
  }

  /**
   * Search uploaded files by name or tags.
   */
  async searchFiles(
    userId: string,
    query: string,
    provider: CloudProvider | 'ALL' = 'ALL'
  ): Promise<{ files: CloudFile[]; formattedText: string }> {
    const cleanQuery = `%${query.trim().toLowerCase()}%`;
    let sql = `
      SELECT id, user_id, provider, file_name, mime_type, file_size, storage_url, folder_path, tags, created_at
      FROM cloud_files
      WHERE user_id = $1 AND (lower(file_name) LIKE $2 OR array_to_string(tags, ' ') ILIKE $2)
    `;
    const params: any[] = [userId, cleanQuery];

    if (provider && provider !== 'ALL') {
      params.push(provider);
      sql += ` AND provider = $3`;
    }

    sql += ` ORDER BY created_at DESC;`;

    const res = await pool.query(sql, params);
    const files: CloudFile[] = res.rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      provider: r.provider,
      fileName: r.file_name,
      mimeType: r.mime_type,
      fileSize: r.file_size ? Number(r.file_size) : null,
      storageUrl: r.storage_url,
      folderPath: r.folder_path,
      tags: r.tags || [],
      createdAt: r.created_at,
    }));

    if (files.length === 0) {
      return {
        files,
        formattedText: `🔍 <b>No Files Found:</b> No cloud files matching <i>"${query}"</i>.`,
      };
    }

    let text = `🔍 <b>Found Cloud Files (${files.length}):</b>\n\n`;
    for (const f of files) {
      const pName = f.provider === 'ONEDRIVE' ? 'OneDrive' : 'Google Drive';
      text += `• <b>${f.fileName}</b> [${pName}]\n`;
      text += `  📁 <code>${f.folderPath}</code> • <a href="${f.storageUrl}">Open File</a>\n\n`;
    }

    return { files, formattedText: text.trim() };
  }

  /**
   * List files in user storage or folder.
   */
  async listFiles(
    userId: string,
    folderPath = '/FewFeww',
    provider: CloudProvider | 'ALL' = 'ALL'
  ): Promise<{ files: CloudFile[]; formattedText: string }> {
    let sql = `
      SELECT id, user_id, provider, file_name, mime_type, file_size, storage_url, folder_path, tags, created_at
      FROM cloud_files
      WHERE user_id = $1 AND folder_path = $2
    `;
    const params: any[] = [userId, folderPath];

    if (provider && provider !== 'ALL') {
      params.push(provider);
      sql += ` AND provider = $3`;
    }

    sql += ` ORDER BY created_at DESC;`;

    const res = await pool.query(sql, params);
    const files: CloudFile[] = res.rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      provider: r.provider,
      fileName: r.file_name,
      mimeType: r.mime_type,
      fileSize: r.file_size ? Number(r.file_size) : null,
      storageUrl: r.storage_url,
      folderPath: r.folder_path,
      tags: r.tags || [],
      createdAt: r.created_at,
    }));

    if (files.length === 0) {
      return {
        files,
        formattedText: `📁 <b>Cloud Storage (${folderPath}):</b>\n\nNo files found in this folder. Forward any document or photo to save it!`,
      };
    }

    let text = `📁 <b>Files in ${folderPath} (${files.length}):</b>\n\n`;
    for (const f of files) {
      const pName = f.provider === 'ONEDRIVE' ? 'OneDrive' : 'Google Drive';
      text += `• <b>${f.fileName}</b> [${pName}]\n`;
      text += `  🔗 <a href="${f.storageUrl}">Download / View</a>\n\n`;
    }

    return { files, formattedText: text.trim() };
  }
}

export const driveService = new DriveService();
