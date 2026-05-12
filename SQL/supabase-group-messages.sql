-- Group Chat Messages Table
-- Run this migration in your database to enable the group chat feature

CREATE TABLE IF NOT EXISTS group_messages (
  id BIGSERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  pinned_at TIMESTAMPTZ,
  pinned_by INTEGER REFERENCES users(id),
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_messages_group_id ON group_messages(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_messages_pinned ON group_messages(group_id, is_pinned) WHERE is_pinned = TRUE;

-- If table already exists, add new columns (safe to run multiple times):
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS is_poll BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS poll_options JSONB;
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text';
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS linked_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS responsible_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS responsible_role TEXT;

CREATE INDEX IF NOT EXISTS idx_group_messages_type ON group_messages(group_id, message_type);
CREATE INDEX IF NOT EXISTS idx_group_messages_linked_task ON group_messages(linked_task_id) WHERE linked_task_id IS NOT NULL;

-- Poll votes table
CREATE TABLE IF NOT EXISTS group_poll_votes (
  id BIGSERIAL PRIMARY KEY,
  message_id BIGINT NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id, option_id)
);

CREATE INDEX IF NOT EXISTS idx_poll_votes_message ON group_poll_votes(message_id);

-- Event chat RSVP table
CREATE TABLE IF NOT EXISTS group_event_rsvps (
  id BIGSERIAL PRIMARY KEY,
  message_id BIGINT NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('yes', 'maybe', 'no')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_event_rsvps_message ON group_event_rsvps(message_id);

-- Optional: limit messages per group to last 500 via trigger (or handle in app layer)
