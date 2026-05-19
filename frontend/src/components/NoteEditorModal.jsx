import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Maximize2, Minimize2, Trash2, Archive, Save, Check, Calendar as CalendarIcon, Link2, Link2Off, Search, Lock, Users, Eye } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { useTaskStore } from '../store/taskStore';
import { useAuthStore } from '../store/authStore';
import '../styles/note-editor-modal.css';

const NOTE_COLORS = [
  { name: 'Gelb', bg: '#FFFE94', border: '#E6D35C' },
  { name: 'Blau', bg: '#B3D9F7', border: '#5DADE2' },
  { name: 'Grün', bg: '#A9F5A9', border: '#58D68D' },
  { name: 'Rosa', bg: '#FFB3BA', border: '#F1948A' },
  { name: 'Orange', bg: '#FFCC99', border: '#F39C12' },
  { name: 'Lila', bg: '#E8DAEF', border: '#BB8FCE' },
];

function parseColor(content) {
  const m = (content || '').match(/^\[COLOR:([^\]]+)\]\s*/);
  if (m) {
    const color = NOTE_COLORS.find((c) => c.name === m[1]);
    return { color: color || NOTE_COLORS[0], rest: (content || '').slice(m[0].length) };
  }
  return { color: NOTE_COLORS[0], rest: content || '' };
}

function buildContent(rest, color) {
  return color && color.name !== 'Gelb' ? `[COLOR:${color.name}] ${rest}` : rest;
}

// Live-Markdown-Vorschau (nutzt simple Block-/Inline-Regeln).
function renderPreview(text) {
  if (!text) return null;
  const lines = text.split('\n');
  return lines.map((line, idx) => {
    if (!line.trim()) return <br key={`br-${idx}`} />;
    const h1 = line.match(/^#\s+(.+)/);
    if (h1) return <h1 key={idx}>{h1[1]}</h1>;
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) return <h2 key={idx}>{h2[1]}</h2>;
    const cb = line.match(/^(\s*)-\s\[( |x|X)\]\s?(.*)$/);
    if (cb) {
      const checked = cb[2].toLowerCase() === 'x';
      return (
        <div key={idx} className={`nem-md-check ${checked ? 'checked' : ''}`}>
          <span className="nem-md-checkbox" aria-hidden>{checked ? <Check size={12} strokeWidth={3} /> : null}</span>
          <span>{renderInline(cb[3])}</span>
        </div>
      );
    }
    const li = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (li) return <div key={idx} className="nem-md-li"><span className="nem-md-bullet">•</span><span>{renderInline(li[2])}</span></div>;
    return <p key={idx}>{renderInline(line)}</p>;
  });
}

function renderInline(text) {
  if (!text) return null;
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|https?:\/\/[^\s)]+)/g;
  const parts = [];
  let last = 0; let m; let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) parts.push(<strong key={i}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) parts.push(<code key={i}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('*')) parts.push(<em key={i}>{tok.slice(1, -1)}</em>);
    else parts.push(<a key={i} href={tok} target="_blank" rel="noopener noreferrer">{tok}</a>);
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function NoteEditorModal({ note, onClose, onUpdate, onDelete, onComplete, readOnly: readOnlyProp = false }) {
  const initialParsed = useMemo(() => parseColor(note?.content || ''), [note?.id]);
  const [title, setTitle] = useState(note?.title || '');
  const [content, setContent] = useState(initialParsed.rest);
  const [color, setColor] = useState(initialParsed.color);
  const [importance, setImportance] = useState(note?.importance || 'medium');
  // Owner-/Readonly-Logik: Notes von anderen Usern (z. B. an gemeinsame
  // Tasks angeheftete Team-Notes) werden read-only dargestellt.
  const currentUser = useAuthStore((s) => s.user);
  const currentUserId = currentUser?.id ? String(currentUser.id) : '';
  const isOwnerOfNote = !note?.user_id || (currentUserId && String(note.user_id) === currentUserId);
  const readOnly = readOnlyProp || !isOwnerOfNote;
  const [showPreview, setShowPreview] = useState(false);
  const [saveState, setSaveState] = useState('idle'); // 'idle' | 'saving' | 'saved'
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [taskQuery, setTaskQuery] = useState('');

  // Verknuepfter Termin / Aufgabe (bidirektional via notes.linked_task_id)
  const tasks = useTaskStore((s) => s.tasks);
  const linkedTask = useMemo(() => {
    if (!note?.linked_task_id || !Array.isArray(tasks)) return null;
    return tasks.find((t) => t && String(t.id) === String(note.linked_task_id)) || null;
  }, [tasks, note?.linked_task_id]);
  // Sichtbarkeit: 'private' (Default) oder 'group' — Toggle nur fuer Owner
  // einer Notiz, die an eine Gruppentask haengt.
  const visibility = note?.visibility === 'group' ? 'group' : 'private';
  const canShareWithGroup = isOwnerOfNote && !!linkedTask && !!linkedTask.group_id;
  const handleToggleVisibility = async () => {
    if (!canShareWithGroup || readOnly) return;
    const next = visibility === 'group' ? 'private' : 'group';
    try { await onUpdate?.(note.id, { visibility: next }); }
    catch (err) { console.error('[NoteEditorModal] toggle visibility failed:', err); }
  };
  const availableTasks = useMemo(() => {
    if (!Array.isArray(tasks)) return [];
    const q = taskQuery.trim().toLowerCase();
    return tasks
      .filter((t) => t && !t.completed && String(t.id) !== String(note?.linked_task_id || ''))
      .filter((t) => !q || (t.title || '').toLowerCase().includes(q))
      .slice(0, 30);
  }, [tasks, taskQuery, note?.linked_task_id]);

  const handleLinkTask = async (taskId) => {
    try {
      await onUpdate?.(note.id, { linked_task_id: taskId });
      setTaskPickerOpen(false);
      setTaskQuery('');
    } catch (err) {
      console.error('[NoteEditorModal] link task failed:', err);
    }
  };
  const handleUnlinkTask = async () => {
    try { await onUpdate?.(note.id, { linked_task_id: null }); } catch (err) { console.error(err); }
  };
  const handleOpenLinkedTask = () => {
    if (!linkedTask) return;
    flushSave();
    // Globaler Trigger: NotesPage (oder andere Mounter) oeffnen TaskDetailModal.
    window.dispatchEvent(new CustomEvent('beequ:open-task', { detail: { task: linkedTask } }));
    onClose?.();
  };
  const textareaRef = useRef(null);
  const saveTimerRef = useRef(null);
  const initialKeyRef = useRef(`${note?.id}|${note?.title || ''}|${note?.content || ''}|${note?.importance || ''}`);

  // ESC schliesst
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        flushSave();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  // Auto-Resize Textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [content]);

  // Debounced Auto-Save
  const scheduleSave = useCallback((nextTitle, nextContent, nextColor, nextImportance) => {
    if (!note?.id) return;
    if (readOnly) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveState('saving');
    saveTimerRef.current = setTimeout(async () => {
      try {
        await onUpdate?.(note.id, {
          title: (nextTitle || '').trim(),
          content: buildContent(nextContent, nextColor),
          importance: nextImportance,
        });
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 1200);
      } catch (err) {
        console.error('[NoteEditorModal] auto-save failed:', err);
        setSaveState('idle');
      }
    }, 700);
  }, [note?.id, onUpdate]);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (readOnly) return;
    const key = `${note?.id}|${title}|${buildContent(content, color)}|${importance}`;
    if (key === initialKeyRef.current) return;
    onUpdate?.(note.id, {
      title: (title || '').trim(),
      content: buildContent(content, color),
      importance,
    }).catch((err) => console.error('[NoteEditorModal] flush save failed:', err));
  }, [note?.id, title, content, color, importance, onUpdate]);

  useEffect(() => {
    scheduleSave(title, content, color, importance);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, color, importance]);

  // Beim Unmount sicher speichern
  useEffect(() => () => { flushSave(); }, [flushSave]);

  // Body-Klasse setzen: BottomNav ausblenden + Body-Scroll sperren ohne
  // Layout-Shift (Vermeidet, dass sich der notes-board-header verschiebt).
  useEffect(() => {
    document.body.classList.add('note-editor-open');
    return () => document.body.classList.remove('note-editor-open');
  }, []);

  if (!note) return null;

  const handleClose = () => {
    flushSave();
    onClose?.();
  };

  // Tab innerhalb der Textarea soll einrücken statt Fokus zu wechseln.
  const onTextareaKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = `${content.slice(0, start)}  ${content.slice(end)}`;
      setContent(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
    // Auto-Continue von Listen / Checklisten
    if (e.key === 'Enter' && !e.shiftKey) {
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const before = content.slice(0, start);
      const lineStart = before.lastIndexOf('\n') + 1;
      const currentLine = before.slice(lineStart);
      const cbMatch = currentLine.match(/^(\s*)-\s\[( |x|X)\]\s/);
      const liMatch = currentLine.match(/^(\s*)([-*])\s/);
      if (cbMatch || liMatch) {
        if (currentLine.replace(/^(\s*)(-\s\[( |x|X)\]\s|[-*]\s)/, '').trim() === '') {
          // Leere List-Item-Zeile -> Liste beenden
          e.preventDefault();
          const next = `${content.slice(0, lineStart)}${content.slice(start)}`;
          setContent(next);
          requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = lineStart; });
          return;
        }
        e.preventDefault();
        const prefix = cbMatch ? `${cbMatch[1]}- [ ] ` : `${liMatch[1]}${liMatch[2]} `;
        const next = `${content.slice(0, start)}\n${prefix}${content.slice(start)}`;
        setContent(next);
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 1 + prefix.length; });
      }
    }
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="nem-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
      >
        <motion.div
          className="nem-sheet"
          style={{ '--nem-accent': color.border }}
          initial={{ y: 24, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 24, opacity: 0, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          role="dialog"
          aria-modal="true"
          aria-label="Notiz bearbeiten"
        >
          <div className="nem-color-bar" aria-hidden="true" />
          <div className="nem-header">
            <input
              type="text"
              className="nem-title"
              value={title}
              maxLength={120}
              placeholder="Titel…"
              onChange={(e) => setTitle(e.target.value)}
              readOnly={readOnly}
            />
            <div className="nem-header-actions">
              {readOnly && (
                <span className="nem-readonly-badge" title="Nur lesen">
                  <Eye size={13} /> <span>Nur lesen</span>
                </span>
              )}
              {!readOnly && visibility === 'group' && (
                <span className="nem-readonly-badge nem-readonly-badge--shared" title="Mit Gruppe geteilt">
                  <Users size={13} /> <span>Geteilt</span>
                </span>
              )}
              <span className={`nem-save-state nem-save-${saveState}`} aria-live="polite">
                {saveState === 'saving' && 'Speichere…'}
                {saveState === 'saved' && 'Gespeichert'}
              </span>
              <button
                type="button"
                className="nem-icon-btn"
                onClick={() => setShowPreview((v) => !v)}
                title={showPreview ? 'Editor' : 'Vorschau'}
                aria-pressed={showPreview}
              >
                {showPreview ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <button
                type="button"
                className="nem-icon-btn"
                onClick={handleClose}
                title="Schliessen (Esc)"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="nem-body">
            {showPreview ? (
              <div className="nem-preview">
                {renderPreview(content) || <p className="nem-empty">Noch nichts geschrieben.</p>}
              </div>
            ) : (
              <textarea
                ref={textareaRef}
                className="nem-textarea"
                value={content}
                placeholder={`Schreib los…\n\nTipps:\n  **fett**   *kursiv*   \`code\`\n  - Aufzaehlung\n  - [ ] Checkliste\n  # Ueberschrift`}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={onTextareaKeyDown}
                autoFocus={!readOnly}
                readOnly={readOnly}
                spellCheck
              />
            )}
          </div>

          {/* Verknuepfter Termin / Aufgabe (bidirektional). */}
          <div className="nem-link-row">
            {linkedTask ? (
              <div className="nem-link-chip is-linked" role="group" aria-label="Verknuepfter Termin">
                <button
                  type="button"
                  className="nem-link-chip-main"
                  onClick={handleOpenLinkedTask}
                  title="Zum Termin springen"
                >
                  <CalendarIcon size={14} />
                  <span className="nem-link-chip-title">{linkedTask.title || 'Termin'}</span>
                  {linkedTask.date && (
                    <span className="nem-link-chip-meta">
                      {(() => { try { return format(parseISO(linkedTask.date), 'd. MMM', { locale: de }); } catch { return ''; } })()}
                      {linkedTask.time ? ` · ${linkedTask.time}` : ''}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="nem-link-chip-remove"
                  onClick={handleUnlinkTask}
                  title="Verknuepfung entfernen"
                  aria-label="Verknuepfung entfernen"
                  disabled={readOnly}
                  style={readOnly ? { display: 'none' } : undefined}
                >
                  <Link2Off size={13} />
                </button>
              </div>
            ) : (
              !readOnly && (
                <button
                  type="button"
                  className="nem-link-add"
                  onClick={() => setTaskPickerOpen((v) => !v)}
                  aria-expanded={taskPickerOpen}
                >
                  <Link2 size={14} /> <span>Termin anheften</span>
                </button>
              )
            )}
            {canShareWithGroup && (
              <button
                type="button"
                className={`nem-visibility-toggle${visibility === 'group' ? ' is-shared' : ''}`}
                onClick={handleToggleVisibility}
                title={visibility === 'group' ? 'Sichtbar fuer alle Gruppenmitglieder — klicken zum Privatisieren' : 'Nur fuer dich sichtbar — klicken zum Teilen mit Gruppe'}
                aria-pressed={visibility === 'group'}
              >
                {visibility === 'group' ? <Users size={13} /> : <Lock size={13} />}
                <span>{visibility === 'group' ? 'Mit Gruppe geteilt' : 'Privat'}</span>
              </button>
            )}
            {taskPickerOpen && !linkedTask && (
              <div className="nem-link-picker" role="listbox">
                <div className="nem-link-picker-search">
                  <Search size={13} />
                  <input
                    type="text"
                    placeholder="Termin suchen…"
                    value={taskQuery}
                    onChange={(e) => setTaskQuery(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="nem-link-picker-list">
                  {availableTasks.length === 0 ? (
                    <div className="nem-link-picker-empty">Keine passenden Termine.</div>
                  ) : availableTasks.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="nem-link-picker-item"
                      onClick={() => handleLinkTask(t.id)}
                      role="option"
                    >
                      <CalendarIcon size={12} />
                      <span className="nem-link-picker-title">{t.title}</span>
                      {t.date && (
                        <span className="nem-link-picker-meta">
                          {(() => { try { return format(parseISO(t.date), 'd. MMM', { locale: de }); } catch { return ''; } })()}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="nem-footer">
            {!readOnly && (
              <>
                <div className="nem-color-row" role="radiogroup" aria-label="Farbe">
              {NOTE_COLORS.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  role="radio"
                  aria-checked={c.name === color.name}
                  className={`nem-color-dot${c.name === color.name ? ' is-active' : ''}`}
                  style={{ backgroundColor: c.bg, borderColor: c.border }}
                  onClick={() => setColor(c)}
                  title={c.name}
                />
              ))}
            </div>

            <div className="nem-importance-row">
              {['low', 'medium', 'high'].map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`nem-importance-btn${importance === level ? ' is-active' : ''}`}
                  onClick={() => setImportance(level)}
                  title={`Wichtigkeit: ${level}`}
                >
                  {level === 'low' ? 'Niedrig' : level === 'medium' ? 'Mittel' : 'Hoch'}
                </button>
              ))}
            </div>

            <div className="nem-footer-actions">
              <button
                type="button"
                className="nem-action-btn"
                onClick={() => {
                  flushSave();
                  onComplete?.(note.id);
                  onClose?.();
                }}
                title="Erledigt -> Archiv"
              >
                <Archive size={14} /> <span>Archivieren</span>
              </button>
              <button
                type="button"
                className="nem-action-btn danger"
                onClick={() => {
                  if (!window.confirm('Notiz wirklich loeschen?')) return;
                  onDelete?.(note.id);
                  onClose?.();
                }}
                title="Loeschen"
              >
                <Trash2 size={14} /> <span>Loeschen</span>
              </button>
              <button
                type="button"
                className="nem-action-btn primary"
                onClick={handleClose}
                title="Schliessen (auto-gespeichert)"
              >
                <Save size={14} /> <span>Fertig</span>
              </button>
            </div>
              </>
            )}
            {readOnly && (
              <div className="nem-footer-actions">
                <button
                  type="button"
                  className="nem-action-btn primary"
                  onClick={handleClose}
                  title="Schliessen"
                >
                  <X size={14} /> <span>Schliessen</span>
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
