-- Migration: Passwort-Änderung (mit Bestätigung) + Passwort-Reset (Vergessen)
-- Supabase Dashboard → SQL Editor → New Query → ausführen

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_change_token        VARCHAR(128) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS password_change_hash         VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS password_change_requested_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS password_reset_token         VARCHAR(128) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS password_reset_requested_at  TIMESTAMP WITH TIME ZONE DEFAULT NULL;
