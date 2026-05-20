import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, ChevronDown, Send, Trash2, RotateCw } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { api } from '../utils/api';
import { useAuthStore } from '../store/authStore';

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
  if (url) return <img src={url} alt="" className="nem-cm-avatar" />;
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className="nem-cm-avatar nem-cm-avatar--initial"
      style={color ? { background: color } : undefined}
    >
      {initial}
    </span>
  );
}

/**
 * Kommentar-Panel fuer Notes. Eigene Tabelle, eigener Endpoint
 * (/api/note-comments). Owner darf alle Kommentare loeschen, Autor seinen
 * eigenen. Realtime-Refresh ueber refreshKey-Prop (parent reicht
 * note.updated_at durch — Server broadcastet 'updated' nach jedem Post).
 */
export default function NoteCommentsPanel({ noteId, refreshKey = 0, defaultOpen = false, canWrite = true, noteOwnerId }) {
  const [open, setOpen] = useState(defaultOpen);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef(null);
  const currentUser = useAuthStore((s) => s.user);
  const currentUserId = currentUser?.id ? String(currentUser.id) : '';
  const isOwner = noteOwnerId && String(noteOwnerId) === currentUserId;

  const load = useCallback(async () => {
    if (!noteId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getNoteComments(noteId);
      setItems(Array.isArray(data?.comments) ? data.comments : []);
    } catch (err) {
      setError(err?.message || 'Konnte Kommentare nicht laden');
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => {
    if (open) load();
  }, [open, load, refreshKey]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    // Optimistic insert — wird durch refetch ueberschrieben falls noetig.
    const tempId = `tmp-${Date.now()}`;
    const optimistic = {
      id: tempId,
      note_id: noteId,
      user_id: currentUserId,
      text,
      created_at: new Date().toISOString(),
      author: currentUser?.name || 'Du',
      author_avatar_url: currentUser?.avatar_url || null,
      author_color: currentUser?.avatar_color || null,
      _optimistic: true,
    };
    setItems((prev) => [...prev, optimistic]);
    setDraft('');
    try {
      const res = await api.addNoteComment(noteId, text, null);
      setItems((prev) => prev.map((c) => (c.id === tempId ? res.comment : c)));
    } catch (err) {
      setItems((prev) => prev.filter((c) => c.id !== tempId));
      setError(err?.message || 'Senden fehlgeschlagen');
      // Draft zurueckgeben damit der User nichts verliert.
      setDraft(text);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleDelete = async (commentId) => {
    if (!window.confirm('Kommentar wirklich loeschen?')) return;
    const prev = items;
    setItems((cs) => cs.filter((c) => c.id !== commentId));
    try {
      await api.deleteNoteComment(commentId);
    } catch (err) {
      setItems(prev);
      setError(err?.message || 'Loeschen fehlgeschlagen');
    }
  };

  const handleKeyDown = (e) => {
    // Enter sendet; Shift+Enter macht Zeilenumbruch.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const count = items.length;

  return (
    <div className={`nem-cm${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="nem-cm-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <MessageCircle size={14} />
        <span>Kommentare{count > 0 ? ` · ${count}` : ''}</span>
        <ChevronDown size={14} className={`nem-cm-chev${open ? ' is-open' : ''}`} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="nem-cm-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="nem-cm-head">
              <span className="nem-cm-head-title">Diskussion</span>
              <button
                type="button"
                className="nem-cm-refresh"
                onClick={load}
                disabled={loading}
                title="Aktualisieren"
                aria-label="Aktualisieren"
              >
                <RotateCw size={13} className={loading ? 'is-spin' : ''} />
              </button>
            </div>

            {error && (
              <div className="nem-cm-empty nem-cm-empty--error">{error}</div>
            )}

            {loading && items.length === 0 ? (
              <div className="nem-cm-empty">Lade Kommentare…</div>
            ) : items.length === 0 ? (
              <div className="nem-cm-empty">Noch keine Kommentare. Sei der/die Erste!</div>
            ) : (
              <ul className="nem-cm-list">
                {items.map((c) => {
                  const isMe = String(c.user_id) === currentUserId;
                  const canDelete = isMe || isOwner;
                  return (
                    <li key={c.id} className={`nem-cm-item${isMe ? ' is-me' : ''}${c._optimistic ? ' is-pending' : ''}`}>
                      <Avatar name={c.author} url={c.author_avatar_url} color={c.author_color} />
                      <div className="nem-cm-body">
                        <div className="nem-cm-meta">
                          <span className="nem-cm-author">{isMe ? 'Du' : (c.author || 'Jemand')}</span>
                          <span className="nem-cm-time" title={c.created_at}>{relativeTime(c.created_at)}</span>
                          {canDelete && !c._optimistic && (
                            <button
                              type="button"
                              className="nem-cm-del"
                              onClick={() => handleDelete(c.id)}
                              title="Loeschen"
                              aria-label="Kommentar loeschen"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                        <div className="nem-cm-text">{c.text}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {canWrite && (
              <div className="nem-cm-compose">
                <textarea
                  ref={textareaRef}
                  className="nem-cm-input"
                  rows={2}
                  placeholder="Kommentar schreiben… (Enter sendet, Shift+Enter neue Zeile)"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  maxLength={4000}
                  disabled={sending}
                />
                <button
                  type="button"
                  className="nem-cm-send"
                  onClick={handleSend}
                  disabled={sending || !draft.trim()}
                  title="Senden (Enter)"
                  aria-label="Kommentar senden"
                >
                  <Send size={14} />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
