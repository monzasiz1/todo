-- ============================================================
-- Migration: Mitglieder-Berechtigungen pro Gruppe
-- ============================================================
-- Fuegt der Tabelle `groups` eine JSONB-Spalte `member_permissions`
-- hinzu. Darin speichert die App pro Gruppe, welche Aktionen normale
-- Mitglieder (Rolle 'member') ausfuehren duerfen. Owner und Admins
-- haben immer alle Rechte und ignorieren diese Flags.
--
-- Ausfuehrung:
--   - In Supabase: SQL-Editor oeffnen und dieses Skript einmal ausfuehren.
--   - Lokal (psql): \i backend/models/add_group_member_permissions.sql
--
-- Hinweis: Die Server-API ruft beim ersten Zugriff zusaetzlich ein
-- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` auf, sodass die Migration
-- auch ohne manuellen Lauf greift. Dieses Skript ist die explizite
-- Variante fuer Deploys / Datenbank-Tracking.
-- ============================================================

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS member_permissions JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.groups.member_permissions IS
  'Per-group permission flags for role=member. Owner/admin ignore these. Recognized keys: create_tasks, edit_own_tasks, manage_notes, chat, invite, create_categories, create_subgroups. Missing keys fall back to server defaults.';

-- Optionaler GIN-Index, falls spaeter nach einzelnen Flags gefiltert wird.
-- Aktuell nicht zwingend, da die App das Objekt komplett liest.
-- CREATE INDEX IF NOT EXISTS groups_member_permissions_gin
--   ON public.groups USING GIN (member_permissions);

-- ============================================================
-- Server-Defaults zur Dokumentation (werden in api/groups.js gemerged):
--   {
--     "create_tasks":       true,
--     "edit_own_tasks":     true,
--     "manage_notes":       true,
--     "chat":               true,
--     "invite":             false,
--     "create_categories":  false,
--     "create_subgroups":   false
--   }
-- ============================================================
