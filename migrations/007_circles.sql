-- Migration 007: Circles & Social Group Productivity

CREATE TABLE IF NOT EXISTS circles (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);

CREATE TABLE IF NOT EXISTS circle_members (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  circle_id  BIGINT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id    BIGINT REFERENCES users(id) ON DELETE CASCADE,
  contact_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
  status     TEXT NOT NULL DEFAULT 'ACTIVE',
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (circle_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_circle_members_circle ON circle_members(circle_id);
CREATE INDEX IF NOT EXISTS idx_circles_owner ON circles(owner_id);
