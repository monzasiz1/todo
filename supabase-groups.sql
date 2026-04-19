-- ==========================================
-- GRUPPEN-FEATURE: Tabellen für Gruppenplanung
-- Einmalig im Supabase SQL Editor ausführen
-- ==========================================

-- 1. Gruppen-Tabelle
CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT DEFAULT '',
  color VARCHAR(7) DEFAULT '#007AFF',
  icon VARCHAR(20) DEFAULT 'users',
  invite_code VARCHAR(8) UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Gruppen-Mitglieder
CREATE TABLE IF NOT EXISTS group_members (
  id SERIAL PRIMARY KEY,
  group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);

-- 3. Gruppen-Aufgaben (verknüpft bestehende Tasks mit Gruppen)
CREATE TABLE IF NOT EXISTS group_tasks (
  id SERIAL PRIMARY KEY,
  group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, task_id)
);

-- Index für schnelle Abfragen
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_tasks_group ON group_tasks(group_id);
CREATE INDEX IF NOT EXISTS idx_group_tasks_task ON group_tasks(task_id);
CREATE INDEX IF NOT EXISTS idx_groups_invite_code ON groups(invite_code);
