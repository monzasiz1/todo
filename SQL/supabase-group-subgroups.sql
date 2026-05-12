-- ==========================================
-- UNTERGRUPPEN: Sichtbarkeits-Untergruppen innerhalb einer Gruppe
-- Einmalig im Supabase SQL Editor ausführen
-- ==========================================

-- 1. Untergruppen-Tabelle
CREATE TABLE IF NOT EXISTS group_subgroups (
  id SERIAL PRIMARY KEY,
  group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(7) DEFAULT '#007AFF',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Untergruppen-Mitglieder
CREATE TABLE IF NOT EXISTS group_subgroup_members (
  subgroup_id INTEGER REFERENCES group_subgroups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (subgroup_id, user_id)
);

-- 3. subgroup_id zu group_tasks hinzufügen
ALTER TABLE group_tasks ADD COLUMN IF NOT EXISTS subgroup_id INTEGER REFERENCES group_subgroups(id) ON DELETE SET NULL;

-- Indizes
CREATE INDEX IF NOT EXISTS idx_group_subgroups_group ON group_subgroups(group_id);
CREATE INDEX IF NOT EXISTS idx_group_subgroup_members_subgroup ON group_subgroup_members(subgroup_id);
CREATE INDEX IF NOT EXISTS idx_group_subgroup_members_user ON group_subgroup_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_tasks_subgroup ON group_tasks(subgroup_id);
