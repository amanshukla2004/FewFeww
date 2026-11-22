-- FewFeww PostgreSQL Database Schema Migration v1.0
-- Channel: Telegram-First (Private Chats)
-- Primary Keys: BIGINT GENERATED ALWAYS AS IDENTITY (strict <= 64 bytes callback_data)

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_user_id        BIGINT NOT NULL UNIQUE,
  telegram_chat_id        BIGINT NOT NULL,
  first_name              TEXT,
  language_code           TEXT,
  timezone                TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  default_reminder_time   TIME NOT NULL DEFAULT '09:00',
  lead_minutes            INT  NOT NULL DEFAULT 60,
  quiet_start             TIME NOT NULL DEFAULT '22:00',
  quiet_end               TIME NOT NULL DEFAULT '07:00',
  morning_plan_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  morning_plan_time       TIME NOT NULL DEFAULT '08:30',
  last_morning_plan_on    DATE,
  evening_checkin_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_evening_on         DATE,
  nudges_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  nudges_paused_until     TIMESTAMPTZ,
  daily_proactive_cap     INT NOT NULL DEFAULT 6,
  onboarding_state        TEXT NOT NULL DEFAULT 'NEW', -- NEW, AWAITING_CONSENT, AWAITING_TZ, AWAITING_TIME, ACTIVE
  consented_at            TIMESTAMPTZ,
  status                  TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, BLOCKED, DELETED
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. INBOX UPDATES (Idempotency Engine)
CREATE TABLE IF NOT EXISTS inbox_updates (
  update_id        BIGINT PRIMARY KEY,
  telegram_user_id BIGINT,
  payload          JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, PROCESSING, APPLIED, DONE, FAILED
  attempts         INT NOT NULL DEFAULT 0,
  error            TEXT,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_inbox_pending ON inbox_updates(received_at) WHERE status IN ('PENDING', 'PROCESSING');

-- 4. RAW MESSAGES AUDIT LOG
CREATE TABLE IF NOT EXISTS messages (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction           TEXT NOT NULL, -- INBOUND, OUTBOUND
  telegram_message_id BIGINT,
  kind                TEXT NOT NULL DEFAULT 'TEXT', -- TEXT, FORWARD, CALLBACK
  text                TEXT,
  forwarded_from      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. TASKS TABLE (with Full-Text & Trigram Search)
CREATE TABLE IF NOT EXISTS tasks (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  details           TEXT,
  status            TEXT NOT NULL DEFAULT 'OPEN', -- OPEN, DONE, DROPPED
  due_at            TIMESTAMPTZ,
  due_has_time      BOOLEAN NOT NULL DEFAULT TRUE,
  recurrence        JSONB, -- { freq: 'WEEKLY', interval: 1, byDay: ['MON'], time: '09:00' }
  source_message_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
  source_label      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  search_vector     TSVECTOR GENERATED ALWAYS AS
    (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(details,''))) STORED
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status_due ON tasks(user_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_search ON tasks USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_tasks_title_trgm ON tasks USING GIN(title gin_trgm_ops);

-- 6. REMINDERS & NUDGES TABLE (Poller SKIP LOCKED target)
CREATE TABLE IF NOT EXISTS reminders (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id             BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL, -- 'USER', 'LEAD', 'NUDGE'
  nudge_stage         INT NOT NULL DEFAULT 0,
  fire_at             TIMESTAMPTZ NOT NULL,
  status              TEXT NOT NULL DEFAULT 'SCHEDULED', -- SCHEDULED, SENDING, SENT, ACKED, FAILED, CANCELLED
  attempt_count       INT NOT NULL DEFAULT 0,
  locked_at           TIMESTAMPTZ,
  last_error          TEXT,
  sent_at             TIMESTAMPTZ,
  acked_at            TIMESTAMPTZ,
  ack_action          TEXT,
  telegram_message_id BIGINT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(fire_at) WHERE status = 'SCHEDULED';
CREATE INDEX IF NOT EXISTS idx_reminders_stuck ON reminders(locked_at) WHERE status = 'SENDING';
CREATE INDEX IF NOT EXISTS idx_reminders_task ON reminders(task_id);

-- 7. NOTES & SAVED LINKS TABLE
CREATE TABLE IF NOT EXISTS notes (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT,
  content           TEXT NOT NULL,
  url               TEXT,
  source_message_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
  source_label      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  search_vector     TSVECTOR GENERATED ALWAYS AS
    (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,''))) STORED
);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_search ON notes USING GIN(search_vector);

-- 8. CONVERSATION STATE (Short-Lived Clarifications)
CREATE TABLE IF NOT EXISTS conversation_state (
  user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL, -- CLARIFY_TIME, PICK_TASK, CONFIRM_DELETE
  context    JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

-- 9. LLM CALLS AUDIT & COST TRACKER
CREATE TABLE IF NOT EXISTS llm_calls (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id    BIGINT,
  model         TEXT,
  input_tokens  INT,
  output_tokens INT,
  latency_ms    INT,
  outcome       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. PRODUCT ANALYTICS EVENTS (Hypothesis Testing)
CREATE TABLE IF NOT EXISTS events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL, -- task_created, reminder_sent, task_done, snoozed, dropped, nudge_sent
  entity_type TEXT,
  entity_id   BIGINT,
  props       JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_user_type ON events(user_id, type, created_at);

-- 11. FEEDBACK TABLE
CREATE TABLE IF NOT EXISTS feedback (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
