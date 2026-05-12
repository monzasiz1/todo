-- Create notes table
CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  importance VARCHAR(10) DEFAULT 'medium' CHECK (importance IN ('low', 'medium', 'high')),
  date TIMESTAMP,
  completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMP,
  status VARCHAR(20) DEFAULT 'open',
  linked_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  x DOUBLE PRECISION,
  y DOUBLE PRECISION,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Backfill migration for existing installations (table existed before x/y were introduced)
ALTER TABLE notes ADD COLUMN IF NOT EXISTS x DOUBLE PRECISION;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS y DOUBLE PRECISION;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT FALSE;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'open';

-- Pre-drop policies that can depend on notes.user_id, so type changes won't fail.
DROP POLICY IF EXISTS "Users can view their own notes" ON notes;
DROP POLICY IF EXISTS "Users can insert their own notes" ON notes;
DROP POLICY IF EXISTS "Users can update their own notes" ON notes;
DROP POLICY IF EXISTS "Users can delete their own notes" ON notes;
DROP POLICY IF EXISTS "Users can view shares of their notes" ON note_shares;
DROP POLICY IF EXISTS "Users can create shares for their notes" ON note_shares;
DROP POLICY IF EXISTS "Users can view connections of their notes" ON note_connections;
DROP POLICY IF EXISTS "Users can create connections for their notes" ON note_connections;

-- One-time compatibility repair:
-- If notes.user_id was previously created as UUID (auth.users), convert to INTEGER users(id)
-- This works safely only when notes is empty (or after manual cleanup of legacy rows).
DO $$
DECLARE
  v_type text;
  v_count int;
BEGIN
  SELECT c.data_type INTO v_type
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'notes'
    AND c.column_name = 'user_id'
  LIMIT 1;

  IF v_type = 'uuid' THEN
    SELECT COUNT(*)::int INTO v_count FROM notes;
    IF v_count = 0 THEN
      ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_user_id_fkey;
      ALTER TABLE notes ALTER COLUMN user_id DROP NOT NULL;
      ALTER TABLE notes ALTER COLUMN user_id TYPE INTEGER USING NULL;
      ALTER TABLE notes ALTER COLUMN user_id SET NOT NULL;
      ALTER TABLE notes
        ADD CONSTRAINT notes_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

-- Create note_shares table for sharing with friends
CREATE TABLE IF NOT EXISTS note_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission VARCHAR(20) DEFAULT 'view' CHECK (permission IN ('view', 'comment', 'edit')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(note_id, friend_id)
);

-- Create note_connections table for linking related notes
CREATE TABLE IF NOT EXISTS note_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id_1 UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  note_id_2 UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  relationship_type VARCHAR(20) DEFAULT 'related',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (note_id_1 != note_id_2),
  UNIQUE(note_id_1, note_id_2)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(date);
CREATE INDEX IF NOT EXISTS idx_note_shares_note_id ON note_shares(note_id);
CREATE INDEX IF NOT EXISTS idx_note_shares_friend_id ON note_shares(friend_id);
CREATE INDEX IF NOT EXISTS idx_note_connections_note_id_1 ON note_connections(note_id_1);
CREATE INDEX IF NOT EXISTS idx_note_connections_note_id_2 ON note_connections(note_id_2);

-- Enable RLS (Row Level Security)
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_connections ENABLE ROW LEVEL SECURITY;

-- RLS Policies for notes table
DROP POLICY IF EXISTS "Users can view their own notes" ON notes;
CREATE POLICY "Users can view their own notes"
  ON notes FOR SELECT
  USING (auth.uid()::text = user_id::text);

DROP POLICY IF EXISTS "Users can insert their own notes" ON notes;
CREATE POLICY "Users can insert their own notes"
  ON notes FOR INSERT
  WITH CHECK (auth.uid()::text = user_id::text);

DROP POLICY IF EXISTS "Users can update their own notes" ON notes;
CREATE POLICY "Users can update their own notes"
  ON notes FOR UPDATE
  USING (auth.uid()::text = user_id::text);

DROP POLICY IF EXISTS "Users can delete their own notes" ON notes;
CREATE POLICY "Users can delete their own notes"
  ON notes FOR DELETE
  USING (auth.uid()::text = user_id::text);

-- RLS Policies for note_shares table
DROP POLICY IF EXISTS "Users can view shares of their notes" ON note_shares;
CREATE POLICY "Users can view shares of their notes"
  ON note_shares FOR SELECT
  USING (
    note_id IN (SELECT id FROM notes WHERE user_id::text = auth.uid()::text)
    OR friend_id::text = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can create shares for their notes" ON note_shares;
CREATE POLICY "Users can create shares for their notes"
  ON note_shares FOR INSERT
  WITH CHECK (
    note_id IN (SELECT id FROM notes WHERE user_id::text = auth.uid()::text)
  );

-- RLS Policies for note_connections table
DROP POLICY IF EXISTS "Users can view connections of their notes" ON note_connections;
CREATE POLICY "Users can view connections of their notes"
  ON note_connections FOR SELECT
  USING (
    note_id_1 IN (SELECT id FROM notes WHERE user_id::text = auth.uid()::text)
    OR note_id_2 IN (SELECT id FROM notes WHERE user_id::text = auth.uid()::text)
  );

DROP POLICY IF EXISTS "Users can create connections for their notes" ON note_connections;
CREATE POLICY "Users can create connections for their notes"
  ON note_connections FOR INSERT
  WITH CHECK (
    note_id_1 IN (SELECT id FROM notes WHERE user_id::text = auth.uid()::text)
  );
