-- Migration 012: Multimodal Vision & Image Analysis Logs

CREATE TABLE IF NOT EXISTS image_analyses (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_url     TEXT,
  summary       TEXT NOT NULL,
  extracted_items JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_image_analyses_user ON image_analyses(user_id, created_at DESC);
