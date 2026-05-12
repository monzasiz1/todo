-- 2FA enabled column for users table
-- Run this in your Supabase SQL editor

ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_enabled BOOLEAN DEFAULT FALSE;

-- Update existing users with 2FA secrets to be enabled
UPDATE users SET twofa_enabled = TRUE WHERE twofa_secret IS NOT NULL;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_users_twofa_enabled ON users(twofa_enabled) WHERE twofa_enabled = TRUE;