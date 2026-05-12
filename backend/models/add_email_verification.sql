-- Migration: E-Mail-Verifikation Spalten hinzufügen
-- Einmal im Supabase SQL-Editor ausführen: Dashboard → SQL Editor → New Query

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified          BOOLEAN      DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR(128) DEFAULT NULL;

-- Bestehende User sofort als verifiziert markieren (sonst können sie sich nicht mehr einloggen)
UPDATE users
SET email_verified = TRUE
WHERE email_verified IS NULL OR email_verified = FALSE;
