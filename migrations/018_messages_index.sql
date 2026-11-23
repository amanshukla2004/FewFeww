-- Migration: 018_messages_index.sql
-- Description: Composite index on messages(user_id, created_at DESC) to eliminate sequential scans

CREATE INDEX IF NOT EXISTS idx_messages_user_created 
ON messages(user_id, created_at DESC);
