-- ============================================================
-- Migration: Custom-Rollen pro Gruppe
-- ============================================================
-- Erweitert das Permissions-System um benutzerdefinierte Rollen.
-- Owner/Admin koennen pro Gruppe beliebige Rollen anlegen (z.B.
-- "Moderator", "Gast", "Editor"), jede mit eigenem Permission-Set.
-- Mitglieder mit Custom-Rolle ignorieren die Gruppen-Defaults und
-- benutzen stattdessen die Permissions ihrer Rolle.
--
-- Datenmodell:
--   groups.custom_roles  JSONB  [{ id, name, color, permissions:{...} }, ...]
--   group_members.custom_role_id  TEXT  (verweist auf custom_roles[].id)
--
-- Ausfuehrung (PFLICHT vor Nutzung des Features):
--   - Supabase SQL-Editor: dieses Skript ausfuehren
--   - Lokal (psql): \i backend/models/add_group_custom_roles.sql
-- ============================================================

-- 1) Custom-Rollen Array auf der Gruppe
ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS custom_roles JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.groups.custom_roles IS
  'Benutzerdefinierte Rollen dieser Gruppe. Array of {id, name, color, permissions}. permissions verwendet dieselben Keys wie member_permissions.';

-- 2) Zuweisung Member -> Custom-Rolle (nullable; keine FK weil JSONB)
ALTER TABLE public.group_members
  ADD COLUMN IF NOT EXISTS custom_role_id TEXT NULL;

COMMENT ON COLUMN public.group_members.custom_role_id IS
  'Optionale Referenz auf groups.custom_roles[].id. Nur fuer role=member relevant; Owner/Admin haben immer alle Rechte.';

CREATE INDEX IF NOT EXISTS group_members_custom_role_idx
  ON public.group_members (group_id, custom_role_id)
  WHERE custom_role_id IS NOT NULL;

-- ============================================================
-- Resolver-Logik (im Server, zur Doku hier):
--   if role == 'owner' || role == 'admin' -> alle Permissions true
--   elif custom_role_id && custom_roles[id] vorhanden ->
--        custom_roles[id].permissions (gemerged mit Defaults)
--   else -> groups.member_permissions (gemerged mit Defaults)
-- ============================================================
