-- Migration 008: Calendar & Meet Sync

CREATE TABLE IF NOT EXISTS calendar_events (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL DEFAULT 'GOOGLE',
  title               TEXT NOT NULL,
  description         TEXT,
  location            TEXT,
  start_time          TIMESTAMPTZ NOT NULL,
  end_time            TIMESTAMPTZ NOT NULL,
  attendees           TEXT[] DEFAULT '{}',
  meet_url            TEXT,
  external_event_id   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_user_start ON calendar_events(user_id, start_time);
