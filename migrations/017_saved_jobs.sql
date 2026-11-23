-- Migration: 017_saved_jobs.sql
-- Description: Quick Save Job feature storage with original raw text and structured fields

CREATE TABLE IF NOT EXISTS saved_jobs (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(32) NOT NULL DEFAULT 'other', -- 'email' | 'form' | 'other'
    job_title VARCHAR(255),
    company VARCHAR(255),
    apply_email VARCHAR(255),
    required_subject TEXT,
    required_instructions TEXT,
    form_link TEXT,
    form_questions JSONB DEFAULT '[]'::jsonb,
    deadline VARCHAR(128),
    summary TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'to-apply', -- 'to-apply' | 'applied' | 'needs-review'
    raw_text TEXT NOT NULL,
    source_telegram_message_id BIGINT,
    source_telegram_chat_id BIGINT,
    image_file_id VARCHAR(255),
    linked_task_id BIGINT REFERENCES tasks(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency: Prevent duplicate job entries from the same Telegram message
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_jobs_source 
ON saved_jobs(user_id, source_telegram_chat_id, source_telegram_message_id) 
WHERE source_telegram_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_saved_jobs_user_status ON saved_jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_saved_jobs_created_at ON saved_jobs(created_at DESC);
