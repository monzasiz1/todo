import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download, X, FileJson, FileSpreadsheet, CalendarDays,
  Loader2, CheckCircle2, Database, Tag, User as UserIcon
} from 'lucide-react';
import { api } from '../utils/api';
import { useTaskStore } from '../store/taskStore';

// Modernes Modal zum Exportieren der Nutzerdaten.
// Format-Auswahl: JSON (alles), CSV (Aufgaben), ICS (Kalender).
// Zeigt vorab eine kurze Statistik (Anzahl Aufgaben/Kategorien) und laedt
// die Datei sauber im Browser herunter (Blob + Object URL).
export default function DataExportModal({ open, onClose }) {
  const [format, setFormat] = useState('json'); // 'json' | 'csv' | 'ics'
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null); // { tasks, categories, user }
  const [previewError, setPreviewError] = useState('');
  const [done, setDone] = useState(false);
  const addToast = useTaskStore((s) => s.addToast);

  // Beim Oeffnen einmalig die Daten laden, damit wir die Anzahl der Aufgaben/
  // Kategorien anzeigen koennen und der Download dann ohne weiteren Roundtrip
  // moeglich ist.
  useEffect(() => {
    if (!open) {
      setFormat('json');
      setLoading(false);
      setPreview(null);
      setPreviewError('');
      setDone(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setPreviewError('');
      try {
        const data = await api.exportProfile();
        if (!cancelled) setPreview(data);
      } catch (err) {
        if (!cancelled) setPreviewError(err?.message || 'Daten konnten nicht geladen werden.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const counts = useMemo(() => ({
    tasks: preview?.tasks?.length || 0,
    categories: preview?.categories?.length || 0,
  }), [preview]);

  const today = useMemo(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  const triggerDownload = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const toCsv = (tasks) => {
    const headers = ['title', 'description', 'date', 'date_end', 'time', 'time_end', 'priority', 'completed', 'category', 'created_at'];
    const escape = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n;]/.test(s) ? `"${s}"` : s;
    };
    const rows = (tasks || []).map((t) => headers.map((h) => escape(t[h])).join(','));
    return [headers.join(','), ...rows].join('\r\n');
  };

  const toIcs = (tasks) => {
    const pad = (n) => String(n).padStart(2, '0');
    const fmtDate = (date, time) => {
      // YYYYMMDD oder YYYYMMDDTHHMMSS
      if (!date) return null;
      const d = String(date).slice(0, 10).replace(/-/g, '');
      if (!time) return d;
      const t = String(time).slice(0, 8).replace(/:/g, '').padEnd(6, '0');
      return `${d}T${t}`;
    };
    const escapeIcs = (s) => String(s || '')
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
    const now = new Date();
    const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BeeQu//Export//DE', 'CALSCALE:GREGORIAN'];
    (tasks || []).forEach((t, i) => {
      if (!t.date) return;
      const start = fmtDate(t.date, t.time);
      const end = fmtDate(t.date_end || t.date, t.time_end || t.time);
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:beequ-${i}-${Date.now()}@beequ.de`);
      lines.push(`DTSTAMP:${stamp}`);
      if (t.time) {
        lines.push(`DTSTART:${start}`);
        if (end && end !== start) lines.push(`DTEND:${end}`);
      } else {
        lines.push(`DTSTART;VALUE=DATE:${start}`);
        if (end && end !== start) lines.push(`DTEND;VALUE=DATE:${end}`);
      }
      lines.push(`SUMMARY:${escapeIcs(t.title)}`);
      if (t.description) lines.push(`DESCRIPTION:${escapeIcs(t.description)}`);
      if (t.category) lines.push(`CATEGORIES:${escapeIcs(t.category)}`);
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  };

  const handleExport = () => {
    if (!preview) return;
    try {
      if (format === 'json') {
        const blob = new Blob([JSON.stringify(preview, null, 2)], { type: 'application/json' });
        triggerDownload(blob, `beequ-export-${today}.json`);
      } else if (format === 'csv') {
        const csv = toCsv(preview.tasks);
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        triggerDownload(blob, `beequ-aufgaben-${today}.csv`);
      } else if (format === 'ics') {
        const ics = toIcs(preview.tasks);
        const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8;' });
        triggerDownload(blob, `beequ-kalender-${today}.ics`);
      }
      setDone(true);
      addToast?.({ type: 'success', message: 'Export bereit – Download gestartet.' });
      setTimeout(() => setDone(false), 1800);
    } catch (err) {
      addToast?.({ type: 'error', message: err?.message || 'Export fehlgeschlagen.' });
    }
  };

  if (!open) return null;

  const formats = [
    {
      key: 'json',
      title: 'JSON (komplett)',
      sub: 'Alle Aufgaben, Kategorien und Profildaten',
      icon: <FileJson size={18} />,
      tint: '#5856D6',
    },
    {
      key: 'csv',
      title: 'CSV (Aufgaben)',
      sub: 'Tabelle für Excel, Numbers, Google Sheets',
      icon: <FileSpreadsheet size={18} />,
      tint: '#34C759',
    },
    {
      key: 'ics',
      title: 'ICS (Kalender)',
      sub: 'Termine für Apple, Google, Outlook',
      icon: <CalendarDays size={18} />,
      tint: '#00C7BE',
    },
  ];

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="data-export-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="data-export-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Daten exportieren"
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
        >
          <header className="data-export-head">
            <div className="data-export-head-icon"><Download size={18} /></div>
            <div className="data-export-head-text">
              <h3>Daten exportieren</h3>
              <p>Lade deine Aufgaben und Profildaten in deinem Wunschformat herunter.</p>
            </div>
            <button
              type="button"
              className="data-export-close"
              onClick={onClose}
              aria-label="Schließen"
            >
              <X size={18} />
            </button>
          </header>

          <div className="data-export-body">
            <div className="data-export-stats">
              <div className="data-export-stat">
                <div className="data-export-stat-icon" style={{ background: 'rgba(0,122,255,0.12)', color: '#007AFF' }}>
                  <Database size={16} />
                </div>
                <div>
                  <strong>{loading ? '…' : counts.tasks}</strong>
                  <span>Aufgaben</span>
                </div>
              </div>
              <div className="data-export-stat">
                <div className="data-export-stat-icon" style={{ background: 'rgba(255,149,0,0.12)', color: '#FF9500' }}>
                  <Tag size={16} />
                </div>
                <div>
                  <strong>{loading ? '…' : counts.categories}</strong>
                  <span>Kategorien</span>
                </div>
              </div>
              <div className="data-export-stat">
                <div className="data-export-stat-icon" style={{ background: 'rgba(88,86,214,0.12)', color: '#5856D6' }}>
                  <UserIcon size={16} />
                </div>
                <div>
                  <strong>1</strong>
                  <span>Profil</span>
                </div>
              </div>
            </div>

            {previewError && (
              <div className="data-export-error">{previewError}</div>
            )}

            <div className="data-export-format-label">Format waehlen</div>
            <div className="data-export-formats">
              {formats.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`data-export-format ${format === f.key ? 'is-active' : ''}`}
                  onClick={() => setFormat(f.key)}
                  aria-pressed={format === f.key}
                >
                  <span className="data-export-format-icon" style={{ background: `${f.tint}1A`, color: f.tint }}>
                    {f.icon}
                  </span>
                  <span className="data-export-format-text">
                    <strong>{f.title}</strong>
                    <span>{f.sub}</span>
                  </span>
                  <span className={`data-export-radio ${format === f.key ? 'is-on' : ''}`} aria-hidden="true" />
                </button>
              ))}
            </div>

            <p className="data-export-hint">
              Hinweis: CSV enthaelt nur Aufgaben, ICS nur Termine mit Datum. JSON ist vollstaendig und eignet sich fuer Backups.
            </p>
          </div>

          <footer className="data-export-foot">
            <button type="button" className="data-export-btn ghost" onClick={onClose}>
              Abbrechen
            </button>
            <button
              type="button"
              className="data-export-btn primary"
              onClick={handleExport}
              disabled={loading || !preview || !!previewError}
            >
              {loading ? (
                <><Loader2 size={16} className="data-export-spin" /><span>Lade…</span></>
              ) : done ? (
                <><CheckCircle2 size={16} /><span>Heruntergeladen</span></>
              ) : (
                <><Download size={16} /><span>Jetzt herunterladen</span></>
              )}
            </button>
          </footer>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
