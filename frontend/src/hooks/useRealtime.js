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
import { useStatusStore } from '../store/statusStore';

// Globaler "Realtime aktiv"-Marker. Komponenten koennen so z.B. ihr Polling
// reduzieren, wenn live-Updates ankommen.
function setRealtimeActive(v) {
  try { window.__beequRealtimeActive = !!v; } catch { /* ignore */ }
}

// Diagnose-Objekt fuer User-Debugging. In DevTools-Konsole `__beequRealtime`
// eingeben um den aktuellen Stand zu sehen.
function setStatus(patch) {
  try {
    window.__beequRealtime = { ...(window.__beequRealtime || {}), ...patch, ts: Date.now() };
    // eslint-disable-next-line no-console
    console.info('[realtime]', window.__beequRealtime);
  } catch { /* ignore */ }
}

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
    if (!enabled || !userId) { setStatus({ phase: 'disabled', reason: 'no-user' }); return undefined; }
    if (!isSupabaseConfigured()) {
      setStatus({
        phase: 'misconfigured',
        reason: 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY fehlen im Build (Vercel ENV).',
      });
      return undefined;
    }

    const supabase = getSupabase();
    if (!supabase) { setStatus({ phase: 'misconfigured', reason: 'getSupabase() returned null' }); return undefined; }
    supabaseRef.current = supabase;
    setStatus({ phase: 'starting', userId });

    let cancelled = false;

    const setupAuthAndSubscribe = async () => {
      try {
        setStatus({ phase: 'fetching-token' });
        const tok = await fetchRealtimeToken();
        if (cancelled) return;
        if (!tok?.access_token) { setStatus({ phase: 'no-token', reason: 'response has no access_token' }); return; }

        // Setzt das JWT auf den Realtime-Socket. auth.uid() / app_user_id() in
        // RLS-Policies sehen ab jetzt den eingeloggten User.
        try { supabase.realtime.setAuth(tok.access_token); } catch { /* ignore */ }
        setStatus({ phase: 'token-set', expires_in: tok.expires_in });

        scheduleRefresh(tok.expires_in);
        subscribeAll();
      } catch (err) {
        // 503 = Realtime nicht konfiguriert (SUPABASE_JWT_SECRET fehlt).
        // 401 = nicht eingeloggt. In beiden Faellen einfach kein Realtime.
        setStatus({ phase: 'error', reason: err?.message || String(err) });
        // eslint-disable-next-line no-console
        console.warn('[realtime] disabled:', err?.message || err);
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
        .subscribe((status, err) => {
          setStatus({ tasksChannel: status, tasksErr: err?.message });
          if (status === 'SUBSCRIBED') setRealtimeActive(true);
        });

      channelsRef.current.push({ channel: tasksChannel, cancel: refetchTasks.cancel });

      // 2) CHAT — group_messages. Pro Postgres-Change feuern wir ein
      //    Window-Event mit der betroffenen group_id; GroupChatPanel laedt
      //    dann selbst neu (kein globaler Store-Refetch noetig).
      const chatChannel = supabase
        .channel(`rt-chat-${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'group_messages' },
          (payload) => {
            const gid = payload?.new?.group_id ?? payload?.old?.group_id;
            try {
              window.dispatchEvent(new CustomEvent('beequ:chat-changed', {
                detail: { groupId: gid, eventType: payload.eventType },
              }));
            } catch { /* ignore */ }
          }
        )
        .subscribe((status, err) => {
          setStatus({ chatChannel: status, chatErr: err?.message });
        });
      channelsRef.current.push({ channel: chatChannel });

      // 3) GRUPPEN — Aenderungen an groups + group_members refreshen die
      //    Gruppenliste. Hot-Pfad: neuer Member, Rolle geaendert, Gruppe
      //    umbenannt, etc.
      const refetchGroups = debounce(async () => {
        try {
          const { useGroupStore } = await import('../store/groupStore');
          await useGroupStore.getState().fetchGroups();
        } catch { /* ignore */ }
        try {
          window.dispatchEvent(new CustomEvent('beequ:groups-changed'));
        } catch { /* ignore */ }
      }, 300);

      const groupsChannel = supabase
        .channel(`rt-groups-${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'groups' },
          () => refetchGroups()
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'group_members' },
          () => refetchGroups()
        )
        .subscribe((status, err) => {
          setStatus({ groupsChannel: status, groupsErr: err?.message });
        });
      channelsRef.current.push({ channel: groupsChannel, cancel: refetchGroups.cancel });

      // 4) ONLINE-PRESENCE — Channel 'rt-presence'. Jeder verbundene Client
      //    'tracked' seine user_id; alle anderen sehen joins/leaves sofort.
      //    Kein DB-Write notwendig.
      const presence = supabase.channel('rt-presence', {
        config: { presence: { key: String(userId) } },
      });
      presence
        .on('presence', { event: 'sync' }, () => {
          const state = presence.presenceState();
          // state ist { '<userId>': [{ ...meta }, ...] }
          const ids = Object.keys(state).map((k) => Number(k)).filter(Boolean);
          useStatusStore.getState().setOnlineUsers(ids);
        })
        .on('presence', { event: 'join' }, ({ key }) => {
          if (key) useStatusStore.getState().addOnline(key);
        })
        .on('presence', { event: 'leave' }, ({ key }) => {
          if (key) useStatusStore.getState().removeOnline(key);
        })
        .subscribe(async (status, err) => {
          setStatus({ presenceChannel: status, presenceErr: err?.message });
          if (status === 'SUBSCRIBED') {
            try {
              await presence.track({ user_id: userId, online_at: Date.now() });
              setRealtimeActive(true);
              setStatus({ presenceTracked: true });
            } catch (e) {
              setStatus({ presenceTracked: false, trackErr: e?.message });
            }
          }
        });
      channelsRef.current.push({
        channel: presence,
        cancel: () => {
          try { presence.untrack(); } catch { /* ignore */ }
        },
      });

      // 5) TYPING — globaler Broadcast-Channel. Jede Tipp-Aktion sendet
      //    {groupId, userId}; alle anderen Clients markieren den User
      //    fuer ~4s als "tippt gerade". Wir publishen nicht ueber die DB.
      const typingChannel = supabase.channel('rt-typing');
      typingChannel
        .on('broadcast', { event: 'typing' }, (msg) => {
          const { groupId, userId: senderId } = msg?.payload || {};
          if (!groupId || !senderId) return;
          // Nicht uns selbst markieren.
          if (Number(senderId) === Number(userId)) return;
          useStatusStore.getState().markTyping(groupId, senderId);
        })
        .subscribe((status, err) => {
          setStatus({ typingChannel: status, typingErr: err?.message });
        });
      channelsRef.current.push({ channel: typingChannel });

      // Globaler Helper, damit UI-Code (z.B. Chat-Input) Typing senden kann
      // ohne Supabase direkt zu importieren.
      try {
        window.__beequBroadcastTyping = (groupId) => {
          try {
            typingChannel.send({
              type: 'broadcast',
              event: 'typing',
              payload: { groupId: String(groupId), userId },
            });
          } catch { /* ignore */ }
        };
      } catch { /* ignore */ }
    };

    setupAuthAndSubscribe();

    return () => {
      cancelled = true;
      setRealtimeActive(false);
      try { delete window.__beequBroadcastTyping; } catch { /* ignore */ }
      try { useStatusStore.getState().reset(); } catch { /* ignore */ }
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      for (const entry of channelsRef.current) {
        try { entry.cancel?.(); } catch { /* ignore */ }
        try { supabase.removeChannel(entry.channel); } catch { /* ignore */ }
      }
      channelsRef.current = [];
    };
  }, [userId, enabled]);
}
