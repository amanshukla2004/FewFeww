-- Migration 011: WhatsApp Channel Support

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'TELEGRAM';
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);
