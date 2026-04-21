import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Send, Pin, ChevronDown, ChevronUp,
  MessageCircle, Users, Sparkles, Check,
  Pencil, Trash2, Undo2, BarChart2
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
  const [groupDropOpen, setGroupDropOpen] = useState(false);
  const [editingMsgId, setEditingMsgId] = useState(null);
  const [editText, setEditText] = useState('');
  const [deletingMsgId, setDeletingMsgId] = useState(null);
  const [creatingFor, setCreatingFor] = useState(null); // '${msgId}_${type}'
  const [undoInfo, setUndoInfo] = useState(null);       // { taskId, label }
  const [votingId, setVotingId] = useState(null);        // 'msgId_optionId'
  const [pollBuilder, setPollBuilder] = useState(null);  // { msgId, question, options: string[] }
  const undoTimerRef = useRef(null);

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

                              {/* AI hint: type chips */}
                              {hasTime && editingMsgId !== msg.id && (
                                <div className="gchat-ai-hint">
                                  <Sparkles size={11} />
                                  <span>KI-Vorschlag:</span>
                                  <div className="gchat-type-chips">
                                    {[
                                      { type: 'termin', label: '📅 Termin' },
                                      { type: 'aufgabe', label: '✅ Aufgabe' },
                                      { type: 'erinnerung', label: '⏰ Erinnerung' },
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
                              )}

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
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
