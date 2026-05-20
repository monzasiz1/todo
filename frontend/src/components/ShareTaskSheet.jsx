import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  Share2,
  Copy,
  Check,
  Mail,
  MessageCircle,
  Send,
  CalendarPlus,
  Link as LinkIcon,
  CalendarDays,
  Clock,
  MapPin,
  AlignLeft,
  Flag,
} from 'lucide-react';

// Hilfen
const PRIO_LABEL = { low: 'Niedrig', medium: 'Mittel', high: 'Hoch', urgent: 'Dringend' };
const PRIO_COLOR = { low: '#34C759', medium: '#007AFF', high: '#FF9F0A', urgent: '#FF3B30' };

function pad(n) { return String(n).padStart(2, '0'); }

function toIcsDate(dateStr, timeStr, fallbackHHMM) {
  if (!dateStr) return null;
  const d = parseISO(String(dateStr).slice(0, 10));
  if (Number.isNaN(d.getTime())) return null;
  const hhmm = (timeStr || fallbackHHMM || '09:00').slice(0, 5).split(':');
  const hh = pad(Math.min(23, Number(hhmm[0]) || 0));
  const mm = pad(Math.min(59, Number(hhmm[1]) || 0));
  // Lokales Datum als floating time (kein Z) - viele Kalender-Apps respektieren das
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${hh}${mm}00`;
}

function buildIcs(task) {
  const uid = `task-${task.id || Date.now()}@beequ`;
  const dtStart = toIcsDate(task.date, task.time, '09:00');
  const dtEnd = toIcsDate(task.date_end || task.date, task.time_end, task.time ? null : '10:00')
              || (dtStart ? dtStart.replace(/T(\d{2})(\d{2})00$/, (m, h, mi) => `T${pad((Number(h)+1)%24)}${mi}00`) : null);
  const dtStamp = (() => {
    const n = new Date();
    return `${n.getUTCFullYear()}${pad(n.getUTCMonth()+1)}${pad(n.getUTCDate())}T${pad(n.getUTCHours())}${pad(n.getUTCMinutes())}${pad(n.getUTCSeconds())}Z`;
  })();
  const esc = (s) => String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BeeQu//Task Share//DE',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
  ];
  if (dtStart) lines.push(`DTSTART:${dtStart}`);
  if (dtEnd) lines.push(`DTEND:${dtEnd}`);
  lines.push(`SUMMARY:${esc(task.title || 'Aufgabe')}`);
  if (task.description) lines.push(`DESCRIPTION:${esc(task.description)}`);
  if (task.location) lines.push(`LOCATION:${esc(task.location)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

function buildShareText(task) {
  const parts = [];
  parts.push(`📌 ${task.title || 'Aufgabe'}`);
  if (task.date) {
    const d = parseISO(String(task.date).slice(0, 10));
    if (!Number.isNaN(d.getTime())) {
      const dateStr = format(d, 'EEEE, d. MMMM yyyy', { locale: de });
      parts.push(`📅 ${dateStr}`);
    }
  }
  if (task.time) {
    const tEnd = task.time_end ? ` – ${String(task.time_end).slice(0, 5)}` : '';
    parts.push(`🕒 ${String(task.time).slice(0, 5)}${tEnd} Uhr`);
  }
  if (task.location) parts.push(`📍 ${task.location}`);
  if (task.priority && task.priority !== 'medium') parts.push(`⚡ Priorität: ${PRIO_LABEL[task.priority] || task.priority}`);
  if (task.description) parts.push(`\n${task.description}`);
  parts.push('\n— geteilt via BeeQu');
  return parts.join('\n');
}

export default function ShareTaskSheet({ task, open, onClose }) {
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  // Swipe-down-to-close
  const sheetRef = useRef(null);
  const dragRef = useRef({ active: false, startY: 0, lastY: 0 });
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  const handleTouchStart = (e) => {
    // Nur starten, wenn am oberen Rand gescrollt
    const el = sheetRef.current;
    if (!el) return;
    if (el.scrollTop > 0) return;
    const t = e.touches?.[0];
    if (!t) return;
    dragRef.current = { active: true, startY: t.clientY, lastY: t.clientY };
  };
  const handleTouchMove = (e) => {
    if (!dragRef.current.active) return;
    const t = e.touches?.[0];
    if (!t) return;
    const dy = t.clientY - dragRef.current.startY;
    if (dy <= 0) {
      // Wenn nach oben gezogen wird, drag abbrechen (normales Scrollen)
      if (dragY !== 0) setDragY(0);
      if (dragging) setDragging(false);
      return;
    }
    if (!dragging) setDragging(true);
    // leichte Dämpfung
    const damped = dy < 240 ? dy : 240 + (dy - 240) * 0.35;
    dragRef.current.lastY = t.clientY;
    setDragY(damped);
  };
  const handleTouchEnd = () => {
    if (!dragRef.current.active) return;
    const total = dragRef.current.lastY - dragRef.current.startY;
    dragRef.current.active = false;
    setDragging(false);
    if (total > 120) {
      onClose?.();
      // Reset für nächstes Öffnen
      setTimeout(() => setDragY(0), 240);
    } else {
      setDragY(0);
    }
  };

  useEffect(() => {
    if (!open) {
      setDragY(0);
      setDragging(false);
      dragRef.current.active = false;
    }
  }, [open]);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  useEffect(() => {
    if (!open) { setCopied(false); setLinkCopied(false); }
  }, [open]);

  // Escape schliesst Sheet
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const shareText = useMemo(() => (task ? buildShareText(task) : ''), [task]);
  const subject = useMemo(() => (task?.title ? `Aufgabe: ${task.title}` : 'Aufgabe geteilt'), [task]);
  const shareLink = useMemo(() => {
    if (!task?.id) return '';
    // Origin bevorzugt aus dem aktuellen Browser-Kontext. Fallback aus ENV,
    // damit kein hardcoded Domain in der Bundle steht (z. B. wenn die App
    // unter einem Custom-Domain laeuft).
    const envOrigin = (typeof import.meta !== 'undefined' && import.meta?.env?.VITE_APP_URL) || '';
    try {
      const origin = typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : (envOrigin || 'https://beequ.app');
      return `${origin}/app/tasks/${task.id}`;
    } catch (_) {
      return `${envOrigin || 'https://beequ.app'}/app/tasks/${task.id}`;
    }
  }, [task]);

  if (!task) return null;

  const dateLine = (() => {
    if (!task.date) return null;
    const d = parseISO(String(task.date).slice(0, 10));
    if (Number.isNaN(d.getTime())) return null;
    return format(d, 'EEEE, d. MMMM yyyy', { locale: de });
  })();
  const timeLine = task.time
    ? `${String(task.time).slice(0, 5)}${task.time_end ? ` – ${String(task.time_end).slice(0, 5)}` : ''} Uhr`
    : null;

  const doCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText);
      } else {
        const ta = document.createElement('textarea');
        ta.value = shareText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (_) { /* noop */ }
  };

  const doCopyLink = async () => {
    if (!shareLink) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareLink);
      } else {
        const ta = document.createElement('textarea');
        ta.value = shareLink;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1600);
    } catch (_) { /* noop */ }
  };

  const doNativeShare = async () => {
    try {
      await navigator.share({ title: task.title || 'Aufgabe', text: shareText, url: shareLink || undefined });
    } catch (_) { /* user cancelled */ }
  };

  const openExternal = (url) => {
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (_) { /* noop */ }
  };

  const waText = shareLink ? `${shareText}\n\n${shareLink}` : shareText;
  const doWhatsApp = () => openExternal(`https://wa.me/?text=${encodeURIComponent(waText)}`);
  const doTelegram = () => openExternal(`https://t.me/share/url?url=${encodeURIComponent(shareLink || 'https://beequ.app')}&text=${encodeURIComponent(shareText)}`);
  const doMail = () => {
    const body = shareLink ? `${shareText}\n\n${shareLink}` : shareText;
    const href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
  };

  const doIcs = () => {
    try {
      const ics = buildIcs(task);
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(task.title || 'aufgabe').replace(/[^a-z0-9_\- ]/gi, '_')}.ics`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (_) { /* noop */ }
  };

  const actions = [
    canNativeShare && { key: 'native', icon: Share2, label: 'Teilen…', hint: 'System-Menü', tone: 'primary', onClick: doNativeShare },
    { key: 'whatsapp', icon: MessageCircle, label: 'WhatsApp', hint: 'Chat öffnen', tone: 'whatsapp', onClick: doWhatsApp },
    { key: 'telegram', icon: Send, label: 'Telegram', hint: 'Chat öffnen', tone: 'telegram', onClick: doTelegram },
    { key: 'mail', icon: Mail, label: 'E-Mail', hint: 'Als E-Mail senden', tone: 'mail', onClick: doMail },
    { key: 'ics', icon: CalendarPlus, label: 'Kalender', hint: '.ics herunterladen', tone: 'calendar', onClick: doIcs },
    shareLink && { key: 'link', icon: linkCopied ? Check : LinkIcon, label: linkCopied ? 'Link kopiert!' : 'Link kopieren', hint: 'Direkt-Link', tone: linkCopied ? 'success' : 'link', onClick: doCopyLink },
    { key: 'copy', icon: copied ? Check : Copy, label: copied ? 'Kopiert!' : 'Text kopieren', hint: 'In Zwischenablage', tone: copied ? 'success' : 'neutral', onClick: doCopy },
  ].filter(Boolean);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-overlay share-sheet-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          <motion.div
            ref={sheetRef}
            className="share-sheet"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: dragY }}
            exit={{ opacity: 0, y: '100%' }}
            transition={dragging
              ? { duration: 0 }
              : { type: 'spring', damping: 30, stiffness: 320, mass: 0.8 }
            }
            onClick={(e) => e.stopPropagation()}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
            role="dialog"
            aria-modal="true"
            aria-label="Aufgabe teilen"
          >
            <div className="share-sheet-handle" aria-hidden="true" />

            <div className="share-sheet-head">
              <div className="share-sheet-head-left">
                <span className="share-sheet-head-icon"><Share2 size={18} /></span>
                <div>
                  <div className="share-sheet-title">Teilen</div>
                  <div className="share-sheet-subtitle">Wähle, wie du die Aufgabe versendest</div>
                </div>
              </div>
            </div>

            {/* Preview Card */}
            <div className="share-preview">
              <div
                className="share-preview-strip"
                style={{ background: PRIO_COLOR[task.priority] || PRIO_COLOR.medium }}
                aria-hidden="true"
              />
              <div className="share-preview-body">
                <div className="share-preview-title">{task.title || 'Aufgabe'}</div>
                <div className="share-preview-meta">
                  {dateLine && (
                    <span className="share-preview-chip">
                      <CalendarDays size={13} /> {dateLine}
                    </span>
                  )}
                  {timeLine && (
                    <span className="share-preview-chip">
                      <Clock size={13} /> {timeLine}
                    </span>
                  )}
                  {task.location && (
                    <span className="share-preview-chip">
                      <MapPin size={13} /> {task.location}
                    </span>
                  )}
                  {task.priority && task.priority !== 'medium' && (
                    <span className="share-preview-chip" style={{ color: PRIO_COLOR[task.priority] }}>
                      <Flag size={13} /> {PRIO_LABEL[task.priority]}
                    </span>
                  )}
                  {task.category_name && (
                    <span
                      className="share-preview-chip"
                      style={{
                        background: task.category_color ? `${task.category_color}1f` : undefined,
                        color: task.category_color || undefined,
                      }}
                    >
                      {task.category_name}
                    </span>
                  )}
                </div>
                {task.description && (
                  <div className="share-preview-desc">
                    <AlignLeft size={13} />
                    <span>{task.description.length > 180 ? `${task.description.slice(0, 180)}…` : task.description}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Actions Grid */}
            <div className="share-actions-grid">
              {actions.map(({ key, icon: Icon, label, hint, tone, onClick }) => (
                <button
                  key={key}
                  type="button"
                  className={`share-action share-action-${tone}`}
                  onClick={onClick}
                >
                  <span className="share-action-icon"><Icon size={22} /></span>
                  <span className="share-action-label">{label}</span>
                  <span className="share-action-hint">{hint}</span>
                </button>
              ))}
            </div>

            <button type="button" className="share-sheet-cancel" onClick={onClose}>
              Abbrechen
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
