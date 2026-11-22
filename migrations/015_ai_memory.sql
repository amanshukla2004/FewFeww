-- Migration 015: Long-Term AI Memory & Recall
CREATE TABLE IF NOT EXISTS ai_memories (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_phrase  TEXT NOT NULL,
  content     TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'GENERAL',
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(key_phrase, '') || ' ' || coalesce(content, ''))
  ) STORED,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_memories_user ON ai_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_memories_search ON ai_memories USING gin(search_vector);
