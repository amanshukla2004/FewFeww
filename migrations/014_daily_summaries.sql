-- Migration 014: Daily Summaries Customization & Evening Recap Support
ALTER TABLE users ADD COLUMN IF NOT EXISTS evening_checkin_time TIME NOT NULL DEFAULT '20:00';
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_summary_type TEXT NOT NULL DEFAULT 'MORNING';
