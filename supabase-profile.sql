-- ==========================================
-- Profil-Feature: Spalten für users-Tabelle
-- Einmalig im Supabase SQL Editor ausführen
-- ==========================================

-- Profilbild (Base64 Data-URI, max ~500KB)
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Kurze Bio (max 200 Zeichen)
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio VARCHAR(200) DEFAULT '';

-- Avatar-Farbe (Hex, z.B. #007AFF)
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_color VARCHAR(7) DEFAULT '#007AFF';

-- Theme-Einstellung (light/dark/auto)
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(10) DEFAULT 'light';
