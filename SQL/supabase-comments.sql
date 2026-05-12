-- Task/Event Comments System
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS task_comments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji VARCHAR(10) DEFAULT '💬',
  text TEXT NOT NULL,
  occurrence_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS occurrence_date DATE;

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_user_id ON task_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_created ON task_comments(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_comments_occurrence ON task_comments(task_id, occurrence_date, created_at);

UPDATE task_comments tc
SET occurrence_date = t.date::date,
    task_id = t.recurrence_parent_id
FROM tasks t
WHERE tc.task_id = t.id
  AND t.recurrence_parent_id IS NOT NULL
  AND tc.occurrence_date IS NULL;

UPDATE task_comments tc
SET occurrence_date = t.date::date
FROM tasks t
WHERE tc.task_id = t.id
  AND t.recurrence_rule IS NOT NULL
  AND t.recurrence_parent_id IS NULL
  AND tc.occurrence_date IS NULL;
