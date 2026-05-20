import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { motion, useDragControls } from 'framer-motion';
import { Plus, ZoomIn, ZoomOut, X, CalendarDays, Pin, CheckSquare, Calendar, Check, Archive, RotateCcw, Trash2, LayoutGrid, Link2, Unlink, Maximize2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useOpenTask } from '../hooks/useOpenTask';
import TaskDetailModal from '../components/TaskDetailModal';
import NoteEditorModal from '../components/NoteEditorModal';
import { useNotesStore } from '../store/notesStore';
import { useTaskStore } from '../store/taskStore';
import '../styles/notes.css';

const NOTE_COLORS = [
  { name: 'Gelb', bg: '#FFFE94', border: '#E6D35C', shadow: '#D4AC0D' },
  { name: 'Blau', bg: '#B3D9F7', border: '#5DADE2', shadow: '#2E86AB' },
  { name: 'Grün', bg: '#A9F5A9', border: '#58D68D', shadow: '#27AE60' },
  { name: 'Rosa', bg: '#FFB3BA', border: '#F1948A', shadow: '#E74C3C' },
  { name: 'Orange', bg: '#FFCC99', border: '#F39C12', shadow: '#D35400' },
  { name: 'Lila', bg: '#E8DAEF', border: '#BB8FCE', shadow: '#8E44AD' },
];

// ── Mini-Markdown (Inline): **fett**, *kursiv*, `code`, http(s)-Links ─────────
// Bewusst klein gehalten — kein dangerouslySetInnerHTML, kein XSS-Risiko.
function renderInlineMd(text, baseKey) {
  if (!text) return null;
  // Token-Regex: **bold**, *italic*, `code`, URL
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|https?:\/\/[^\s)]+)/g;
  const parts = [];
  let last = 0; let m; let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) parts.push(<strong key={`${baseKey}-b-${i}`}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) parts.push(<code key={`${baseKey}-c-${i}`} className="note-md-code">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('*')) parts.push(<em key={`${baseKey}-i-${i}`}>{tok.slice(1, -1)}</em>);
    else parts.push(
      <a
        key={`${baseKey}-a-${i}`}
        href={tok}
        target="_blank"
        rel="noopener noreferrer"
        className="note-md-link"
        onClick={(e) => e.stopPropagation()}
      >{tok}</a>
    );
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ── Block-Renderer: Zeile-für-Zeile inkl. Checklisten und Listen ──────────────
// onToggleLine(lineIndex) wird aufgerufen, wenn der User eine Checkbox klickt.
// Der gerenderte JSX-Baum darf auf .note-display geklickt werden (öffnet Editor),
// Checkboxen und Links stoppen die Propagation.
function renderNoteMarkdown(text, onToggleLine) {
  if (!text) return null;
  const lines = text.split('\n');
  const out = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) {
      out.push(<div key={`ln-${idx}`} className="note-md-blank" />);
      continue;
    }
    const cbMatch = line.match(/^(\s*)-\s\[( |x|X)\]\s?(.*)$/);
    if (cbMatch) {
      const checked = cbMatch[2].toLowerCase() === 'x';
      const rest = cbMatch[3];
      out.push(
        <div key={`ln-${idx}`} className={`note-md-check ${checked ? 'checked' : ''}`}>
          <button
            type="button"
            className="note-md-checkbox"
            aria-checked={checked}
            role="checkbox"
            onClick={(e) => { e.stopPropagation(); onToggleLine?.(idx); }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {checked ? <Check size={11} strokeWidth={3} /> : null}
          </button>
          <span className="note-md-check-text">{renderInlineMd(rest, `ln-${idx}`)}</span>
        </div>
      );
      continue;
    }
    const liMatch = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (liMatch) {
      out.push(
        <div key={`ln-${idx}`} className="note-md-li">
          <span className="note-md-bullet">•</span>
          <span>{renderInlineMd(liMatch[2], `ln-${idx}`)}</span>
        </div>
      );
      continue;
    }
    out.push(
      <div key={`ln-${idx}`} className="note-md-p">{renderInlineMd(line, `ln-${idx}`)}</div>
    );
  }
  return out;
}

function StickyNoteImpl({ note, onUpdate, onDelete, onComplete, onPositionChange, isSelected, onSelect, tasks = [], onOpenTask, boardScaleRef, gridPos = null, dragDisabled = false, onDragLive, onOpenEditor }) {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(note.content || '');
  const [title, setTitle] = useState(note.title || '');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const noteRef = useRef(null);
  const dragStartPos = useRef({ x: 0, y: 0 });
  // Doppelklick-Erkennung auf .note-display: erster Klick startet
  // setIsEditing erst nach kurzer Verzoegerung — kommt ein zweiter Klick
  // davor, wird stattdessen der Vollbild-Editor geoeffnet.
  const displayClickRef = useRef({ time: 0, timer: null });
  // Drag-Controls für swipe-to-close des Termin-Pickers — Drag startet
  // nur vom Handle/Header, damit Scrollen in der Liste nicht blockiert wird.
  const taskPickerDragControls = useDragControls();

  const noteColor = useMemo(() => {
    const contentStr = note.content || '';
    const colorMatch = contentStr.match(/^\[COLOR:([^\]]+)\]/);
    if (colorMatch) {
      const colorName = colorMatch[1];
      return NOTE_COLORS.find(c => c.name === colorName) || NOTE_COLORS[0];
    }
    return NOTE_COLORS[0];
  }, [note.content]);

  const actualContent = useMemo(() => {
    const contentStr = note.content || '';
    return contentStr.replace(/^\[COLOR:[^\]]+\]\s*/, '');
  }, [note.content]);

  const isLongText = useMemo(() => {
    // Mehr Platz fuer Listen / Checklisten: erst ab 220 Zeichen kuerzen.
    // Wenn der Inhalt Checklisten oder Mehrzeiler enthaelt, NIE kuerzen.
    if (/\n/.test(actualContent)) return false;
    return actualContent.length > 220;
  }, [actualContent]);

  const displayContent = useMemo(() => {
    if (!isLongText || isExpanded) return actualContent;
    return actualContent.slice(0, 220) + '...';
  }, [actualContent, isLongText, isExpanded]);

  // 0 = pin+curl-BR, 1 = sheen, 2 = tape, 3 = clip+curl-BL
  const variantIndex = useMemo(() => {
    const id = String(note?.id ?? Math.random());
    const sum = id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return sum % 4;
  }, [note?.id]);

  const linkedTasks = useMemo(() => {
    if (!Array.isArray(tasks) || !note.linked_task_id) return [];
    return tasks.filter(task => task != null && task.id === note.linked_task_id);
  }, [tasks, note.linked_task_id]);

  const availableTasks = useMemo(() => {
    if (!Array.isArray(tasks)) return [];
    return tasks.filter(task => task != null && task.id !== note.linked_task_id && !task.completed);
  }, [tasks, note.linked_task_id]);

  const handleSave = useCallback(async () => {
    const contentWithColor = `[COLOR:${noteColor.name}] ${content.trim()}`;
    if (contentWithColor !== note.content) {
      await onUpdate(note.id, { content: contentWithColor });
    }
    setIsEditing(false);
  }, [content, note.content, note.id, onUpdate, noteColor.name]);

  // Checkbox-Toggle in einer bestimmten Zeile (Persistenz inkl. COLOR-Prefix).
  const handleToggleLine = useCallback(async (lineIndex) => {
    const text = actualContent || '';
    const lines = text.split('\n');
    if (lineIndex < 0 || lineIndex >= lines.length) return;
    const m = lines[lineIndex].match(/^(\s*-\s\[)( |x|X)(\]\s?.*)$/);
    if (!m) return;
    const newMark = m[2].toLowerCase() === 'x' ? ' ' : 'x';
    lines[lineIndex] = `${m[1]}${newMark}${m[3]}`;
    const updated = lines.join('\n');
    const contentWithColor = `[COLOR:${noteColor.name}] ${updated}`;
    try { await onUpdate(note.id, { content: contentWithColor }); }
    catch (err) { console.error('Checklist-Toggle failed:', err); }
  }, [actualContent, noteColor.name, note.id, onUpdate]);

  // rAF-throttled drag — never thrash layout, single style write per frame
  const rafIdRef = useRef(0);
  const pendingPosRef = useRef(null);

  const handlePointerDown = useCallback((e) => {
    if (
      e.target.closest('.note-content') ||
      e.target.closest('.note-actions') ||
      e.target.closest('.note-linked-tasks') ||
      e.target.closest('.note-title-input') ||
      e.target.closest('.note-title-display') ||
      e.target.closest('.task-picker-overlay')
    ) return;

    // Drag im Grid-Modus deaktiviert
    if (dragDisabled) {
      onSelect(note.id);
      return;
    }

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    setIsDragging(true);
    onSelect(note.id);

    dragStartPos.current = {
      noteX: note.x ?? 100,
      noteY: note.y ?? 100,
      startX: clientX,
      startY: clientY,
      lastX: note.x ?? 100,
      lastY: note.y ?? 100,
    };

    // preventDefault nur wenn das Event ueberhaupt cancelable ist
    // (React's synthetisches onTouchStart ist passive → preventDefault wirkt nicht
    // und spammt nur die Konsole). Native touchstart unten ist non-passive.
    if (e.cancelable) e.preventDefault();
  }, [note.id, note.x, note.y, onSelect, dragDisabled]);

  const handlePointerMove = useCallback((e) => {
    if (!isDragging) return;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    // Pointer-Delta in Screen-Pixeln, dann durch Board-Scale teilen,
    // damit das Notizblatt unter dem Finger bleibt, auch wenn rein-/rausgezoomt.
    const zoom = boardScaleRef?.current ?? 1;
    const deltaX = (clientX - dragStartPos.current.startX) / zoom;
    const deltaY = (clientY - dragStartPos.current.startY) / zoom;

    const newX = Math.max(0, dragStartPos.current.noteX + deltaX);
    const newY = Math.max(0, dragStartPos.current.noteY + deltaY);

    pendingPosRef.current = { x: newX, y: newY };
    if (rafIdRef.current) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = 0;
      const pos = pendingPosRef.current;
      if (!pos || !noteRef.current) return;
      noteRef.current.style.left = `${pos.x}px`;
      noteRef.current.style.top = `${pos.y}px`;
      dragStartPos.current.lastX = pos.x;
      dragStartPos.current.lastY = pos.y;
    });
  }, [isDragging, boardScaleRef]);

  const handlePointerUp = useCallback(() => {
    if (!isDragging) return;
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
    const x = Math.max(0, dragStartPos.current.lastX ?? (note.x ?? 100));
    const y = Math.max(0, dragStartPos.current.lastY ?? (note.y ?? 100));
    // Nur persistieren, wenn die Position sich wirklich veraendert hat
    // (Toleranz 2 px). Verhindert API-Calls bei reinem Klick ohne Drag.
    const prevX = note.x ?? 100;
    const prevY = note.y ?? 100;
    if (Math.abs(x - prevX) > 2 || Math.abs(y - prevY) > 2) {
      onPositionChange(note.id, x, y);
    }
    setIsDragging(false);
    // Drag-Ende → Live-Position aufraeumen (Linien snappen zur Server-Position).
    onDragLive?.(null);
  }, [isDragging, note.id, note.x, note.y, onPositionChange, onDragLive]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handlePointerMove);
      document.addEventListener('mouseup', handlePointerUp);
      document.addEventListener('touchmove', handlePointerMove, { passive: false });
      document.addEventListener('touchend', handlePointerUp);
      return () => {
        document.removeEventListener('mousemove', handlePointerMove);
        document.removeEventListener('mouseup', handlePointerUp);
        document.removeEventListener('touchmove', handlePointerMove);
        document.removeEventListener('touchend', handlePointerUp);
      };
    }
  }, [isDragging, handlePointerMove, handlePointerUp]);

  // Touchstart als native non-passive Listener anhaengen, damit preventDefault
  // tatsaechlich wirkt (React's onTouchStart ist seit React 18 passive).
  useEffect(() => {
    const el = noteRef.current;
    if (!el) return;
    const handler = (ev) => handlePointerDown(ev);
    el.addEventListener('touchstart', handler, { passive: false });
    return () => el.removeEventListener('touchstart', handler);
  }, [handlePointerDown]);

  const handleLinkTask = useCallback(async (taskId) => {
    try {
      await onUpdate(note.id, { linked_task_id: taskId });
      setShowTaskPicker(false);
    } catch (error) {
      console.error('Task-Linking fehlgeschlagen:', error);
      alert('Termin konnte nicht angeheftet werden. Versuche es später erneut.');
      setShowTaskPicker(false);
    }
  }, [note.id, onUpdate]);

  const handleUnlinkTask = useCallback(async () => {
    await onUpdate(note.id, { linked_task_id: null });
  }, [note.id, onUpdate]);

  // Stable rotation seeded from note.id — kein Wechsel bei Re-Mount,
  // kein Flash nach dem ersten Paint (nicht mehr in useEffect).
  const rotation = useMemo(() => {
    const id = String(note?.id ?? '');
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    const rotations = [-3, -2, -1, 0, 1, 2, 3];
    return rotations[Math.abs(h) % rotations.length];
  }, [note?.id]);

  useEffect(() => {
    setContent(actualContent);
  }, [actualContent]);

  useEffect(() => {
    setTitle(note.title || '');
  }, [note.title]);

  const handleTitleSave = useCallback(async () => {
    const trimmed = (title || '').trim();
    if (trimmed !== (note.title || '').trim()) {
      try { await onUpdate(note.id, { title: trimmed }); } catch (err) { console.error('Title-Save failed:', err); }
    }
    setIsEditingTitle(false);
  }, [title, note.title, note.id, onUpdate]);

  const hasTitle = !!(note.title && String(note.title).trim());
  const posX = gridPos ? gridPos.x : (note.x ?? 100);
  const posY = gridPos ? gridPos.y : (note.y ?? 100);

  return (
    <div
      ref={noteRef}
      className={`sticky-note ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${linkedTasks.length > 0 ? 'has-linked-task' : ''} ${hasTitle ? 'has-title' : ''}`}
      data-variant={variantIndex}
      style={{
        position: 'absolute',
        left: posX,
        top: posY,
        // Vollflächige Note-Farbe ohne Transparenz — Kork darf nicht durchscheinen.
        backgroundColor: noteColor.bg,
        boxShadow: `2px 4px 8px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255,255,255,0.28)`,
        borderColor: noteColor.border,
        zIndex: isSelected ? 15 : isDragging ? 20 : 1,
        transform: `translateZ(0) rotate(${rotation}deg)`,
      }}
      onMouseDown={handlePointerDown}
      onDoubleClick={(e) => {
        // Doppelklick auf der Note (nicht auf Buttons/Links/Eingabefeldern)
        // oeffnet den Vollbild-Editor.
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('textarea') || e.target.closest('a')) return;
        e.stopPropagation();
        onOpenEditor?.(note.id);
      }}>
      
      {/* Visual indicator for linked tasks */}
      {linkedTasks.length > 0 && (
        <div className="note-linked-task-visual" title={`Verknüpft mit: ${linkedTasks.map(t => t.title).join(', ')}`}>
          <div className="task-visual-icon">📅</div>
          <div className="task-visual-info">
            <span className="task-count">{linkedTasks.length}</span>
          </div>
        </div>
      )}

      <div className="sticky-note-header">
        <span className="note-attach-anchor">
          {variantIndex === 0 && <span className="thumbtack" aria-hidden="true" />}
        </span>
        {variantIndex === 3 && <span className="paperclip-icon" aria-hidden="true" />}
        <div className="note-actions">
          <button
            className="note-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onOpenEditor?.(note.id);
            }}
            title="Im Vollbild-Editor oeffnen"
          >
            <Maximize2 size={12} />
          </button>
          <button
            className="note-action-btn complete"
            onClick={(e) => {
              e.stopPropagation();
              onComplete?.(note.id);
            }}
            title="Erledigt → ins Archiv"
          >
            <Check size={12} />
          </button>
          <button
            className="note-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              setShowTaskPicker(true);
            }}
            title="Termin anheften"
          >
            <CalendarDays size={12} />
          </button>
          <button
            className="note-action-btn delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(note.id);
            }}
            title="Löschen"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Titel-Zeile (optional). Inline-editierbar wie der Content. */}
      {isEditingTitle ? (
        <input
          type="text"
          className="note-title-input"
          value={title}
          maxLength={80}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleTitleSave(); }
            if (e.key === 'Escape') { setTitle(note.title || ''); setIsEditingTitle(false); }
          }}
          placeholder="Titel…"
          autoFocus
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <div
          className="note-title-display"
          onClick={(e) => { e.stopPropagation(); setIsEditingTitle(true); }}
          title={hasTitle ? note.title : 'Titel hinzufügen'}
        >
          {hasTitle ? note.title : ''}
        </div>
      )}

      <div className="note-content">
        {isEditing ? (
          <textarea
            className="note-textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onInput={(e) => {
              // Auto-Grow: Textarea waechst mit dem Inhalt, .note-content
              // capped per CSS und scrollt darueber hinaus.
              const ta = e.currentTarget;
              ta.style.height = 'auto';
              ta.style.height = `${ta.scrollHeight}px`;
            }}
            ref={(el) => {
              if (el && el.scrollHeight && el.style.height !== `${el.scrollHeight}px`) {
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }
            }}
            onBlur={handleSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) {
                handleSave();
              }
              if (e.key === 'Escape') {
                setContent(actualContent);
                setIsEditing(false);
              }
            }}
            placeholder="Notiz schreiben..."
            autoFocus
          />
        ) : (
          <div
            className="note-display"
            onClick={(e) => {
              e.stopPropagation();
              // Klicks auf interaktive Markdown-Elemente (Checkbox/Link) starten den Editor nicht.
              if (e.target.closest('.note-md-checkbox') || e.target.closest('.note-md-link')) return;
              const now = Date.now();
              const last = displayClickRef.current.time;
              if (now - last < 320) {
                // Doppelklick erkannt -> Vollbild-Editor
                if (displayClickRef.current.timer) {
                  clearTimeout(displayClickRef.current.timer);
                  displayClickRef.current.timer = null;
                }
                displayClickRef.current.time = 0;
                onOpenEditor?.(note.id);
                return;
              }
              displayClickRef.current.time = now;
              if (displayClickRef.current.timer) clearTimeout(displayClickRef.current.timer);
              displayClickRef.current.timer = setTimeout(() => {
                displayClickRef.current.time = 0;
                displayClickRef.current.timer = null;
                setIsEditing(true);
              }, 320);
            }}
            onDoubleClick={(e) => {
              // Fallback (Browser dispatcht dblclick nativ): direkt oeffnen.
              e.stopPropagation();
              if (displayClickRef.current.timer) {
                clearTimeout(displayClickRef.current.timer);
                displayClickRef.current.timer = null;
              }
              displayClickRef.current.time = 0;
              onOpenEditor?.(note.id);
            }}
          >
            {displayContent ? renderNoteMarkdown(displayContent, handleToggleLine) : null}
            {isLongText && !isExpanded && (
              <button 
                className="expand-text-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(true);
                }}
                title="Vollständigen Text anzeigen"
              >
                ...mehr
              </button>
            )}
            {isLongText && isExpanded && (
              <button 
                className="collapse-text-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(false);
                }}
                title="Text einklappen"
              >
                ᵕ
              </button>
            )}
          </div>
        )}
      </div>

      {linkedTasks.length > 0 && (
        <div className="note-linked-tasks">
          {linkedTasks.filter(Boolean).map((task) => (
            <div
              key={task.id}
              className="linked-task-item"
              onClick={(e) => { e.stopPropagation(); onOpenTask?.(task); }}
              style={{ cursor: 'pointer', '--task-color': task.color || '#4CAF50' }}
            >
              <div className="task-preview">
                <div 
                  className="task-color-indicator"
                  style={{ backgroundColor: task.color || '#4CAF50' }}
                />
                <span className="task-name" title={task.title}>
                  {task.title}
                </span>
                {task.date && (
                  <span className="task-date">
                    {new Date(task.date).toLocaleDateString('de-DE', { 
                      day: '2-digit', 
                      month: '2-digit' 
                    })}
                  </span>
                )}
              </div>
              <button
                className="task-unlink-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleUnlinkTask();
                }}
                title="Termin entfernen"
              >
                <X size={8} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showTaskPicker && createPortal(
        <div
          className="task-picker-overlay"
          onPointerDown={(e) => {
            // Schließe nur, wenn direkt auf den Overlay-Backdrop geklickt/getippt wurde
            if (e.target === e.currentTarget) setShowTaskPicker(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Termin anheften"
        >
          <motion.div
            className="task-picker-modal"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            dragMomentum={false}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) setShowTaskPicker(false);
            }}
          >
            <div className="task-picker-handle" aria-hidden="true" />
            <div className="task-picker-header">
              <h3>Termin anheften</h3>
              <button
                className="close-btn"
                onClick={() => setShowTaskPicker(false)}
                aria-label="Schließen"
              >
                <X size={18} />
              </button>
            </div>
            <div className="task-picker-list">
              {availableTasks.length > 0 ? (
                availableTasks.map((task) => (
                  <button
                    type="button"
                    key={task.id}
                    className="task-picker-item"
                    onClick={() => handleLinkTask(task.id)}
                  >
                    <div
                      className="task-color-dot"
                      style={{ backgroundColor: task.color || '#007AFF' }}
                    />
                    <div className="task-type-icon">
                      {task.type === 'event' ? (
                        <Calendar size={14} color="#666" />
                      ) : (
                        <CheckSquare size={14} color="#666" />
                      )}
                    </div>
                    <div className="task-info">
                      <div className="task-title">{task.title}</div>
                      <div className="task-meta">
                        <span className="task-type-label">
                          {task.type === 'event' ? 'Termin' : 'Aufgabe'}
                        </span>
                        {task.date && (
                          <>
                            <span className="task-meta-separator">•</span>
                            <span className="task-date">
                              {new Date(task.date).toLocaleDateString('de-DE')}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="task-picker-empty">
                  <CalendarDays size={32} />
                  <p>Keine verfügbaren Aufgaben oder Termine</p>
                  <small>Erstelle zuerst Aufgaben oder Termine im Kalender</small>
                </div>
              )}
            </div>
          </motion.div>
        </div>,
        document.body
      )}
    </div>
  );
}

// Memoisierter Export: nur re-rendern, wenn sich relevante Props aendern.
// Pan/Zoom des Boards aendern KEINE dieser Props mehr -> keine Note re-rendert
// waehrend man das Canvas verschiebt/zoomt.
const StickyNote = memo(StickyNoteImpl, (prev, next) => (
  prev.note === next.note &&
  prev.isSelected === next.isSelected &&
  prev.tasks === next.tasks &&
  prev.onUpdate === next.onUpdate &&
  prev.onDelete === next.onDelete &&
  prev.onComplete === next.onComplete &&
  prev.onPositionChange === next.onPositionChange &&
  prev.onSelect === next.onSelect &&
  prev.onOpenTask === next.onOpenTask &&
  prev.boardScaleRef === next.boardScaleRef &&
  prev.gridPos?.x === next.gridPos?.x &&
  prev.gridPos?.y === next.gridPos?.y &&
  prev.dragDisabled === next.dragDisabled &&
  prev.onDragLive === next.onDragLive &&
  prev.onOpenEditor === next.onOpenEditor
));

const BOARD_W = 3200;
const BOARD_H = 2400;
const MIN_SCALE = 0.3;
const MAX_SCALE = 2.0;

export default function NotesPage() {
  const { detailTask, openTask, closeTask } = useOpenTask();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    notes, createNote, updateNote, deleteNote, fetchNotes,
    completeNote, restoreArchivedNote, fetchArchivedNotes,
    archivedNotes, archivedLoading,
    connections, fetchConnections, addConnection, removeConnection,
  } = useNotesStore();
  const tasks = useTaskStore((s) => s.tasks);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const [showArchive, setShowArchive] = useState(false);

  const [scale, setScale] = useState(1);
  // Initial-Pan: grobe Schätzung der Canvas-Mitte relativ zum Viewport.
  // Verhindert das kurze Aufblitzen von oben-links beim ersten Rendern,
  // bevor centerView() den exakten Pan berechnet hat.
  const [pan, setPan] = useState(() => {
    if (typeof window === 'undefined') return { x: 0, y: 0 };
    // Sidebar (Desktop) belegt links etwa 280 px; auf Mobile nichts.
    const sidebarOffset = window.innerWidth > 1024 ? 280 : 0;
    const vw = window.innerWidth - sidebarOffset;
    const vh = window.innerHeight - 60; // Header
    return {
      x: vw / 2 - BOARD_W / 2,
      y: vh / 2 - BOARD_H / 2,
    };
  });
  const [selectedNoteIds, setSelectedNoteIds] = useState([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState(null);
  const [showMobileHint, setShowMobileHint] = useState(false);
  // Vollbild-Editor-Modal ("Notizblatt"): id der Notiz oder null.
  const [editorNoteId, setEditorNoteId] = useState(null);

  // Bridge: ?openNote=ID -> Editor oeffnen (zB Aufruf aus TaskDetailModal).
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('openNote');
    if (!id) return;
    setEditorNoteId(id);
    // Query-Param entfernen, damit Reload nicht erneut auftriggert.
    params.delete('openNote');
    navigate({ pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : '' }, { replace: true });
  }, [location.search, location.pathname, navigate]);

  // Bridge: NoteEditorModal dispatcht beequ:open-task -> hier oeffnen wir
  // den Task ueber useOpenTask (bidirektionaler Click-Through).
  useEffect(() => {
    const handler = (ev) => {
      const t = ev?.detail?.task;
      if (t) openTask(t);
    };
    window.addEventListener('beequ:open-task', handler);
    return () => window.removeEventListener('beequ:open-task', handler);
  }, [openTask]);

  // Live-Drag-Position der gerade gezogenen Note. Wird per rAF aktualisiert,
  // damit Verbindungslinien smooth mitziehen, ohne pro Frame alle Notes neu zu
  // rendern (StickyNote ist memoisiert).
  const [draggingPos, setDraggingPos] = useState(null); // { id, x, y } | null
  const handleDragLive = useCallback((id, x, y) => {
    if (id == null) setDraggingPos(null);
    else setDraggingPos({ id, x, y });
  }, []);

  // Layout-Modus: 'free' (Standard, frei positionierbar) oder 'grid' (Raster, Drag aus).
  const [layoutMode, setLayoutMode] = useState(() => {
    try {
      const v = localStorage.getItem('beequ:notes:layout');
      return v === 'grid' ? 'grid' : 'free';
    } catch { return 'free'; }
  });
  const isGrid = layoutMode === 'grid';
  const toggleLayoutMode = useCallback(() => {
    setLayoutMode((prev) => {
      const next = prev === 'grid' ? 'free' : 'grid';
      try { localStorage.setItem('beequ:notes:layout', next); } catch {}
      return next;
    });
  }, []);

  // Mindmap-Verbindungs-Workflow:
  //   connectMode true → naechster Klick wird zur Quelle, der danach zum Ziel.
  //   connectSourceId  → bereits ausgewaehlte Quelle (wartet auf zweiten Klick).
  const [connectMode, setConnectMode] = useState(false);
  const [connectSourceId, setConnectSourceId] = useState(null);

  const viewportRef = useRef(null);
  const boardRef = useRef(null);

  // interaction state refs (no re-render needed)
  const interactionRef = useRef({
    isPanning: false,
    isPinching: false,
    lastPointer: { x: 0, y: 0 },
    pinchDist: 0,
    pinchMid: { x: 0, y: 0 },
    pinchScale: 1,
    pinchPan: { x: 0, y: 0 },
  });

  // Hat der Nutzer manuell ge-pannt/-zoomt? Solange nein, zentrieren wir
  // bei Mount und bei Viewport-Resize automatisch.
  const userInteractedRef = useRef(false);
  // 'none' | 'empty' | 'with-notes' — beschreibt, für welchen Zustand
  // wir zuletzt zentriert haben.
  const initialCenteredRef = useRef('none');

  // exposed so StickyNote can read current scale without re-render
  const scaleRef = useRef(scale);
  const panRef = useRef(pan);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { panRef.current = pan; }, [pan]);

  // rAF-throttle fuer pan/pinch — verhindert Layout-Thrash bei 60fps Pointer-Events
  const rafPanRef = useRef(0);
  const pendingTransformRef = useRef(null);
  const wheelSyncRef = useRef(0);
  const scheduleTransform = useCallback(() => {
    if (rafPanRef.current) return;
    rafPanRef.current = requestAnimationFrame(() => {
      rafPanRef.current = 0;
      const t = pendingTransformRef.current;
      if (!t || !boardRef.current) return;
      boardRef.current.style.transform = `translate(${t.p.x}px,${t.p.y}px) scale(${t.s})`;
    });
  }, []);
  // Sync React-State mit aktuellem ref-Stand (nur am Interaktions-Ende aufrufen).
  const commitInteractionState = useCallback(() => {
    setScale(scaleRef.current);
    setPan(panRef.current);
  }, []);

  useEffect(() => {
    fetchNotes();
    fetchTasks();
    fetchConnections?.();
    if ('ontouchstart' in window && !localStorage.getItem('notes-mobile-hint-shown')) {
      setShowMobileHint(true);
      localStorage.setItem('notes-mobile-hint-shown', 'true');
      setTimeout(() => setShowMobileHint(false), 4000);
    }
  }, [fetchNotes, fetchTasks, fetchConnections]);

  // Auto-Refresh: wenn der Tab/Fenster wieder Fokus bekommt oder sichtbar
  // wird, Notes & Tasks neu laden. Loest "andere User schreibt Note, ich
  // sehe es nicht" ohne dedizierten Realtime-Channel.
  //
  // Zusaetzlich hoeren wir auf 'beequ:notes-changed' (vom useRealtime-Hook
  // via Supabase Broadcast + postgres_changes) — damit kommen Updates in
  // <1 Sekunde rein und das Polling-Intervall ist nur noch Safety-Net.
  // Wenn Realtime aktiv ist, koennen wir den Poll auf 60s entspannen.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      try { fetchNotes?.({ force: true }); } catch {}
      try { fetchConnections?.(); } catch {}
    };
    const onNotesChanged = () => {
      // Auch wenn Tab gerade nicht sichtbar ist: Store aktualisieren, damit
      // beim Re-Open sofort der frische Stand da ist.
      try { fetchNotes?.({ force: true }); } catch {}
      try { fetchConnections?.(); } catch {}
    };
    const onReconnect = () => refresh();

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('beequ:notes-changed', onNotesChanged);
    window.addEventListener('beequ:realtime-reconnected', onReconnect);

    // Sanftes Background-Polling waehrend Tab sichtbar. Bei aktivem
    // Realtime nur alle 60s (Safety-Net), sonst alle 30s.
    const pollMs = (typeof window !== 'undefined' && window.__beequRealtimeActive) ? 60000 : 30000;
    const pollId = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, pollMs);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('beequ:notes-changed', onNotesChanged);
      window.removeEventListener('beequ:realtime-reconnected', onReconnect);
      window.clearInterval(pollId);
    };
  }, [fetchNotes, fetchConnections]);

  // ── helpers ──────────────────────────────────────────────────────────────
  const clampPan = useCallback((x, y, s) => {
    if (!viewportRef.current) return { x, y };
    const vw = viewportRef.current.clientWidth;
    const vh = viewportRef.current.clientHeight;
    const maxX = 0;
    const minX = vw - BOARD_W * s;
    const maxY = 0;
    const minY = vh - BOARD_H * s;
    return {
      x: Math.min(maxX, Math.max(minX, x)),
      y: Math.min(maxY, Math.max(minY, y)),
    };
  }, []);

  const applyTransform = useCallback((s, p) => {
    if (boardRef.current) {
      boardRef.current.style.transform = `translate(${p.x}px,${p.y}px) scale(${s})`;
    }
  }, []);

  // ── zoom buttons ──────────────────────────────────────────────────────────
  const handleZoomIn = useCallback(() => {
    userInteractedRef.current = true;
    setScale(prev => {
      const next = Math.min(MAX_SCALE, parseFloat((prev + 0.2).toFixed(2)));
      const vp = viewportRef.current;
      if (!vp) return next;
      const cx = vp.clientWidth / 2;
      const cy = vp.clientHeight / 2;
      const p = panRef.current;
      const canvasX = (cx - p.x) / prev;
      const canvasY = (cy - p.y) / prev;
      const np = clampPan(cx - canvasX * next, cy - canvasY * next, next);
      setPan(np);
      applyTransform(next, np);
      return next;
    });
  }, [clampPan, applyTransform]);

  const handleZoomOut = useCallback(() => {
    userInteractedRef.current = true;
    setScale(prev => {
      const next = Math.max(MIN_SCALE, parseFloat((prev - 0.2).toFixed(2)));
      const vp = viewportRef.current;
      if (!vp) return next;
      const cx = vp.clientWidth / 2;
      const cy = vp.clientHeight / 2;
      const p = panRef.current;
      const canvasX = (cx - p.x) / prev;
      const canvasY = (cy - p.y) / prev;
      const np = clampPan(cx - canvasX * next, cy - canvasY * next, next);
      setPan(np);
      applyTransform(next, np);
      return next;
    });
  }, [clampPan, applyTransform]);

  // ── create note in visible center ─────────────────────────────────────────
  const handleCreateNote = useCallback(async () => {
    const randomColor = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];
    const vp = viewportRef.current;
    let x = 100 + Math.random() * 300;
    let y = 100 + Math.random() * 300;
    if (vp) {
      const s = scaleRef.current;
      const p = panRef.current;
      const vw = vp.clientWidth;
      const vh = vp.clientHeight;
      const visX = -p.x / s;
      const visY = -p.y / s;
      const visW = vw / s;
      const visH = vh / s;
      const noteW = 190, noteH = 190, margin = 24;
      x = visX + margin + Math.random() * Math.max(0, visW - noteW - margin * 2);
      y = visY + margin + Math.random() * Math.max(0, visH - noteH - margin * 2);
    }
    try {
      const created = await createNote({
        title: '',
        content: `[COLOR:${randomColor.name}] `,
        x: Math.round(x),
        y: Math.round(y),
      });
      // Direkt im Vollbild-Editor oeffnen (Erstellungs-Flow wie iOS Notes).
      if (created && created.id != null) {
        setEditorNoteId(created.id);
      }
    } catch (err) {
      console.error('[NotesPage] createNote failed:', err);
      try {
        useTaskStore.getState().addToast(
          err?.message || 'Notiz konnte nicht erstellt werden',
          'error',
        );
      } catch {}
    }
  }, [createNote]);

  const handleUpdateNote = useCallback(async (noteId, updates) => {
    try {
      await updateNote(noteId, updates);
    } catch (error) {
      console.error('Note update failed:', error);
      if (!('x' in updates || 'y' in updates)) {
        alert('Notiz-Update fehlgeschlagen. Versuche es später erneut.');
      }
      throw error;
    }
  }, [updateNote]);

  const handleDeleteNote = useCallback(async (noteId) => {
    if (window.confirm('Notiz wirklich löschen?')) {
      try {
        await deleteNote(noteId);
        setSelectedNoteIds(prev => prev.filter(id => id !== noteId));
      } catch (error) {
        console.error('Note deletion failed:', error);
        alert('Notiz löschen fehlgeschlagen. Versuche es später erneut.');
      }
    }
  }, [deleteNote]);

  const handleCompleteNote = useCallback(async (noteId) => {
    try {
      await completeNote(noteId);
      setSelectedNoteIds(prev => prev.filter(id => id !== noteId));
    } catch (error) {
      console.error('Note complete failed:', error);
    }
  }, [completeNote]);

  const handleRestoreArchived = useCallback(async (noteId) => {
    try { await restoreArchivedNote(noteId); }
    catch (error) { console.error('Restore failed:', error); }
  }, [restoreArchivedNote]);

  // Beim Öffnen des Archivs frisch laden
  useEffect(() => {
    if (showArchive) fetchArchivedNotes();
  }, [showArchive, fetchArchivedNotes]);

  const handlePositionChange = useCallback(async (noteId, x, y) => {
    try {
      await updateNote(noteId, { x, y });
    } catch (error) {
      console.error('Position update failed:', error);
    }
  }, [updateNote]);

  const handleSelectNote = useCallback((noteId) => {
    setSelectedNoteIds([noteId]);

    // Im Connect-Mode wird der erste Klick zur Quelle, der zweite
    // (auf eine andere Note) zum Ziel und legt eine Verbindung an.
    if (!connectMode) return;
    if (connectSourceId == null) {
      setConnectSourceId(noteId);
      return;
    }
    if (String(connectSourceId) === String(noteId)) {
      setConnectSourceId(null);
      return;
    }
    addConnection?.(connectSourceId, noteId).catch((err) => {
      console.error('[NotesPage] addConnection failed:', err?.message || err);
    });
    setConnectSourceId(null);
  }, [connectMode, connectSourceId, addConnection]);

  const handleToggleConnectMode = useCallback(() => {
    setConnectMode((prev) => {
      if (prev) setConnectSourceId(null);
      return !prev;
    });
  }, []);

  const handleRemoveConnection = useCallback((conn) => {
    if (!conn) return;
    setSelectedConnectionId(null);
    removeConnection?.(conn).catch((err) => {
      console.error('[NotesPage] removeConnection failed:', err?.message || err);
    });
  }, [removeConnection]);

  // Index Note-ID -> Note fuer schnelle Position-Lookups beim Linien-Render.
  const notesById = useMemo(() => {
    const map = new Map();
    notes.forEach((n) => {
      if (n && n.id != null) map.set(String(n.id), n);
    });
    return map;
  }, [notes]);

  // Grid-Positionen berechnen (nur wenn layoutMode === 'grid').
  // Notizen werden stabil nach id sortiert und in einem Raster ausgerichtet.
  // Position-Updates werden NICHT in die DB geschrieben — wenn der User
  // zurück auf 'free' wechselt, stehen die Notes wieder an ihren x/y-Werten.
  const NOTE_CELL = 220;
  const GRID_PAD = 60;
  const gridPositions = useMemo(() => {
    if (!isGrid) return null;
    const vp = viewportRef.current;
    const cols = Math.max(2, Math.floor(((vp?.clientWidth || 1200) - GRID_PAD * 2) / NOTE_CELL)) || 4;
    const sorted = [...notes].filter((n) => n && n.id != null).sort((a, b) => Number(a.id) - Number(b.id));
    const map = new Map();
    sorted.forEach((n, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      map.set(String(n.id), { x: GRID_PAD + col * NOTE_CELL, y: GRID_PAD + row * NOTE_CELL });
    });
    return map;
  }, [isGrid, notes]);

  // Connections fuer Render aufbereiten (nur Linien, deren beide Notes
  // aktuell sichtbar sind — geteilte Verbindungen mit fehlender Note ueberspringen).
  const renderableConnections = useMemo(() => {
    const NOTE_HALF = 95; // Note ist ~190px breit -> Mittelpunkt-Offset
    const posOf = (n) => {
      // Live-Position waehrend Drag hat Vorrang → Linie folgt smooth.
      if (draggingPos && String(draggingPos.id) === String(n.id)) {
        return { x: draggingPos.x, y: draggingPos.y };
      }
      if (gridPositions) {
        const g = gridPositions.get(String(n.id));
        if (g) return { x: g.x, y: g.y };
      }
      return { x: n.x || 100, y: n.y || 100 };
    };
    return (connections || [])
      .map((c) => {
        const a = notesById.get(String(c.note_id_1));
        const b = notesById.get(String(c.note_id_2));
        if (!a || !b) return null;
        const pa = posOf(a);
        const pb = posOf(b);
        const x1 = pa.x + NOTE_HALF;
        const y1 = pa.y + NOTE_HALF;
        const x2 = pb.x + NOTE_HALF;
        const y2 = pb.y + NOTE_HALF;
        // Quadratische Bezier-Kurve fuer eleganten Schwung. Kontrollpunkt
        // senkrecht zur Verbindungsachse, Offset proportional zur Distanz.
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.hypot(dx, dy) || 1;
        const curve = Math.min(60, dist * 0.18);
        const cx = (x1 + x2) / 2 + (-dy / dist) * curve;
        const cy = (y1 + y2) / 2 + (dx / dist) * curve;
        return {
          id: c.id,
          note_id_1: c.note_id_1,
          note_id_2: c.note_id_2,
          x1, y1, x2, y2, cx, cy,
          d: `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`,
        };
      })
      .filter(Boolean);
  }, [connections, notesById, gridPositions, draggingPos]);

  // ── "fit all" button ──────────────────────────────────────────────────────
  const handleFitAll = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || notes.length === 0) return;
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    const pad = 48;
    const minX = Math.min(...notes.map(n => n.x ?? 0));
    const minY = Math.min(...notes.map(n => n.y ?? 0));
    const maxX = Math.max(...notes.map(n => (n.x ?? 0) + 190));
    const maxY = Math.max(...notes.map(n => (n.y ?? 0) + 190));
    const cw = maxX - minX + pad * 2;
    const ch = maxY - minY + pad * 2;
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(vw / cw, vh / ch)));
    const np = clampPan((vw - cw * s) / 2 - (minX - pad) * s, (vh - ch * s) / 2 - (minY - pad) * s, s);
    setScale(s);
    setPan(np);
    applyTransform(s, np);
    userInteractedRef.current = false; // expliziter Klick = wieder „auto-center"
  }, [notes, clampPan, applyTransform]);

  // ── Auto-zentrieren: Notizen sollen auf jedem Bildschirm sichtbar sein ────
  const centerView = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    if (vw === 0 || vh === 0) return;

    // Im Grid-Modus zentrieren wir auf die Grid-Positionen, nicht auf note.x/y.
    const posOf = (n) => {
      if (gridPositions) {
        const g = gridPositions.get(String(n.id));
        if (g) return { x: g.x, y: g.y };
      }
      return { x: n.x ?? 0, y: n.y ?? 0 };
    };

    if (notes.length > 0) {
      const pad = 64;
      const positions = notes.map(posOf);
      const minX = Math.min(...positions.map(p => p.x));
      const minY = Math.min(...positions.map(p => p.y));
      const maxX = Math.max(...positions.map(p => p.x + 190));
      const maxY = Math.max(...positions.map(p => p.y + 190));
      const cw = maxX - minX + pad * 2;
      const ch = maxY - minY + pad * 2;
      // Auf Mobile/Tablet: nicht über 1.0 hochskalieren (sonst zu groß), auf Desktop genauso.
      const s = Math.min(1, Math.max(MIN_SCALE, Math.min(vw / cw, vh / ch)));
      const px = (vw - cw * s) / 2 - (minX - pad) * s;
      const py = (vh - ch * s) / 2 - (minY - pad) * s;
      const np = clampPan(px, py, s);
      setScale(s);
      setPan(np);
      applyTransform(s, np);
    } else {
      // Leere Pinnwand: Mitte des Canvas in die Viewport-Mitte legen
      const s = 1;
      const np = clampPan(vw / 2 - (BOARD_W / 2) * s, vh / 2 - (BOARD_H / 2) * s, s);
      setScale(s);
      setPan(np);
      applyTransform(s, np);
    }
  }, [notes, clampPan, applyTransform, gridPositions]);

  // Auto-Zentrierung:
  //  • beim allerersten Mount, sobald Viewport gemessen ist (useLayoutEffect
  //    läuft synchron vor dem Paint → kein Aufblitzen von oben-links)
  //  • erneut, wenn aus 0 Notizen → ≥1 wird (also nach fetchNotes)
  //  • nicht mehr nach manueller Interaktion (Pan/Zoom/Pinch)
  useLayoutEffect(() => {
    if (userInteractedRef.current) return;
    const vp = viewportRef.current;
    if (!vp || vp.clientWidth === 0 || vp.clientHeight === 0) return;

    const newState = notes.length > 0 ? 'with-notes' : 'empty';
    if (initialCenteredRef.current === newState) return;

    centerView();
    initialCenteredRef.current = newState;
  }, [notes.length, centerView]);

  // Re-center beim Wechsel des Layout-Modus (Grid <-> Frei)
  useEffect(() => {
    if (!viewportRef.current) return;
    // Erlaubt expliziten Re-Center auch nach Interaktion (User hat Toggle geklickt)
    userInteractedRef.current = false;
    initialCenteredRef.current = 'none';
    // setTimeout, damit der Render mit neuen Positionen abgeschlossen ist
    const t = setTimeout(() => centerView(), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutMode]);

  // Resize/Orientation + ResizeObserver auf dem Viewport (fängt auch Layout-
  // Wechsel ein, die kein window.resize feuern — z. B. Sidebar-Collapse).
  // Solange der User noch nicht selbst gepant/gezoomt hat, wird neu zentriert.
  useEffect(() => {
    const onResize = () => {
      if (userInteractedRef.current) return;
      centerView();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    let ro = null;
    const vp = viewportRef.current;
    if (vp && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(onResize);
      ro.observe(vp);
    }

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      if (ro) ro.disconnect();
    };
  }, [centerView]);

  // ── viewport touch/pointer handlers ──────────────────────────────────────
  const onViewportPointerDown = useCallback((e) => {
    // only pan on direct board clicks (not on notes or buttons)
    const target = e.target;
    if (
      target.closest('.sticky-note') ||
      target.closest('.board-controls') ||
      target.closest('.notes-board-header') ||
      target.closest('.empty-board-content') ||
      target.closest('button, a, input, textarea, select, label, [role="button"]')
    ) return;
    if (e.touches) return; // handled by touch events
    interactionRef.current.isPanning = true;
    interactionRef.current.lastPointer = { x: e.clientX, y: e.clientY };
    userInteractedRef.current = true;
    viewportRef.current?.setPointerCapture?.(e.pointerId);
  }, []);

  const onViewportPointerMove = useCallback((e) => {
    if (!interactionRef.current.isPanning) return;
    const dx = e.clientX - interactionRef.current.lastPointer.x;
    const dy = e.clientY - interactionRef.current.lastPointer.y;
    interactionRef.current.lastPointer = { x: e.clientX, y: e.clientY };
    const np = clampPan(panRef.current.x + dx, panRef.current.y + dy, scaleRef.current);
    panRef.current = np;
    pendingTransformRef.current = { s: scaleRef.current, p: np };
    scheduleTransform();
  }, [clampPan, scheduleTransform]);

  const onViewportPointerUp = useCallback(() => {
    if (!interactionRef.current.isPanning) return;
    interactionRef.current.isPanning = false;
    if (rafPanRef.current) {
      cancelAnimationFrame(rafPanRef.current);
      rafPanRef.current = 0;
      if (pendingTransformRef.current && boardRef.current) {
        const t = pendingTransformRef.current;
        boardRef.current.style.transform = `translate(${t.p.x}px,${t.p.y}px) scale(${t.s})`;
      }
    }
    commitInteractionState();
  }, [commitInteractionState]);

  // ── touch events (pan + pinch) ────────────────────────────────────────────
  const onTouchStart = useCallback((e) => {
    const ir = interactionRef.current;
    if (e.touches.length === 2) {
      ir.isPinching = true;
      ir.isPanning = false;
      const t1 = e.touches[0], t2 = e.touches[1];
      ir.pinchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      ir.pinchMid = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
      ir.pinchScale = scaleRef.current;
      ir.pinchPan = { ...panRef.current };
      userInteractedRef.current = true;
      e.preventDefault();
    } else if (e.touches.length === 1) {
      const target = e.touches[0].target;
      if (
        target.closest('.sticky-note') ||
        target.closest('.board-controls') ||
        target.closest('.notes-board-header') ||
        target.closest('.empty-board-content') ||
        target.closest('button, a, input, textarea, select, label, [role="button"]')
      ) return;
      ir.isPanning = true;
      ir.lastPointer = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      userInteractedRef.current = true;
    }
  }, []);

  const onTouchMove = useCallback((e) => {
    const ir = interactionRef.current;
    if (ir.isPinching && e.touches.length === 2) {
      e.preventDefault();
      const t1 = e.touches[0], t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const mid = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
      const ratio = dist / ir.pinchDist;
      const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, ir.pinchScale * ratio));
      // focal-point pan: keep pinch midpoint fixed in canvas space
      const canvasX = (ir.pinchMid.x - ir.pinchPan.x) / ir.pinchScale;
      const canvasY = (ir.pinchMid.y - ir.pinchPan.y) / ir.pinchScale;
      const panDx = mid.x - ir.pinchMid.x;
      const panDy = mid.y - ir.pinchMid.y;
      const np = clampPan(mid.x - canvasX * ns + panDx, mid.y - canvasY * ns + panDy, ns);
      scaleRef.current = ns;
      panRef.current = np;
      pendingTransformRef.current = { s: ns, p: np };
      scheduleTransform();
    } else if (ir.isPanning && e.touches.length === 1) {
      e.preventDefault();
      const dx = e.touches[0].clientX - ir.lastPointer.x;
      const dy = e.touches[0].clientY - ir.lastPointer.y;
      ir.lastPointer = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      const np = clampPan(panRef.current.x + dx, panRef.current.y + dy, scaleRef.current);
      panRef.current = np;
      pendingTransformRef.current = { s: scaleRef.current, p: np };
      scheduleTransform();
    }
  }, [clampPan, scheduleTransform]);

  const onTouchEnd = useCallback((e) => {
    const ir = interactionRef.current;
    const wasInteracting = ir.isPinching || ir.isPanning;
    if (e.touches.length < 2) ir.isPinching = false;
    if (e.touches.length === 0) ir.isPanning = false;
    if (wasInteracting && e.touches.length === 0) {
      if (rafPanRef.current) {
        cancelAnimationFrame(rafPanRef.current);
        rafPanRef.current = 0;
        if (pendingTransformRef.current && boardRef.current) {
          const t = pendingTransformRef.current;
          boardRef.current.style.transform = `translate(${t.p.x}px,${t.p.y}px) scale(${t.s})`;
        }
      }
      commitInteractionState();
    }
  }, [commitInteractionState]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    vp.addEventListener('touchstart', onTouchStart, { passive: false });
    vp.addEventListener('touchmove', onTouchMove, { passive: false });
    vp.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      vp.removeEventListener('touchstart', onTouchStart);
      vp.removeEventListener('touchmove', onTouchMove);
      vp.removeEventListener('touchend', onTouchEnd);
    };
  }, [onTouchStart, onTouchMove, onTouchEnd]);

  // ── Desktop-Mausrad: nur Pan, kein Zoom ────────────────────────────────────
  //   plain wheel      → vertikal pannen
  //   shift + wheel    → horizontal pannen
  //   Zoom passiert ausschliesslich ueber die +/- Buttons in der Toolbar.
  const onWheel = useCallback((e) => {
    const target = e.target;
    if (
      target.closest?.('.sticky-note') ||
      target.closest?.('.board-controls') ||
      target.closest?.('.notes-board-header')
    ) return;

    e.preventDefault();
    userInteractedRef.current = true;

    const dx = e.shiftKey ? -e.deltaY : -e.deltaX;
    const dy = e.shiftKey ? 0 : -e.deltaY;
    if (dx === 0 && dy === 0) return;
    const np = clampPan(panRef.current.x + dx, panRef.current.y + dy, scaleRef.current);
    panRef.current = np;
    pendingTransformRef.current = { s: scaleRef.current, p: np };
    scheduleTransform();
    // Defer state sync to idle — Wheel-Events können sehr dicht kommen
    if (wheelSyncRef.current) clearTimeout(wheelSyncRef.current);
    wheelSyncRef.current = setTimeout(() => {
      wheelSyncRef.current = 0;
      commitInteractionState();
    }, 120);
  }, [clampPan, scheduleTransform, commitInteractionState]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  if (detailTask) {
    return <TaskDetailModal task={detailTask} onClose={closeTask} />;
  }

  return (
    <div className={`notes-board-container ${connectMode ? 'connect-mode' : ''}`}>
      <div className="notes-board-header">
        <div className="board-title">
          <h1>
            <LayoutGrid className="board-title-icon" size={18} aria-hidden="true" />
            <span>Notizen Board</span>
          </h1>
          <span className="notes-count">{notes.length} Notizen</span>
        </div>

        <div className="board-controls">
          <button className="board-control-btn" onClick={handleZoomOut} disabled={scale <= MIN_SCALE} title="Verkleinern">
            <ZoomOut size={16} />
          </button>
          <span className="zoom-indicator">{Math.round(scale * 100)}%</span>
          <button className="board-control-btn" onClick={handleZoomIn} disabled={scale >= MAX_SCALE} title="Vergrößern">
            <ZoomIn size={16} />
          </button>
          {notes.length > 0 && (
            <button className="board-control-btn" onClick={handleFitAll} title="Alle Notizen anzeigen">
              <ZoomOut size={14} /><ZoomIn size={14} />
            </button>
          )}
          <button
            className={`board-control-btn ${isGrid ? 'active' : ''}`}
            onClick={toggleLayoutMode}
            title={isGrid ? 'Freies Layout (Drag & Drop)' : 'Raster-Layout aktivieren'}
            aria-pressed={isGrid}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            className={`board-control-btn ${connectMode ? 'active' : ''}`}
            onClick={handleToggleConnectMode}
            title={connectMode
              ? (connectSourceId ? 'Zweite Notiz waehlen … (Klick zum Abbrechen)' : 'Verbindungs-Modus beenden')
              : 'Notizen verbinden (Mindmap)'}
            aria-pressed={connectMode}
          >
            <Link2 size={16} />
          </button>
          <button
            className="board-control-btn"
            onClick={() => setShowArchive(true)}
            title="Archiv (erledigte Notizen)"
          >
            <Archive size={16} />
          </button>
          <button className="board-control-btn primary large" onClick={handleCreateNote} title="Neue Notiz erstellen">
            <Plus size={18} />
            <span className="btn-label">Neue Notiz</span>
          </button>
        </div>
      </div>

      {/* Viewport: clips canvas, captures pointer/touch */}
      <div
        ref={viewportRef}
        className="notes-viewport"
        onPointerDown={onViewportPointerDown}
        onPointerMove={onViewportPointerMove}
        onPointerUp={onViewportPointerUp}
        onPointerCancel={onViewportPointerUp}
      >
        {/* Canvas: panned + scaled */}
        <div
          ref={boardRef}
          className={`notes-board ${isGrid ? 'layout-grid' : ''}`}
          style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${scale})` }}
          onClick={(e) => {
            if (e.target === boardRef.current || e.target.classList.contains('board-background') || e.target.classList.contains('cork-board-background')) {
              setSelectedNoteIds([]);
              setSelectedConnectionId(null);
            }
          }}
        >
          <div className="board-background" />
          <div className="cork-board-background" />

          {/* Mindmap-Verbindungslinien zwischen Notes.
              Liegt VOR den Notes (untere z-Ebene), reagiert nur auf
              Klicks auf die Linie selbst (pointer-events: stroke). */}
          {renderableConnections.length > 0 && (
            <svg
              className="notes-connections-layer"
              width={BOARD_W}
              height={BOARD_H}
              viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
            >
              {renderableConnections.map((c) => {
                const isSel = String(selectedConnectionId) === String(c.id);
                const onLineClick = (e) => {
                  e.stopPropagation();
                  setSelectedConnectionId((prev) => (String(prev) === String(c.id) ? prev : c.id));
                };
                return (
                  <g key={c.id} className={`connection-group${isSel ? ' is-selected' : ''}`}>
                    {/* Unsichtbare breite Hitbox fuer Touch/Klick */}
                    <path
                      className="connection-hitbox"
                      d={c.d}
                      onClick={onLineClick}
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                    {/* Weicher Glow-Hintergrund */}
                    <path
                      className="connection-glow"
                      d={c.d}
                    />
                    {/* Sichtbare Linie */}
                    <path
                      className="connection-line"
                      d={c.d}
                      onClick={onLineClick}
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                    {/* Loesch-Button erscheint nur bei Selektion */}
                    {isSel && (
                      <g
                        className="connection-delete-btn"
                        transform={`translate(${c.cx} ${c.cy})`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveConnection(c);
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <circle r="14" />
                        <line x1="-5" y1="-5" x2="5" y2="5" />
                        <line x1="-5" y1="5" x2="5" y2="-5" />
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          )}

          {notes.filter(note => note != null && note.id != null && (!note.is_foreign || note.shared_permission === 'edit' || note.permission === 'edit')).map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              onUpdate={handleUpdateNote}
              onDelete={handleDeleteNote}
              onComplete={handleCompleteNote}
              onPositionChange={handlePositionChange}
              isSelected={selectedNoteIds.includes(note.id)}
              onSelect={handleSelectNote}
              tasks={tasks}
              onOpenTask={openTask}
              boardScaleRef={scaleRef}
              gridPos={gridPositions ? gridPositions.get(String(note.id)) : null}
              dragDisabled={isGrid}
              onDragLive={handleDragLive}
              onOpenEditor={setEditorNoteId}
            />
          ))}

          {notes.length === 0 && (
            <div className="empty-board">
              <div className="empty-board-content">
                <Pin size={48} />
                <h2>Keine Notizen vorhanden</h2>
                <p>Klicke auf "Neue Notiz" um deine erste Notiz zu erstellen!</p>
                <button className="board-control-btn primary large" onClick={handleCreateNote}>
                  <Plus size={18} />
                  Erste Notiz erstellen
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showMobileHint && (
        <div className="mobile-hint">
          💡 Mit einem Finger verschieben · Zwei Finger zum Zoomen
        </div>
      )}

      {connectMode && (
        <div className="connect-mode-hint" role="status">
          <Link2 size={14} />
          <span>
            {connectSourceId
              ? 'Zweite Notiz waehlen, um Verbindung zu erstellen.'
              : 'Erste Notiz waehlen.'}
          </span>
          <button
            type="button"
            className="connect-mode-hint-close"
            onClick={handleToggleConnectMode}
            aria-label="Verbindungs-Modus beenden"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {showArchive && createPortal(
        <div
          className="notes-archive-overlay"
          onPointerDown={(e) => { if (e.target === e.currentTarget) setShowArchive(false); }}
          role="dialog"
          aria-modal="true"
          aria-label="Notizen-Archiv"
        >
          <div className="notes-archive-modal" onPointerDown={(e) => e.stopPropagation()}>
            <div className="notes-archive-handle" aria-hidden="true" />
            <div className="notes-archive-header">
              <div className="notes-archive-title-wrap">
                <Archive size={18} />
                <h3>Archiv</h3>
                <span className="notes-archive-count">{archivedNotes.length}</span>
              </div>
              <button
                className="close-btn"
                onClick={() => setShowArchive(false)}
                aria-label="Schließen"
              >
                <X size={18} />
              </button>
            </div>

            <div className="notes-archive-body">
              {archivedLoading && archivedNotes.length === 0 ? (
                <div className="notes-archive-empty">
                  <p>Wird geladen…</p>
                </div>
              ) : archivedNotes.length === 0 ? (
                <div className="notes-archive-empty">
                  <Archive size={36} />
                  <p>Keine erledigten Notizen</p>
                  <small>Erledigte Notizen landen hier — du kannst sie wiederherstellen oder endgültig löschen.</small>
                </div>
              ) : (
                <ul className="notes-archive-list">
                  {archivedNotes.map((note) => {
                    const colorMatch = (note.content || '').match(/^\[COLOR:([^\]]+)\]/);
                    const colorName = colorMatch ? colorMatch[1] : 'Gelb';
                    const color = NOTE_COLORS.find((c) => c.name === colorName) || NOTE_COLORS[0];
                    const text = (note.content || '').replace(/^\[COLOR:[^\]]+\]\s*/, '').trim() || '(leer)';
                    const completedAt = note.completed_at
                      ? new Date(note.completed_at).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })
                      : '';
                    return (
                      <li key={note.id} className="notes-archive-item" style={{ borderLeftColor: color.border }}>
                        <div className="notes-archive-item-swatch" style={{ background: color.bg }} aria-hidden="true" />
                        <div className="notes-archive-item-body">
                          <p className="notes-archive-item-text" title={text}>{text}</p>
                          {completedAt && <span className="notes-archive-item-meta">Erledigt am {completedAt}</span>}
                        </div>
                        <div className="notes-archive-item-actions">
                          <button
                            type="button"
                            className="notes-archive-btn restore"
                            onClick={() => handleRestoreArchived(note.id)}
                            title="Wiederherstellen"
                          >
                            <RotateCcw size={14} />
                            <span>Wiederherstellen</span>
                          </button>
                          <button
                            type="button"
                            className="notes-archive-btn danger"
                            onClick={() => {
                              if (window.confirm('Notiz endgültig löschen?')) handleDeleteNote(note.id);
                            }}
                            title="Endgültig löschen"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Vollbild-Editor („Notizblatt") — wird per Doppelklick oder Maximize-Button geoeffnet */}
      {editorNoteId != null && (() => {
        const editorNote = notes.find((n) => n && n.id === editorNoteId);
        if (!editorNote) return null;
        return (
          <NoteEditorModal
            note={editorNote}
            onClose={() => setEditorNoteId(null)}
            onUpdate={handleUpdateNote}
            onDelete={handleDeleteNote}
            onComplete={handleCompleteNote}
          />
        );
      })()}
    </div>
  );
}