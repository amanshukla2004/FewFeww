-- Migration 013: Meeting Minutes (MOM Mode)

CREATE TABLE IF NOT EXISTS meeting_minutes (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  audio_duration  INT, -- duration in seconds
  transcript      TEXT NOT NULL,
  summary         TEXT NOT NULL,
  decisions       TEXT[] DEFAULT '{}',
  action_items    JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_minutes_user ON meeting_minutes(user_id, created_at DESC);
