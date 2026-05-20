import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, ChevronDown, RotateCw } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { api } from '../utils/api';
import { useAuthStore } from '../store/authStore';

// Verb-Mapping: jeder Activity-Type bekommt einen menschlich lesbaren
// Satzbaustein. Akteur wird vorne drangehaengt ("Sarah hat …").
const TYPE_VERBS = {
  created: 'hat die Notiz erstellt',
  edited: 'hat die Notiz bearbeitet',
  completed: 'hat die Notiz erledigt',
  reopened: 'hat die Notiz wieder geöffnet',
  shared: 'hat die Notiz geteilt',
  unshared: 'hat eine Freigabe entfernt',
  share_accepted: 'hat die Freigabe angenommen',
  share_declined: 'hat die Freigabe abgelehnt',
  linked_task: 'hat einen Termin verknüpft',
  unlinked_task: 'hat den Termin entfernt',
  made_group: 'hat die Notiz mit der Gruppe geteilt',
  made_private: 'hat die Notiz privat gestellt',
  participants_changed: 'hat die Teilnehmer geändert',
  comment_added: 'hat einen Kommentar geschrieben',
  user_mentioned: 'hat jemanden erwähnt',
};

function relativeTime(iso) {
  if (!iso) return '';
  try {
    const d = typeof iso === 'string' ? parseISO(iso) : new Date(iso);
    return formatDistanceToNow(d, { addSuffix: true, locale: de });
  } catch {
    return '';
  }
}

function Avatar({ name, url, color }) {
  if (url) {
    return <img src={url} alt="" className="nem-act-avatar" />;
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className="nem-act-avatar nem-act-avatar--initial"
      style={color ? { background: color } : undefined}
    >
      {initial}
    </span>
  );
}

/**
 * Aktivitaetsverlauf einer Note. Klappt unter dem Editor auf und zeigt
 * die letzten 50 Eintraege (created/edited/shared/…), inkl. Live-Refresh
 * wenn die Note via Realtime aktualisiert wird (parent triggert via
 * refreshKey-Prop).
 */
export default function NoteActivityPanel({ noteId, refreshKey = 0, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const currentUser = useAuthStore((s) => s.user);
  const currentUserId = currentUser?.id ? String(currentUser.id) : '';

  const load = useCallback(async () => {
    if (!noteId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getNoteActivity(noteId);
      setItems(Array.isArray(data?.activity) ? data.activity : []);
    } catch (err) {
      setError(err?.message || 'Konnte Verlauf nicht laden');
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  // Lade beim ersten Aufklappen, danach bei jedem refreshKey-Tick (wenn
  // Panel offen ist — sonst beim naechsten Aufklappen).
  useEffect(() => {
    if (open) load();
  }, [open, load, refreshKey]);

  const count = items.length;

  const renderedItems = useMemo(() => items.map((row) => {
    const verb = TYPE_VERBS[row.type] || 'hat eine Änderung gemacht';
    const isMe = row.actor_user_id && String(row.actor_user_id) === currentUserId;
    const actorName = isMe ? 'Du' : (row.actor_name || 'Jemand');
    return (
      <li key={row.id} className="nem-act-item">
        <Avatar name={row.actor_name || '?'} url={row.actor_avatar_url} color={row.actor_avatar_color} />
        <div className="nem-act-body">
          <div className="nem-act-line">
            <span className="nem-act-actor">{actorName}</span>
            <span className="nem-act-verb"> {verb}</span>
          </div>
          <div className="nem-act-time" title={row.created_at}>{relativeTime(row.created_at)}</div>
        </div>
      </li>
    );
  }), [items, currentUserId]);

  return (
    <div className={`nem-act${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="nem-act-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Activity size={14} />
        <span>Aktivitätsverlauf{count > 0 ? ` · ${count}` : ''}</span>
        <ChevronDown size={14} className={`nem-act-chev${open ? ' is-open' : ''}`} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="nem-act-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="nem-act-head">
              <span className="nem-act-head-title">Letzte Aktivitäten</span>
              <button
                type="button"
                className="nem-act-refresh"
                onClick={load}
                disabled={loading}
                title="Aktualisieren"
                aria-label="Aktualisieren"
              >
                <RotateCw size={13} className={loading ? 'is-spin' : ''} />
              </button>
            </div>
            {loading && items.length === 0 ? (
              <div className="nem-act-empty">Lade Verlauf…</div>
            ) : error ? (
              <div className="nem-act-empty nem-act-empty--error">{error}</div>
            ) : items.length === 0 ? (
              <div className="nem-act-empty">Noch keine Aktivitäten.</div>
            ) : (
              <ul className="nem-act-list">{renderedItems}</ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
