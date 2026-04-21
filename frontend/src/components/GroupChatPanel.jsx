import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Send, Pin, ChevronDown, ChevronUp,
  MessageCircle, CalendarPlus, Users, Sparkles, Check,
  Pencil, Trash2
} from 'lucide-react';
import { useGroupStore } from '../store/groupStore';
import { useAuthStore } from '../store/authStore';
import { api } from '../utils/api';
import AvatarBadge from './AvatarBadge';

// ── AI: Detect German time/date patterns ──────────────────────────────────────
const TIME_PATTERNS = [
  /\b\d{1,2}[.:]\d{2}\s*Uhr\b/i,
  /\b\d{1,2}\s*Uhr\b/i,
  /\b(morgen|übermorgen|heute\s+abend|heute\s+nacht|heute\s+früh|heute\s+nachmittag|heute)\b/i,
  /\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i,
  /\bnächste[rn]?\s+(woche|wochenende|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i,
  /\bam\s+wochenende\b/i,
  /\b\d{1,2}\.\d{1,2}\.(\d{4})?\b/,
];

function detectTimeHint(text) {
  return TIME_PATTERNS.some((re) => re.test(text));
}

// ── Smart reply chips ─────────────────────────────────────────────────────────
const SMART_REPLIES = [
  { label: '✅ Erledigt', text: 'Erledigt!' },
  { label: '⏰ Später', text: 'Melde mich später!' },
  { label: '📋 Übernehmen', text: 'Ich übernehme das!' },
];

// ── Format timestamp ──────────────────────────────────────────────────────────
function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) +
    ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// ── Initials avatar fallback ──────────────────────────────────────────────────
function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

export default function GroupChatPanel({ open, onClose }) {
  const { groups, fetchGroups } = useGroupStore();
  const { user } = useAuthStore();

  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [creatingEvent, setCreatingEvent] = useState(null); // msgId being turned into task
  const [eventSuccess, setEventSuccess] = useState(null);  // msgId that just got created
  const [groupDropOpen, setGroupDropOpen] = useState(false);
  const [editingMsgId, setEditingMsgId] = useState(null);
  const [editText, setEditText] = useState('');
  const [deletingMsgId, setDeletingMsgId] = useState(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const pollRef = useRef(null);

  // ── Fetch groups on mount ─────────────────────────────────────────────────
  useEffect(() => {
    if (open && groups.length === 0) fetchGroups();
  }, [open]);

  // ── Auto-select first group ───────────────────────────────────────────────
  useEffect(() => {
    if (groups.length > 0 && !selectedGroupId) {
      setSelectedGroupId(groups[0].id);
    }
  }, [groups]);

  // ── Load messages + poll ─────────────────────────────────────────────────
  const loadMessages = useCallback(async () => {
    if (!selectedGroupId) return;
    try {
      const data = await api.getGroupMessages(selectedGroupId);
      setMessages(data.messages || []);
    } catch {
      // silently ignore poll errors
    }
  }, [selectedGroupId]);

  useEffect(() => {
    if (!open || !selectedGroupId) return;
    setLoadingMsgs(true);
    loadMessages().finally(() => setLoadingMsgs(false));

    clearInterval(pollRef.current);
    pollRef.current = setInterval(loadMessages, 5000);
    return () => clearInterval(pollRef.current);
  }, [open, selectedGroupId, loadMessages]);

  // ── Focus input when opening ──────────────────────────────────────────────
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open]);

  // ── Scroll to bottom on new messages ─────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = async (text) => {
    const content = (text || input).trim();
    if (!content || sending || !selectedGroupId) return;
    setSending(true);
    setInput('');
    try {
      const data = await api.sendGroupMessage(selectedGroupId, content);
      setMessages((prev) => [...prev, data.message]);
    } catch (err) {
      // restore input on error
      if (!text) setInput(content);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Pin / unpin ───────────────────────────────────────────────────────────
  const togglePin = async (msg) => {
    const newPinned = !msg.is_pinned;
    // Optimistic update
    setMessages((prev) =>
      prev.map((m) => m.id === msg.id ? { ...m, is_pinned: newPinned } : m)
    );
    try {
      await api.pinGroupMessage(selectedGroupId, msg.id, newPinned);
    } catch {
      // Revert
      setMessages((prev) =>
        prev.map((m) => m.id === msg.id ? { ...m, is_pinned: !newPinned } : m)
      );
    }
  };

  // ── Edit message ──────────────────────────────────────────────────────────
  const startEdit = (msg) => {
    setEditingMsgId(msg.id);
    setEditText(msg.content);
  };

  const cancelEdit = () => {
    setEditingMsgId(null);
    setEditText('');
  };

  const saveEdit = async (msgId) => {
    const content = editText.trim();
    if (!content) return;
    const original = messages.find((m) => m.id === msgId);
    // Optimistic update
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, content, edited_at: new Date().toISOString() } : m));
    setEditingMsgId(null);
    setEditText('');
    try {
      await api.editGroupMessage(selectedGroupId, msgId, content);
    } catch {
      // Revert on error
      setMessages((prev) => prev.map((m) => m.id === msgId ? original : m));
    }
  };

  // ── Delete message ────────────────────────────────────────────────────────
  const deleteMessage = async (msgId) => {
    setDeletingMsgId(msgId);
    // Optimistic remove
    const backup = messages.find((m) => m.id === msgId);
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
    try {
      await api.deleteGroupMessage(selectedGroupId, msgId);
    } catch {
      // Revert on error
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.created_at < backup.created_at);
        if (idx === -1) return [...prev, backup];
        const next = [...prev];
        next.splice(idx, 0, backup);
        return next;
      });
    } finally {
      setDeletingMsgId(null);
    }
  };

  // ── "Termin erstellen" — parse and create task via AI ─────────────────────
  const createEventFromMessage = async (msg) => {
    setCreatingEvent(msg.id);
    try {
      await api.parseAndCreateTask(msg.content);
      setEventSuccess(msg.id);
      setTimeout(() => setEventSuccess(null), 3000);
    } catch {
      // ignore
    } finally {
      setCreatingEvent(null);
    }
  };

  // ── Derived data ──────────────────────────────────────────────────────────
  const pinnedMessages = messages.filter((m) => m.is_pinned);
  const selectedGroup = groups.find((g) => g.id === selectedGroupId);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop (mobile) */}
          <motion.div
            className="gchat-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            className="gchat-panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 340, damping: 32 }}
          >
            {/* ── Header ── */}
            <div className="gchat-header">
              <div className="gchat-header-left">
                <div className="gchat-icon">
                  <MessageCircle size={16} />
                </div>
                <span className="gchat-title">Gruppen-Chat</span>
              </div>
              <button className="gchat-close" onClick={onClose}>
                <X size={18} />
              </button>
            </div>

            {/* ── Group Selector ── */}
            {groups.length === 0 ? (
              <div className="gchat-empty-groups">
                <Users size={28} />
                <p>Keine Gruppen vorhanden</p>
                <span>Erstelle oder tritt einer Gruppe bei, um zu chatten.</span>
              </div>
            ) : (
              <>
                <div className="gchat-group-selector">
                  <button
                    className="gchat-group-btn"
                    onClick={() => setGroupDropOpen((v) => !v)}
                  >
                    <span
                      className="gchat-group-dot"
                      style={{ background: selectedGroup?.color || 'var(--primary)' }}
                    />
                    <span className="gchat-group-name">{selectedGroup?.name || 'Gruppe wählen'}</span>
                    <ChevronDown size={14} className={groupDropOpen ? 'rotated' : ''} />
                  </button>
                  <AnimatePresence>
                    {groupDropOpen && (
                      <motion.div
                        className="gchat-group-dropdown"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                      >
                        {groups.map((g) => (
                          <button
                            key={g.id}
                            className={`gchat-group-option ${g.id === selectedGroupId ? 'active' : ''}`}
                            onClick={() => {
                              setSelectedGroupId(g.id);
                              setMessages([]);
                              setGroupDropOpen(false);
                            }}
                          >
                            <span className="gchat-group-dot" style={{ background: g.color || '#007AFF' }} />
                            {g.name}
                            {g.id === selectedGroupId && <Check size={12} style={{ marginLeft: 'auto' }} />}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* ── Pinned Messages ── */}
                {pinnedMessages.length > 0 && (
                  <div className="gchat-pinned-section">
                    <button
                      className="gchat-pinned-header"
                      onClick={() => setPinnedOpen((v) => !v)}
                    >
                      <Pin size={12} />
                      <span>{pinnedMessages.length} angepinnte Nachricht{pinnedMessages.length !== 1 ? 'en' : ''}</span>
                      {pinnedOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                    <AnimatePresence>
                      {pinnedOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          style={{ overflow: 'hidden' }}
                        >
                          {pinnedMessages.map((m) => (
                            <div key={m.id} className="gchat-pinned-msg">
                              <span className="gchat-pinned-sender">{m.sender_name}:</span>
                              <span className="gchat-pinned-content">{m.content}</span>
                            </div>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* ── Messages ── */}
                <div className="gchat-messages">
                  {loadingMsgs && messages.length === 0 && (
                    <div className="gchat-loading">
                      <div className="gchat-spinner" />
                    </div>
                  )}
                  {!loadingMsgs && messages.length === 0 && (
                    <div className="gchat-no-messages">
                      <MessageCircle size={28} />
                      <p>Noch keine Nachrichten</p>
                      <span>Schreib die erste Nachricht!</span>
                    </div>
                  )}

                  {messages.map((msg, idx) => {
                    const isOwn = msg.user_id === user?.id;
                    const hasTime = detectTimeHint(msg.content);
                    const showSender =
                      !isOwn &&
                      (idx === 0 || messages[idx - 1].user_id !== msg.user_id);

                    return (
                      <div
                        key={msg.id}
                        className={`gchat-msg-row ${isOwn ? 'own' : 'other'}`}
                      >
                        {/* Avatar (only for first message in a streak) */}
                        {!isOwn && (
                          <div className="gchat-msg-avatar">
                            {showSender ? (
                              msg.sender_avatar ? (
                                <img src={msg.sender_avatar} alt={msg.sender_name} />
                              ) : (
                                <div
                                  className="gchat-avatar-initials"
                                  style={{ background: msg.sender_color || '#007AFF' }}
                                >
                                  {initials(msg.sender_name)}
                                </div>
                              )
                            ) : (
                              <div className="gchat-avatar-spacer" />
                            )}
                          </div>
                        )}

                        <div className="gchat-msg-col">
                          {showSender && !isOwn && (
                            <span className="gchat-sender-name">{msg.sender_name}</span>
                          )}

                          <div className={`gchat-bubble ${isOwn ? 'own' : ''} ${msg.is_pinned ? 'pinned' : ''}`}>
                            {editingMsgId === msg.id ? (
                              <div className="gchat-edit-area">
                                <textarea
                                  className="gchat-edit-input"
                                  value={editText}
                                  onChange={(e) => setEditText(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(msg.id); }
                                    if (e.key === 'Escape') cancelEdit();
                                  }}
                                  autoFocus
                                  rows={2}
                                />
                                <div className="gchat-edit-actions">
                                  <button className="gchat-edit-cancel" onClick={cancelEdit}>Abbrechen</button>
                                  <button className="gchat-edit-save" onClick={() => saveEdit(msg.id)} disabled={!editText.trim()}>Speichern</button>
                                </div>
                              </div>
                            ) : (
                              <p className="gchat-bubble-text">
                                {msg.content}
                                {msg.edited_at && <span className="gchat-edited-tag"> (bearbeitet)</span>}
                              </p>
                            )}

                            {/* AI Calendar hint */}
                            {hasTime && (
                              <div className="gchat-ai-hint">
                                <Sparkles size={11} />
                                <span>Zeitangabe erkannt</span>
                                {eventSuccess === msg.id ? (
                                  <span className="gchat-event-success">
                                    <Check size={11} /> Termin erstellt!
                                  </span>
                                ) : (
                                  <button
                                    className="gchat-event-btn"
                                    disabled={creatingEvent === msg.id}
                                    onClick={() => createEventFromMessage(msg)}
                                  >
                                    {creatingEvent === msg.id ? (
                                      <span className="gchat-spinner-inline" />
                                    ) : (
                                      <>
                                        <CalendarPlus size={11} />
                                        Termin erstellen?
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Timestamp + pin + edit/delete for own messages */}
                            <div className="gchat-bubble-meta">
                              <span className="gchat-time">{formatTime(msg.created_at)}</span>
                              {isOwn && editingMsgId !== msg.id && (
                                <>
                                  <button
                                    className="gchat-pin-btn"
                                    onClick={() => startEdit(msg)}
                                    title="Bearbeiten"
                                  >
                                    <Pencil size={10} />
                                  </button>
                                  <button
                                    className={`gchat-pin-btn gchat-delete-btn ${deletingMsgId === msg.id ? 'deleting' : ''}`}
                                    onClick={() => deleteMessage(msg.id)}
                                    title="Löschen"
                                    disabled={deletingMsgId === msg.id}
                                  >
                                    <Trash2 size={10} />
                                  </button>
                                </>
                              )}
                              <button
                                className={`gchat-pin-btn ${msg.is_pinned ? 'active' : ''}`}
                                onClick={() => togglePin(msg)}
                                title={msg.is_pinned ? 'Losgelöst' : 'Anpinnen'}
                              >
                                <Pin size={10} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {/* ── Smart Replies ── */}
                <div className="gchat-smart-replies">
                  {SMART_REPLIES.map((r) => (
                    <button
                      key={r.text}
                      className="gchat-smart-chip"
                      onClick={() => sendMessage(r.text)}
                      disabled={sending}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>

                {/* ── Input ── */}
                <div className="gchat-input-row">
                  <textarea
                    ref={inputRef}
                    className="gchat-input"
                    placeholder="Nachricht schreiben…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                  />
                  <button
                    className="gchat-send-btn"
                    onClick={() => sendMessage()}
                    disabled={!input.trim() || sending}
                  >
                    {sending ? (
                      <div className="gchat-spinner-inline" />
                    ) : (
                      <Send size={16} />
                    )}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
