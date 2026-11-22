-- 002_todo_lists.sql: Smart To-Do Lists and Categorization

CREATE TABLE IF NOT EXISTS todo_lists (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS list_id BIGINT REFERENCES todo_lists(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(user_id, category);
CREATE INDEX IF NOT EXISTS idx_tasks_list_id ON tasks(user_id, list_id);
