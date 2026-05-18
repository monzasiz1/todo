-- ─────────────────────────────────────────────────────────────────────────
-- BeeQu — Supabase Realtime + RLS Setup (Phase 1)
-- ─────────────────────────────────────────────────────────────────────────
-- Einmalig im Supabase Dashboard → SQL Editor → New Query ausführen.
-- Skript ist idempotent: kann beliebig oft erneut ausgeführt werden.
--
-- Was passiert:
--   1) Helper-Funktion app_user_id() liest das Custom-Claim 'app_user_id'
--      aus dem JWT (gesetzt von /api/auth/realtime-token).
--   2) Row Level Security wird auf den relevanten Tabellen aktiviert.
--   3) SELECT-Policies erlauben einem authentifizierten User genau die
--      Zeilen zu lesen, die er auch über die /api/* Routen sehen würde.
--      (Mutationen laufen weiterhin serverseitig über pg.Pool, also Policies
--       für INSERT/UPDATE/DELETE bleiben restriktiv → niemand kann direkt
--       über den anon-Key Daten verändern.)
--   4) Tabellen werden zur Publikation 'supabase_realtime' hinzugefügt,
--      damit Postgres Change-Events streamt.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1) Helper ────────────────────────────────────────────────────────────
-- Liest die App-User-ID aus dem JWT-Claim 'app_user_id' (Integer).
-- Nutzt SECURITY DEFINER nicht – auth.jwt() ist eine Supabase-Built-in.
CREATE OR REPLACE FUNCTION public.app_user_id()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'app_user_id', '')::int;
$$;

-- ── 2) user_status (neu) ─────────────────────────────────────────────────
-- Online/last-seen Status pro User. Wird vom Backend bei jeder
-- authentifizierten Anfrage aktualisiert (over /api/_lib/auth.js).
CREATE TABLE IF NOT EXISTS public.user_status (
  user_id INTEGER PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  is_online BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_status_last_seen ON public.user_status(last_seen_at DESC);

-- ── 3) RLS aktivieren ────────────────────────────────────────────────────
ALTER TABLE public.tasks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_tasks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_status      ENABLE ROW LEVEL SECURITY;

-- Notes / Verbindungen — können je nach Schema fehlen, daher absichern:
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notes') THEN
    EXECUTE 'ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'note_connections') THEN
    EXECUTE 'ALTER TABLE public.note_connections ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- ── 4) SELECT-Policies (Realtime-Sichtbarkeit) ───────────────────────────
-- TASKS: User sieht eigene Tasks und Tasks, die in Gruppen geteilt sind,
--        in denen er Mitglied ist.
DROP POLICY IF EXISTS rt_select_own_tasks ON public.tasks;
CREATE POLICY rt_select_own_tasks ON public.tasks
  FOR SELECT TO authenticated
  USING (
    user_id = public.app_user_id()
    OR EXISTS (
      SELECT 1
      FROM public.group_tasks gt
      JOIN public.group_members gm ON gm.group_id = gt.group_id
      WHERE gt.task_id = tasks.id
        AND gm.user_id = public.app_user_id()
    )
  );

-- CATEGORIES: nur eigene
DROP POLICY IF EXISTS rt_select_own_categories ON public.categories;
CREATE POLICY rt_select_own_categories ON public.categories
  FOR SELECT TO authenticated
  USING (user_id = public.app_user_id());

-- GROUPS: nur Gruppen in denen User Mitglied ist
DROP POLICY IF EXISTS rt_select_member_groups ON public.groups;
CREATE POLICY rt_select_member_groups ON public.groups
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = groups.id
        AND gm.user_id = public.app_user_id()
    )
  );

-- GROUP_MEMBERS: sichtbar wenn ich selbst Mitglied der Gruppe bin
DROP POLICY IF EXISTS rt_select_group_members ON public.group_members;
CREATE POLICY rt_select_group_members ON public.group_members
  FOR SELECT TO authenticated
  USING (
    group_id IN (
      SELECT g.group_id FROM public.group_members g
      WHERE g.user_id = public.app_user_id()
    )
  );

-- GROUP_MESSAGES: sichtbar wenn ich Mitglied der Gruppe bin
DROP POLICY IF EXISTS rt_select_group_messages ON public.group_messages;
CREATE POLICY rt_select_group_messages ON public.group_messages
  FOR SELECT TO authenticated
  USING (
    group_id IN (
      SELECT g.group_id FROM public.group_members g
      WHERE g.user_id = public.app_user_id()
    )
  );

-- GROUP_TASKS: sichtbar wenn ich Mitglied der Gruppe bin
DROP POLICY IF EXISTS rt_select_group_tasks ON public.group_tasks;
CREATE POLICY rt_select_group_tasks ON public.group_tasks
  FOR SELECT TO authenticated
  USING (
    group_id IN (
      SELECT g.group_id FROM public.group_members g
      WHERE g.user_id = public.app_user_id()
    )
  );

-- USER_STATUS: alle authentifizierten User koennen Status anderer sehen
-- (begrenzt auf "Freunde / Gruppenmitglieder" kann spaeter verfeinert werden).
DROP POLICY IF EXISTS rt_select_user_status ON public.user_status;
CREATE POLICY rt_select_user_status ON public.user_status
  FOR SELECT TO authenticated
  USING (true);

-- NOTES (falls vorhanden)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notes') THEN
    EXECUTE 'DROP POLICY IF EXISTS rt_select_own_notes ON public.notes';
    EXECUTE 'CREATE POLICY rt_select_own_notes ON public.notes FOR SELECT TO authenticated USING (user_id = public.app_user_id())';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'note_connections') THEN
    EXECUTE 'DROP POLICY IF EXISTS rt_select_own_note_connections ON public.note_connections';
    -- note_connections hat keine user_id-Spalte → Sichtbarkeit ueber die
    -- verbundenen Notes ableiten: User sieht eine Verbindung, wenn er
    -- mindestens eine der beiden Notes besitzt.
    EXECUTE $POL$
      CREATE POLICY rt_select_own_note_connections ON public.note_connections
        FOR SELECT TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM public.notes n
            WHERE (n.id = note_connections.note_id_1 OR n.id = note_connections.note_id_2)
              AND n.user_id = public.app_user_id()
          )
        )
    $POL$;
  END IF;
END $$;

-- ── 5) Mutationen über anon/authenticated explizit verbieten ─────────────
-- Es gibt KEINE INSERT/UPDATE/DELETE-Policies → das Default-Verhalten von RLS
-- ist "deny". Direkte Schreibversuche aus dem Browser scheitern. Mutationen
-- laufen weiter über die /api/* Routes mit Service-Role (pg.Pool umgeht RLS).

-- ── 6) Realtime Publication ──────────────────────────────────────────────
-- Tabellen zur Publikation hinzufügen, damit Change-Events gestreamt werden.
-- ALTER PUBLICATION ist idempotent über DO-Block + Existenzcheck.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'tasks',
    'categories',
    'groups',
    'group_members',
    'group_messages',
    'group_tasks',
    'user_status'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Existiert die Tabelle?
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN CONTINUE; END IF;
    -- Schon in der Publikation?
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN CONTINUE; END IF;
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
  END LOOP;

  -- Notes optional
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notes')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notes') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notes';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'note_connections')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'note_connections') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.note_connections';
  END IF;
END $$;

-- ── Fertig ───────────────────────────────────────────────────────────────
-- Verify (optional, eigene Query):
--   SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
--   SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity=true;
