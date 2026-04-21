-- Migration: Add plan column to users table
-- Run once in your Supabase/Postgres SQL editor

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'pro', 'team')),
  ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ;

-- Backfill existing users as free
UPDATE users SET plan = 'free' WHERE plan IS NULL;

-- Index for fast plan lookups
CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan);
