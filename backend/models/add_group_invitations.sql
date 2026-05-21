-- ============================================================
-- Migration: Gruppen-Einladungen (statt direktem Hinzufuegen)
-- ============================================================
-- Wenn ein Admin/Owner einen Nutzer einlaedt, wird dieser nicht
-- mehr sofort Mitglied. Stattdessen wird in `group_join_requests`
-- eine Zeile mit status='invited' und invited_by=<admin_user_id>
-- erzeugt. Der eingeladene Nutzer kann die Einladung in der App
-- annehmen oder ablehnen.
--
-- Ausfuehrung (PFLICHT vor Nutzung):
--   - Supabase SQL-Editor: dieses Skript ausfuehren
--   - Lokal (psql): \i backend/models/add_group_invitations.sql
-- ============================================================

-- Wer hat eingeladen (NULL fuer self-initiated join-requests).
ALTER TABLE public.group_join_requests
  ADD COLUMN IF NOT EXISTS invited_by INTEGER NULL
    REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.group_join_requests.invited_by IS
  'Bei status=invited: ID des Admins/Owners, der die Einladung ausgesprochen hat. NULL fuer self-initiated join-requests (status=pending).';

-- Falls die Tabelle einen CHECK-Constraint auf status hat, der
-- den Wert "invited" noch nicht kennt, hier explizit erweitern.
-- Wir droppen den ggf. vorhandenen Constraint und legen ihn neu an.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'group_join_requests_status_check'
       AND conrelid = 'public.group_join_requests'::regclass
  ) THEN
    ALTER TABLE public.group_join_requests
      DROP CONSTRAINT group_join_requests_status_check;
  END IF;

  ALTER TABLE public.group_join_requests
    ADD CONSTRAINT group_join_requests_status_check
    CHECK (status IN ('pending', 'invited', 'accepted', 'rejected'));
END $$;

CREATE INDEX IF NOT EXISTS group_join_requests_invited_idx
  ON public.group_join_requests (user_id, status)
  WHERE status = 'invited';
