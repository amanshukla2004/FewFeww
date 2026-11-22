-- Migration 006: Contact Directory Management

CREATE TABLE IF NOT EXISTS contacts (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  phone             TEXT,
  email             TEXT,
  telegram_username TEXT,
  telegram_user_id  BIGINT REFERENCES users(telegram_user_id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_user_name ON contacts(user_id, LOWER(name));
