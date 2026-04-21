import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Send, Pin, ChevronDown, ChevronUp,
  MessageCircle, Users, Sparkles, Check,
  Pencil, Trash2, Undo2, BarChart2, AlertTriangle
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

// ── Parse event details from message text ─────────────────────────────────────
function parseEventPreview(text) {
  // Time
  let timeStr = null;
  const tm1 = text.match(/\b(\d{1,2})[.:](\d{2})\s*Uhr\b/i);
  const tm2 = text.match(/\b(\d{1,2})\s*Uhr\b/i);
  if (tm1) timeStr = tm1[1].padStart(2, '0') + ':' + tm1[2];
  else if (tm2) timeStr = tm2[1].padStart(2, '00') + ':00';

  // Date
  let dateStr = null;
  const today = new Date();
  const addDays = (n) => { const d = new Date(today); d.setDate(today.getDate() + n); return d; };
  const fmtDE = (d) => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  if (/\bübermorgen\b/i.test(text)) dateStr = fmtDE(addDays(2));
  else if (/\bmorgen\b/i.test(text)) dateStr = fmtDE(addDays(1));
  else if (/\bheute\b/i.test(text)) dateStr = fmtDE(today);

  if (!dateStr) {
    const days = ['sonntag','montag','dienstag','mittwoch','donnerstag','freitag','samstag'];
    for (let i = 0; i < days.length; i++) {
      if (new RegExp(`\\b${days[i]}\\b`, 'i').test(text)) {
        let diff = i - today.getDay();
        if (diff <= 0) diff += 7;
        dateStr = fmtDE(addDays(diff));
        break;
      }
    }
  }
  if (!dateStr) {
    const dm = text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})?\b/);
    if (dm) {
      const y = dm[3] || today.getFullYear();
      dateStr = `${dm[1].padStart(2,'0')}.${dm[2].padStart(2,'0')}.${y}`;
    }
  }

  // Title: first meaningful sentence or first 55 chars
  let title = text.replace(/\s+/g, ' ').trim();
  const end = title.search(/[.!?]/);
  if (end > 5) title = title.slice(0, end);
  if (title.length > 55) title = title.slice(0, 55) + '…';

  // Convert DD.MM.YYYY → YYYY-MM-DD for input[type=date]
  let dateISO = '';
  if (dateStr) {
    const parts = dateStr.split('.');
    if (parts.length === 3) dateISO = `${parts[2]}-${parts[1]}-${parts[0]}`;
  }

  return { title, dateStr, timeStr, dateISO };
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
  const [groupDropOpen, setGroupDropOpen] = useState(false);
  const [editingMsgId, setEditingMsgId] = useState(null);
  const [editText, setEditText] = useState('');
  const [deletingMsgId, setDeletingMsgId] = useState(null);
  const [creatingFor, setCreatingFor] = useState(null); // '${msgId}_${type}'
  const [undoInfo, setUndoInfo] = useState(null);       // { taskId, label }
  const [votingId, setVotingId] = useState(null);        // 'msgId_optionId'
  const [pollBuilder, setPollBuilder] = useState(null);  // { msgId, question, options: string[] }
  const [ignoredCards, setIgnoredCards] = useState(new Set()); // msgIds of dismissed event cards
  const [eventModal, setEventModal] = useState(null);   // { msgId, title, date, time, location, description }
  const [submittingModal, setSubmittingModal] = useState(false);
  const [conflictInfo, setConflictInfo] = useState(null);
  const undoTimerRef = useRef(null);
  const conflictTimerRef = useRef(null);

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

  useEffect(() => () => {
    clearTimeout(undoTimerRef.current);
    clearTimeout(conflictTimerRef.current);
  }, []);

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

  // ── Auto-create with type + undo toast ───────────────────────────────────
  const createWithType = async (msg, type) => {
    const key = `${msg.id}_${type}`;
    setCreatingFor(key);
    try {
      const groupContext = selectedGroup
        ? { groupId: selectedGroup.id, groupName: selectedGroup.name, memberCount: selectedGroup.member_count }
        : null;
      const data = await api.parseAndCreateTask(msg.content, type, groupContext);
      const taskId = data?.task?.id;
      const typeLabel = type === 'termin' ? '📅 Termin' : type === 'aufgabe' ? '✅ Aufgabe' : '⏰ Erinnerung';
      setUndoInfo({ taskId, label: `${typeLabel} erstellt` });
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = setTimeout(() => setUndoInfo(null), 8000);
      if (data?.conflict_info?.has_conflict) {
        setConflictInfo(data.conflict_info);
        clearTimeout(conflictTimerRef.current);
        conflictTimerRef.current = setTimeout(() => setConflictInfo(null), 12000);
      }
    } catch {
      // ignore – API shows its own error
    } finally {
      setCreatingFor(null);
    }
  };

  const undoCreate = async () => {
    if (!undoInfo?.taskId) { setUndoInfo(null); return; }
    try { await api.deleteTask(undoInfo.taskId); } catch { /* ignore */ }
    clearTimeout(undoTimerRef.current);
    setUndoInfo(null);
  };

  // ── Event card handlers ──────────────────────────────────────────────────
  const openEventModal = (msg, preview) => {
    setEventModal({
      msgId: msg.id,
      originalContent: msg.content,
      title: preview.title,
      date: preview.dateISO,
      time: preview.timeStr || '',
      location: '',
      description: '',
    });
  };

  const ignoreEventCard = (msgId) => {
    setIgnoredCards(prev => new Set([...prev, msgId]));
  };

  const submitEventModal = async () => {
    if (!eventModal) return;
    setSubmittingModal(true);
    try {
      const parts = [eventModal.title];
      if (eventModal.date) {
        const [y, m, d] = eventModal.date.split('-');
        parts.push(`am ${d}.${m}.${y}`);
      }
      if (eventModal.time) parts.push(`um ${eventModal.time} Uhr`);
      if (eventModal.location) parts.push(`in ${eventModal.location}`);
      if (eventModal.description) parts.push(eventModal.description);
      const syntheticMsg = { id: eventModal.msgId, content: parts.join(' ') };
      await createWithType(syntheticMsg, 'termin');
      setIgnoredCards(prev => new Set([...prev, eventModal.msgId]));
      setEventModal(null);
    } catch { /* ignore */ } finally {
      setSubmittingModal(false);
    }
  };

  // ── Poll builder ─────────────────────────────────────────────────────────
  const openPollBuilder = (msg) => {
    setPollBuilder({ msgId: msg.id, question: msg.content, options: ['', '', ''] });
  };

  const submitPoll = async () => {
    if (!pollBuilder || !selectedGroupId) return;
    const opts = pollBuilder.options.map(o => o.trim()).filter(Boolean);
    if (opts.length < 2) return;
    try {
      const data = await api.createGroupPoll(selectedGroupId, pollBuilder.question, opts);
      setMessages(prev => [...prev, data.message]);
      setPollBuilder(null);
    } catch { /* ignore */ }
  };

  // ── Cast vote ─────────────────────────────────────────────────────────────
  const castVote = async (pollMsgId, optionId) => {
    const vKey = `${pollMsgId}_${optionId}`;
    if (votingId === vKey) return;
    setVotingId(vKey);
    // Optimistic update
    setMessages(prev => prev.map(m => {
      if (m.id !== pollMsgId) return m;
      const vd = { ...(m.vote_data || {}) };
      const wasVoted = vd[optionId]?.user_voted;
      vd[optionId] = { count: (vd[optionId]?.count || 0) + (wasVoted ? -1 : 1), user_voted: !wasVoted };
      return { ...m, vote_data: vd };
    }));
    try {
      const data = await api.voteGroupPoll(selectedGroupId, pollMsgId, optionId);
      setMessages(prev => prev.map(m => m.id === pollMsgId ? { ...m, vote_data: data.vote_data } : m));
    } catch {
      loadMessages(); // revert via reload
    } finally {
      setVotingId(null);
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
              <div className="gchat-header-row">
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
                    const hasTime = !msg.is_poll && detectTimeHint(msg.content);
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

                          {/* ── Poll card ── */}
                          {msg.is_poll ? (
                            <div className="gchat-poll-card">
                              <div className="gchat-poll-header">
                                <BarChart2 size={13} />
                                <span>Abstimmung</span>
                              </div>
                              <p className="gchat-poll-question">{msg.content}</p>
                              {(msg.poll_options || []).map(opt => {
                                const vd = msg.vote_data?.[opt.id];
                                const count = vd?.count || 0;
                                const voted = vd?.user_voted || false;
                                const total = (msg.poll_options || []).reduce(
                                  (s, o) => s + (msg.vote_data?.[o.id]?.count || 0), 0
                                );
                                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                                return (
                                  <button
                                    key={opt.id}
                                    className={`gchat-poll-option ${voted ? 'voted' : ''}`}
                                    onClick={() => castVote(msg.id, opt.id)}
                                    disabled={votingId === `${msg.id}_${opt.id}`}
                                  >
                                    <span className="gchat-poll-label">{opt.label}</span>
                                    <span className="gchat-poll-count">{count}</span>
                                    <div
                                      className="gchat-poll-bar"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </button>
                                );
                              })}
                              <span className="gchat-poll-footer">
                                {(msg.poll_options || []).reduce((s, o) => s + (msg.vote_data?.[o.id]?.count || 0), 0)} Stimmen
                              </span>
                            </div>
                          ) : (
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

                              {/* AI hint: event card + other chips */}
                              {hasTime && editingMsgId !== msg.id && (() => {
                                const preview = parseEventPreview(msg.content);
                                const isIgnored = ignoredCards.has(msg.id);
                                return (
                                  <div className="gchat-ai-hint">
                                    {/* ── Event Card ── */}
                                    {!isIgnored && (
                                      <div className="gchat-event-card">
                                        <div className="gchat-event-card-header">
                                          <span className="gchat-event-card-badge">📅 Termin erkannt</span>
                                          <span className="gchat-event-card-ai"><Sparkles size={10} /> KI-Vorschlag</span>
                                        </div>
                                        <div className="gchat-event-card-title">{preview.title}</div>
                                        <div className="gchat-event-card-meta">
                                          {preview.dateStr && <span>📆 {preview.dateStr}</span>}
                                          {preview.timeStr && <span>🕕 {preview.timeStr} Uhr</span>}
                                          <span>⏱ Dauer: unbekannt</span>
                                        </div>
                                        <div className="gchat-event-card-actions">
                                          <button
                                            className="gchat-event-card-btn gchat-event-card-btn--primary"
                                            disabled={!!creatingFor}
                                            onClick={() => openEventModal(msg, preview)}
                                          >
                                            {creatingFor === `${msg.id}_termin` ? <span className="gchat-spinner-inline" /> : '➕ Termin erstellen'}
                                          </button>
                                          <button
                                            className="gchat-event-card-btn gchat-event-card-btn--ghost"
                                            onClick={() => ignoreEventCard(msg.id)}
                                          >
                                            ❌ Ignorieren
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {/* ── Other chips ── */}
                                    <div className="gchat-ai-subactions-title">Weitere Aktionen</div>
                                    <div className="gchat-type-chips gchat-type-chips--slim">
                                      {[
                                        { type: 'aufgabe', label: '✅ Als Aufgabe' },
                                        { type: 'erinnerung', label: '⏰ Als Erinnerung' },
                                      ].map(({ type, label }) => (
                                        <button
                                          key={type}
                                          className="gchat-type-chip"
                                          disabled={!!creatingFor}
                                          onClick={() => createWithType(msg, type)}
                                        >
                                          {creatingFor === `${msg.id}_${type}` ? (
                                            <span className="gchat-spinner-inline" />
                                          ) : label}
                                        </button>
                                      ))}
                                      <button
                                        className="gchat-type-chip gchat-type-chip--poll"
                                        onClick={() => openPollBuilder(msg)}
                                      >
                                        📊 Abstimmung
                                      </button>
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Inline Poll Builder */}
                              {pollBuilder?.msgId === msg.id && (
                                <div className="gchat-poll-builder">
                                  <p className="gchat-poll-builder-title">Optionen eingeben:</p>
                                  {pollBuilder.options.map((opt, i) => (
                                    <input
                                      key={i}
                                      className="gchat-poll-option-input"
                                      placeholder={`Option ${i + 1}…`}
                                      value={opt}
                                      onChange={e => {
                                        const next = [...pollBuilder.options];
                                        next[i] = e.target.value;
                                        setPollBuilder(pb => ({ ...pb, options: next }));
                                      }}
                                    />
                                  ))}
                                  <button
                                    className="gchat-poll-builder-add"
                                    onClick={() => setPollBuilder(pb => ({ ...pb, options: [...pb.options, ''] }))}
                                    disabled={pollBuilder.options.length >= 6}
                                  >+ Option</button>
                                  <div className="gchat-edit-actions">
                                    <button className="gchat-edit-cancel" onClick={() => setPollBuilder(null)}>Abbrechen</button>
                                    <button
                                      className="gchat-edit-save"
                                      onClick={submitPoll}
                                      disabled={pollBuilder.options.filter(o => o.trim()).length < 2}
                                    >Umfrage senden</button>
                                  </div>
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
                          )}
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

            {/* ── Undo Toast ── */}
            <AnimatePresence>
              {undoInfo && (
                <motion.div
                  className="gchat-undo-toast"
                  initial={{ y: 60, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 60, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                >
                  <Check size={14} />
                  <span>{undoInfo.label}</span>
                  <button className="gchat-undo-btn" onClick={undoCreate}>
                    <Undo2 size={13} /> Rückgängig
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Conflict Toast ── */}
            <AnimatePresence>
              {conflictInfo?.has_conflict && (
                <motion.div
                  className="gchat-conflict-toast"
                  initial={{ y: 60, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 60, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 360, damping: 30 }}
                >
                  <AlertTriangle size={14} />
                  <span>{conflictInfo.message}</span>
                  <button className="gchat-undo-btn" onClick={() => setConflictInfo(null)}>
                    Verstanden
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Event Modal ── */}
            <AnimatePresence>
              {eventModal && (
                <motion.div
                  className="gchat-modal-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => !submittingModal && setEventModal(null)}
                >
                  <motion.div
                    className="gchat-modal"
                    initial={{ scale: 0.92, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.92, opacity: 0, y: 20 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="gchat-modal-top">
                      <span className="gchat-modal-icon">📅</span>
                      <h3 className="gchat-modal-title">Termin erstellen</h3>
                      <button className="gchat-modal-close" onClick={() => setEventModal(null)}>
                        <X size={16} />
                      </button>
                    </div>

                    <div className="gchat-modal-fields">
                      <label className="gchat-modal-label">Titel</label>
                      <input
                        className="gchat-modal-input"
                        value={eventModal.title}
                        onChange={(e) => setEventModal(m => ({ ...m, title: e.target.value }))}
                        placeholder="Titel des Termins"
                        autoFocus
                      />

                      <div className="gchat-modal-row">
                        <div className="gchat-modal-col">
                          <label className="gchat-modal-label">Datum</label>
                          <input
                            className="gchat-modal-input"
                            type="date"
                            value={eventModal.date}
                            onChange={(e) => setEventModal(m => ({ ...m, date: e.target.value }))}
                          />
                        </div>
                        <div className="gchat-modal-col">
                          <label className="gchat-modal-label">Uhrzeit</label>
                          <input
                            className="gchat-modal-input"
                            type="time"
                            value={eventModal.time}
                            onChange={(e) => setEventModal(m => ({ ...m, time: e.target.value }))}
                          />
                        </div>
                      </div>

                      <label className="gchat-modal-label">Ort <span className="gchat-modal-optional">(optional)</span></label>
                      <input
                        className="gchat-modal-input"
                        value={eventModal.location}
                        onChange={(e) => setEventModal(m => ({ ...m, location: e.target.value }))}
                        placeholder="z.B. Büro, Zoom-Link…"
                      />

                      <label className="gchat-modal-label">Beschreibung <span className="gchat-modal-optional">(optional)</span></label>
                      <textarea
                        className="gchat-modal-input gchat-modal-textarea"
                        value={eventModal.description}
                        onChange={(e) => setEventModal(m => ({ ...m, description: e.target.value }))}
                        placeholder="Weitere Details…"
                        rows={3}
                      />
                    </div>

                    <div className="gchat-modal-actions">
                      <button
                        className="gchat-modal-btn gchat-modal-btn--ghost"
                        onClick={() => setEventModal(null)}
                        disabled={submittingModal}
                      >
                        Abbrechen
                      </button>
                      <button
                        className="gchat-modal-btn gchat-modal-btn--primary"
                        onClick={submitEventModal}
                        disabled={submittingModal || !eventModal.title.trim()}
                      >
                        {submittingModal ? <span className="gchat-spinner-inline" /> : '➕ Termin erstellen'}
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
