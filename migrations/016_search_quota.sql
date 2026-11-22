-- Migration 016: Internet Search Quota Tracking
ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_search_count INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS search_quota_reset_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days');
