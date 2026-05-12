-- Migration: 2FA Spalten hinzufügen
-- Supabase Dashboard → SQL Editor → New Query → ausführen

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS twofa_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS twofa_secret  VARCHAR(128) DEFAULT NULL;
