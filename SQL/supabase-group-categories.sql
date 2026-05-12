-- Shared group categories for team-standard classification
-- Run this in Supabase SQL editor for production environments.

CREATE TABLE IF NOT EXISTS group_categories (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#8E8E93',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, name)
);

ALTER TABLE group_tasks
  ADD COLUMN IF NOT EXISTS group_category_id INTEGER REFERENCES group_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_group_categories_group ON group_categories(group_id);
CREATE INDEX IF NOT EXISTS idx_group_tasks_group_category ON group_tasks(group_category_id);
