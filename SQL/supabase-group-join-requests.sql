-- ==========================================
-- Gruppen: Beitrittsanfragen & öffentliche Gruppen
-- Einmalig im Supabase SQL Editor ausführen
-- ==========================================

-- is_public Flag an bestehende groups-Tabelle anhängen
ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false;

-- Tabelle für Beitrittsanfragen
CREATE TABLE IF NOT EXISTS group_join_requests (
  id SERIAL PRIMARY KEY,
  group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  user_id  INTEGER REFERENCES users(id)  ON DELETE CASCADE,
  status   VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  message  TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_join_requests_group  ON group_join_requests(group_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_user   ON group_join_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_status ON group_join_requests(status);
