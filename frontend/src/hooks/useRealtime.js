// Zentrale Realtime-Verwaltung.
//
// Verantwortlichkeiten:
//   1) Holt sich vom Backend ein Supabase-kompatibles JWT
//      (GET /api/auth/realtime-token) und setzt es auf den Realtime-Channel.
//   2) Erneuert das JWT automatisch kurz bevor es abläuft.
//   3) Verwaltet Subscriptions pro Feature (Tasks, Chat, Gruppen, Status, Notes)
//      und stösst bei Postgres-Events das jeweilige Refetch im Store an.
//
// Wird einmal pro Login aus App.jsx aufgerufen.

import { useEffect, useRef } from 'react';
import { getSupabase, isSupabaseConfigured } from '../lib/supabase';
import { api } from '../utils/api';

// Re-fetch wird gedebounced damit ein Bulk-Update (z.B. Server schreibt 5
// Rows nacheinander) nicht 5x denselben Endpoint hämmert.
function debounce(fn, ms = 250) {
  let t = null;
  const debounced = (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, ms);
  };
  debounced.cancel = () => { if (t) { clearTimeout(t); t = null; } };
  return debounced;
}

async function fetchRealtimeToken() {
  // api.request wirft bei 401, sonst { access_token, expires_in, expires_at, ... }
  const res = await api.getRealtimeToken();
  return res;
}

export function useRealtime({ userId, enabled = true } = {}) {
  const supabaseRef = useRef(null);
  const refreshTimerRef = useRef(null);
  const channelsRef = useRef([]);

  useEffect(() => {
    if (!enabled || !userId) return undefined;
    if (!isSupabaseConfigured()) return undefined;

    const supabase = getSupabase();
    if (!supabase) return undefined;
    supabaseRef.current = supabase;

    let cancelled = false;

    const setupAuthAndSubscribe = async () => {
      try {
        const tok = await fetchRealtimeToken();
        if (cancelled) return;
        if (!tok?.access_token) return;

        // Setzt das JWT auf den Realtime-Socket. auth.uid() / app_user_id() in
        // RLS-Policies sehen ab jetzt den eingeloggten User.
        try { supabase.realtime.setAuth(tok.access_token); } catch { /* ignore */ }

        scheduleRefresh(tok.expires_in);
        subscribeAll();
      } catch (err) {
        // 503 = Realtime nicht konfiguriert (SUPABASE_JWT_SECRET fehlt).
        // 401 = nicht eingeloggt. In beiden Faellen einfach kein Realtime.
        // eslint-disable-next-line no-console
        if (import.meta.env.DEV) console.warn('[realtime] disabled:', err?.message || err);
      }
    };

    const scheduleRefresh = (expiresInSec) => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      const refreshInMs = Math.max(30_000, (expiresInSec - 60) * 1000);
      refreshTimerRef.current = setTimeout(async () => {
        try {
          const tok = await fetchRealtimeToken();
          if (cancelled) return;
          if (tok?.access_token) {
            try { supabase.realtime.setAuth(tok.access_token); } catch { /* ignore */ }
            scheduleRefresh(tok.expires_in);
          }
        } catch { /* ignore */ }
      }, refreshInMs);
    };

    // ─── Subscriptions ───────────────────────────────────────────────
    const subscribeAll = () => {
      // 1) TASKS — eigene oder geteilte werden ueber RLS gefiltert.
      const refetchTasks = debounce(async () => {
        try {
          const { useTaskStore } = await import('../store/taskStore');
          await useTaskStore.getState().fetchTasks({}, { force: true });
        } catch { /* ignore */ }
      }, 250);

      const tasksChannel = supabase
        .channel(`rt-tasks-${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'tasks' },
          () => refetchTasks()
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'group_tasks' },
          () => refetchTasks()
        )
        .subscribe();

      channelsRef.current.push({ channel: tasksChannel, cancel: refetchTasks.cancel });

      // Weitere Features (Chat, Gruppen, Status, Notes) werden in Phase 2
      // hier ergaenzt - dieselbe Mechanik.
    };

    setupAuthAndSubscribe();

    return () => {
      cancelled = true;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      for (const entry of channelsRef.current) {
        try { entry.cancel?.(); } catch { /* ignore */ }
        try { supabase.removeChannel(entry.channel); } catch { /* ignore */ }
      }
      channelsRef.current = [];
    };
  }, [userId, enabled]);
}
