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
    // Wichtig: NUR den Patch loggen, nicht den merged state — sonst sieht es
    // so aus als ob `phase` sich oft auf "token-set" wiederholt (in Wirklichkeit
    // sind das spaetere Subscribe-/Presence-Statusupdates die den alten phase
    // mit-loggen wuerden).
    // eslint-disable-next-line no-console
    console.info('[realtime]', { ...patch, ts: window.__beequRealtime.ts });
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

// ─── Modul-Singleton ─────────────────────────────────────────────────────
// Verhindert dass der Hook bei jedem Re-Render alles neu aufbaut.
// Wenn z.B. der Auth-Token in einem Refresh-Vorgang kurz auf null springt,
// flackert `enabled` von true→false→true und useEffect feuert mehrfach.
// Mit diesem Singleton ist das egal: Subscriptions bleiben bestehen, Token
// wird nicht neu geholt wenn der gecachte noch >5 Min gueltig ist.
const _rt = {
  userId: null,
  supabase: null,
  channels: [],          // { channel, cancel? }
  refreshTimer: null,
  tokenCache: null,      // { access_token, expires_in, expires_at_ms }
  inflight: null,        // Promise<token> waehrend Fetch laeuft
};

async function fetchRealtimeToken() {
  const now = Date.now();
  // Cache-Hit: Token noch min. 5 Minuten gueltig → wiederverwenden.
  if (_rt.tokenCache && _rt.tokenCache.expires_at_ms - now > 5 * 60_000) {
    return _rt.tokenCache;
  }
  // In-Flight-Dedupe: laeuft schon ein Fetch → an dessen Promise haengen.
  if (_rt.inflight) return _rt.inflight;
  _rt.inflight = (async () => {
    try {
      const res = await api.getRealtimeToken();
      if (res?.access_token) {
        _rt.tokenCache = {
          ...res,
          expires_at_ms: Date.now() + (res.expires_in || 3600) * 1000,
        };
        return _rt.tokenCache;
      }
      return res;
    } finally {
      _rt.inflight = null;
    }
  })();
  return _rt.inflight;
}

function teardownSingleton() {
  if (_rt.refreshTimer) { clearTimeout(_rt.refreshTimer); _rt.refreshTimer = null; }
  for (const entry of _rt.channels) {
    try { entry.cancel?.(); } catch { /* ignore */ }
    try { _rt.supabase?.removeChannel(entry.channel); } catch { /* ignore */ }
  }
  _rt.channels = [];
  _rt.userId = null;
  _rt.supabase = null;
  _rt.tokenCache = null;
  _rt.starting = false;
  setRealtimeActive(false);
  try { delete window.__beequBroadcastTyping; } catch { /* ignore */ }
  try { useStatusStore.getState().reset(); } catch { /* ignore */ }
}

export function useRealtime({ userId, enabled = true } = {}) {
  const supabaseRef = useRef(null);

  useEffect(() => {
    if (!enabled || !userId) {
      // Logout / kein User → komplett aufraeumen.
      if (_rt.userId) teardownSingleton();
      setStatus({ phase: 'disabled', reason: 'no-user' });
      return undefined;
    }
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

    // Singleton schon fuer denselben User aktiv ODER gerade beim Setup?
    // Nichts tun — verhindert mehrfaches Fetchen + Re-Subscribes wenn der
    // Effekt schnell hintereinander re-runs (z.B. waehrend setupAuth noch
    // laeuft und die Channels noch nicht gepusht sind).
    if (_rt.userId === userId && (_rt.starting || _rt.channels.length > 0)) {
      setStatus({ phase: 'already-active', userId });
      return undefined;
    }
    // User gewechselt? Erst alten Stand abreissen.
    if (_rt.userId && _rt.userId !== userId) teardownSingleton();

    _rt.userId = userId;
    _rt.supabase = supabase;
    _rt.starting = true; // SYNCHRONER Lock — gilt sofort fuer alle parallelen useEffect-Runs
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
        // Token-Payload dekodieren (nur zur Diagnose, keine Signatur-Pruefung).
        let tokenPayload = null;
        try {
          const part = tok.access_token.split('.')[1];
          const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
          tokenPayload = JSON.parse(json);
        } catch { /* ignore */ }
        setStatus({
          phase: 'token-set',
          expires_in: tok.expires_in,
          tokenPayload,
          tokenLen: tok.access_token.length,
        });

        // Socket-Level Fehler/Close-Events einfangen, damit wir die
        // Server-Begruendung sehen (z.B. "InvalidJWTToken").
        try {
          const sock = supabase.realtime;
          sock.onError?.((e) => {
            setStatus({ socketError: e?.message || String(e) || 'unknown' });
          });
          sock.onClose?.((e) => {
            setStatus({ socketClose: { code: e?.code, reason: e?.reason } });
          });
        } catch { /* ignore */ }

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
      if (_rt.refreshTimer) clearTimeout(_rt.refreshTimer);
      const refreshInMs = Math.max(30_000, (expiresInSec - 60) * 1000);
      _rt.refreshTimer = setTimeout(async () => {
        try {
          // Cache invalidieren damit wirklich neu geholt wird.
          _rt.tokenCache = null;
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

      _rt.channels.push({ channel: tasksChannel, cancel: refetchTasks.cancel });

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
                detail: { groupId: gid, eventType: payload.eventType, via: 'pg' },
              }));
            } catch { /* ignore */ }
          }
        )
        .subscribe((status, err) => {
          setStatus({ chatChannel: status, chatErr: err?.message });
        });
      _rt.channels.push({ channel: chatChannel });

      // 2b) CHAT FAST-LANE — globaler Broadcast-Topic 'rt-chat'. Der Server
      //    sendet direkt nach dem INSERT ein leichtgewichtiges
      //    'new_message'-Event (~50-150ms statt ~500-1000ms bei
      //    postgres_changes). Payload enthaelt nur group_id + message_id,
      //    keine Inhalte (Broadcast umgeht RLS). GroupChatPanel filtert
      //    selbst nach offener Gruppe und lehrt aktuelle Nachrichten ueber
      //    die normale REST-API nach.
      const chatBroadcastChannel = supabase
        .channel('rt-chat')
        .on(
          'broadcast',
          { event: 'new_message' },
          (msg) => {
            const gid = msg?.payload?.group_id;
            try {
              window.dispatchEvent(new CustomEvent('beequ:chat-changed', {
                detail: { groupId: gid, eventType: 'INSERT', via: 'broadcast' },
              }));
            } catch { /* ignore */ }
          }
        )
        .subscribe((status, err) => {
          setStatus({ chatBroadcast: status, chatBroadcastErr: err?.message });
        });
      _rt.channels.push({ channel: chatBroadcastChannel });

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
      _rt.channels.push({ channel: groupsChannel, cancel: refetchGroups.cancel });

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
      _rt.channels.push({
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
      _rt.channels.push({ channel: typingChannel });

      // Globaler Helper, damit UI-Code (z.B. Chat-Input) Typing senden kann
      // ohne Supabase direkt zu importieren. Throttled auf 1x/2s, und nur
      // wenn der Channel auch SUBSCRIBED ist (sonst spammen wir 402-Errors
      // wenn Supabase Realtime gesperrt/pausiert ist).
      let lastTypingSentAt = 0;
      try {
        window.__beequBroadcastTyping = (groupId) => {
          try {
            const st = (typeof window !== 'undefined' && window.__beequRealtime) || {};
            if (st.typingChannel !== 'SUBSCRIBED') return;
            const now = Date.now();
            if (now - lastTypingSentAt < 2000) return;
            lastTypingSentAt = now;
            typingChannel.send({
              type: 'broadcast',
              event: 'typing',
              payload: { groupId: String(groupId), userId },
            });
          } catch { /* ignore */ }
        };
      } catch { /* ignore */ }
    };

    setupAuthAndSubscribe().finally(() => { _rt.starting = false; });

    // Bewusst KEIN cleanup im return: wir wollen NICHT bei jedem useEffect-
    // Re-Run (z.B. wegen kurzem token-flicker) alles abreissen. Echter
    // Teardown passiert oben wenn enabled=false / userId-Wechsel.
    return undefined;
  }, [userId, enabled]);
}
