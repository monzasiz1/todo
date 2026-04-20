-- ==========================================
-- Profil-Sichtbarkeit für Freunde
-- Einmalig im Supabase SQL Editor ausführen
-- ==========================================

-- Sichtbarkeits-Einstellung:
-- 'everyone'  = Alle Freunde können mein Profil sehen
-- 'nobody'    = Niemand kann mein Profil sehen (nur ich)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_visibility VARCHAR(20) DEFAULT 'everyone'
  CHECK (profile_visibility IN ('everyone', 'nobody'));
