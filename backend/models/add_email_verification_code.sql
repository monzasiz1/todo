-- Migration: Spalten für 6-stelligen Verifizierungscode
-- Einmal im Supabase SQL-Editor ausführen: Dashboard → SQL Editor → New Query

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verification_code              VARCHAR(6)   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS email_verification_code_expires_at  TIMESTAMPTZ  DEFAULT NULL;
