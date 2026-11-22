-- 004_habits_and_metrics.sql: Habits and Quantitative Metric Tracking

CREATE TABLE IF NOT EXISTS habits (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'METRIC', -- 'METRIC' or 'BOOLEAN'
  unit         TEXT,
  target_value NUMERIC,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS habit_logs (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  habit_id   BIGINT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  value      NUMERIC NOT NULL DEFAULT 1,
  notes      TEXT,
  logged_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_habit_logs_query ON habit_logs(user_id, habit_id, logged_at DESC);
