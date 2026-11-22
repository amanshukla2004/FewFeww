-- Migration 010: Cloud Drive Storage (Google Drive & OneDrive)

CREATE TABLE IF NOT EXISTS cloud_files (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL DEFAULT 'GOOGLE_DRIVE', -- 'GOOGLE_DRIVE' | 'ONEDRIVE'
  file_name    TEXT NOT NULL,
  mime_type    TEXT,
  file_size    BIGINT,
  storage_url  TEXT NOT NULL,
  folder_path  TEXT NOT NULL DEFAULT '/FewFeww',
  tags         TEXT[] DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cloud_files_user ON cloud_files(user_id, provider, created_at DESC);
