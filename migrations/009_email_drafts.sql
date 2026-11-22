-- Migration 009: Email Management (Drafting & Direct Send)

CREATE TABLE IF NOT EXISTS email_drafts (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient   TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'DRAFT', -- 'DRAFT', 'SENT', 'DISCARDED'
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_drafts_user ON email_drafts(user_id, status);
