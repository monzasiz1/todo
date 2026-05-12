-- ============================================================
-- Microsoft Teams Meeting Integration
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. Add Teams meeting fields to tasks table
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS teams_join_url TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS teams_meeting_id TEXT;

-- 2. Add Microsoft OAuth token storage per user
--    (tokens are encrypted at rest by Supabase's storage encryption;
--     ensure RLS policies protect these columns if you use RLS)
ALTER TABLE users ADD COLUMN IF NOT EXISTS ms_access_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ms_refresh_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ms_token_expires_at TIMESTAMP WITH TIME ZONE;

-- 3. Index for looking up users with a connected MS account
CREATE INDEX IF NOT EXISTS idx_users_ms_connected
  ON users(id)
  WHERE ms_access_token IS NOT NULL;
