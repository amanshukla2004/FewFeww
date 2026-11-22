-- 005_user_language.sql: User Preferred Output Language

ALTER TABLE users ADD COLUMN IF NOT EXISTS output_language TEXT NOT NULL DEFAULT 'English';
