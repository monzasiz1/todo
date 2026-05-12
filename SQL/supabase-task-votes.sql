-- Task detail voting (yes/no) independent from group chat
-- Run once in Supabase SQL Editor

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS enable_group_rsvp BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS task_votes (
  id BIGSERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('yes', 'no')),
  occurrence_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_votes_unique
ON task_votes(task_id, user_id, COALESCE(occurrence_date, DATE '1970-01-01'));

CREATE INDEX IF NOT EXISTS idx_task_votes_task
ON task_votes(task_id, occurrence_date);
