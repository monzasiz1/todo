-- Add participant_ids and responsible_user_id columns to notes table
-- This enables cross-user sharing of participants data

ALTER TABLE notes ADD COLUMN IF NOT EXISTS participant_ids INTEGER[] DEFAULT '{}';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS responsible_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Index for responsible_user_id lookups
CREATE INDEX IF NOT EXISTS idx_notes_responsible_user_id ON notes(responsible_user_id);
