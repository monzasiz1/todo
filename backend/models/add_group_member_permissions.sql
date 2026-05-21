-- ============================================================
-- Migration: Mitglieder-Berechtigungen pro Gruppe
-- ============================================================
-- Fuegt der Tabelle `groups` eine JSONB-Spalte `member_permissions`
-- hinzu. Darin speichert die App pro Gruppe, welche Aktionen normale
-- Mitglieder (Rolle 'member') ausfuehren duerfen. Owner und Admins
-- haben immer alle Rechte und ignorieren diese Flags.
--
-- Ausfuehrung (PFLICHT vor Deploy bzw. erstem Nutzen des Permission-Features):
--   - In Supabase: SQL-Editor oeffnen und dieses Skript einmal ausfuehren.
--   - Lokal (psql): \i backend/models/add_group_member_permissions.sql
--
-- Hinweis: Die App fuehrt KEIN Runtime-ALTER mehr aus. Wenn die Spalte
-- fehlt, fallen die Permission-Checks auf die Server-Defaults zurueck
-- (siehe unten) und es wird eine Warnung geloggt. UPDATE-Aufrufe auf die
-- Permissions schlagen dann fehl, bis diese Migration ausgefuehrt wurde.
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
