import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, X, FileText, CheckSquare, Square, AlertCircle, CalendarPlus, Loader2 } from 'lucide-react';
import { parseIcs } from '../utils/icsParser';
import { api } from '../utils/api';
import { useTaskStore } from '../store/taskStore';

// Modal zum Importieren von Terminen aus .ics-Dateien (Google Calendar / Apple
// Calendar / Outlook Export). Parst clientseitig, zeigt Vorschau und legt
// ausgewaehlte Eintraege ueber POST /api/tasks als Events an.
export default function CalendarImportModal({ open, onClose, onImported }) {
  const [fileName, setFileName] = useState('');
  const [rawText, setRawText] = useState('');
  const [parseResult, setParseResult] = useState(null); // { events, calendarName, totalParsed }
  const [parseError, setParseError] = useState('');
  const [selected, setSelected] = useState({}); // index -> bool
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
  const fileInputRef = useRef(null);
  const addToast = useTaskStore((s) => s.addToast);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 600px)').matches
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(max-width: 600px)');
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);

  useEffect(() => {
    if (!open) {
      // Reset State beim Schliessen
      setFileName('');
      setRawText('');
      setParseResult(null);
      setParseError('');
      setSelected({});
      setImporting(false);
      setProgress({ done: 0, total: 0, failed: 0 });
    }
  }, [open]);

  const handleFile = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setParseError('Datei zu gross (max. 5 MB).');
      return;
    }
    try {
      const text = await file.text();
      setFileName(file.name);
      setRawText(text);
      runParse(text);
    } catch {
      setParseError('Datei konnte nicht gelesen werden.');
    }
  };

  const runParse = (text) => {
    setParseError('');
    try {
      const result = parseIcs(text);
      if (!result.events.length) {
        setParseError('Keine Termine in der Datei gefunden.');
        setParseResult(null);
        return;
      }
      setParseResult(result);
      // Standard: alle ab heute markieren
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const initSel = {};
      result.events.forEach((ev, idx) => {
        const d = new Date(`${ev.date}T00:00:00`);
        initSel[idx] = !Number.isNaN(d.getTime()) && d >= today;
      });
      setSelected(initSel);
    } catch (err) {
      setParseError(err?.message || 'Datei konnte nicht gelesen werden.');
      setParseResult(null);
    }
  };

  const selectedCount = useMemo(
    () => Object.values(selected).filter(Boolean).length,
    [selected]
  );

  const toggleAll = (val) => {
    if (!parseResult) return;
    const next = {};
    parseResult.events.forEach((_, idx) => { next[idx] = val; });
    setSelected(next);
  };

  const toggleOne = (idx) => {
    setSelected((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const handleImport = async () => {
    if (!parseResult || importing) return;
    const items = parseResult.events.filter((_, idx) => selected[idx]);
    if (!items.length) {
      addToast('Bitte mindestens einen Termin auswaehlen', 'error');
      return;
    }
    setImporting(true);
    setProgress({ done: 0, total: items.length, failed: 0 });

    let done = 0;
    let failed = 0;
    for (const ev of items) {
      try {
        const payload = {
          type: 'event',
          title: ev.title,
          description: ev.description || null,
          date: ev.date,
          date_end: ev.date_end || null,
          time: ev.all_day ? null : (ev.time || null),
          time_end: ev.all_day ? null : (ev.time_end || null),
          priority: 'medium',
        };
        await api.createTask(payload);
        done += 1;
      } catch {
        failed += 1;
      }
      setProgress({ done: done + failed, total: items.length, failed });
    }

    setImporting(false);
    if (failed === 0) {
      addToast(`${done} Termin${done === 1 ? '' : 'e'} importiert`);
    } else if (done === 0) {
      addToast(`Import fehlgeschlagen (${failed} Fehler)`, 'error');
    } else {
      addToast(`${done} importiert, ${failed} fehlgeschlagen`, 'info');
    }
    onImported?.({ done, failed });
    if (done > 0 && failed === 0) onClose?.();
  };

  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="cal-import-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="cal-import-modal"
          initial={isMobile ? { y: '100%' } : { opacity: 0, y: 24, scale: 0.98 }}
          animate={isMobile ? { y: 0 } : { opacity: 1, y: 0, scale: 1 }}
          exit={isMobile ? { y: '100%' } : { opacity: 0, y: 24, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
          {...(isMobile ? {
            drag: 'y',
            dragDirectionLock: true,
            dragConstraints: { top: 0, bottom: 0 },
            dragElastic: { top: 0, bottom: 0.6 },
            onDragEnd: (_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 500) onClose();
            },
          } : {})}
        >
          {isMobile && <div className="cal-import-drag" aria-hidden="true" />}
          <header className="cal-import-head">
            <div>
              <h3>Kalender importieren</h3>
              <p>Lade eine .ics-Datei aus Google Calendar, Apple Kalender oder Outlook hoch.</p>
            </div>
            {!isMobile && (
              <button type="button" className="cal-import-close" onClick={onClose} aria-label="Schliessen">
                <X size={18} />
              </button>
            )}
          </header>

          <div className="cal-import-body">
            {!parseResult && (
              <>
                <button
                  type="button"
                  className="cal-import-drop"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={22} />
                  <strong>.ics-Datei auswaehlen</strong>
                  <span>oder hier hin ziehen</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".ics,text/calendar"
                  style={{ display: 'none' }}
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />

                <div className="cal-import-paste">
                  <label htmlFor="cal-import-paste-ta">…oder ICS-Inhalt einfuegen</label>
                  <textarea
                    id="cal-import-paste-ta"
                    placeholder="BEGIN:VCALENDAR..."
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    rows={5}
                  />
                  <button
                    type="button"
                    className="cal-import-btn-secondary"
                    onClick={() => runParse(rawText)}
                    disabled={!rawText.trim()}
                  >
                    Analysieren
                  </button>
                </div>

                <details className="cal-import-help">
                  <summary>Wie komme ich an meine .ics-Datei?</summary>
                  <ul>
                    <li><strong>Google Calendar</strong>: Einstellungen → Importieren &amp; Exportieren → Exportieren. ZIP entpacken.</li>
                    <li><strong>Apple Kalender</strong>: Kalender auswaehlen → Ablage → Exportieren → Exportieren…</li>
                    <li><strong>Outlook</strong>: Datei → Speichern unter → iCalendar-Format (.ics).</li>
                  </ul>
                </details>
              </>
            )}

            {parseError && (
              <div className="cal-import-error">
                <AlertCircle size={16} />
                <span>{parseError}</span>
              </div>
            )}

            {parseResult && (
              <>
                <div className="cal-import-summary">
                  <FileText size={16} />
                  <span>
                    {fileName || 'ICS-Daten'}
                    {parseResult.calendarName ? ` · ${parseResult.calendarName}` : ''}
                    {' · '}
                    {parseResult.events.length} Termin{parseResult.events.length === 1 ? '' : 'e'}
                  </span>
                  <button
                    type="button"
                    className="cal-import-link"
                    onClick={() => { setParseResult(null); setRawText(''); setFileName(''); }}
                  >
                    Andere Datei
                  </button>
                </div>

                <div className="cal-import-toolbar">
                  <button type="button" onClick={() => toggleAll(true)}>Alle</button>
                  <button type="button" onClick={() => toggleAll(false)}>Keine</button>
                  <span className="cal-import-count">{selectedCount} ausgewaehlt</span>
                </div>

                <ul className="cal-import-list">
                  {parseResult.events.map((ev, idx) => {
                    const checked = !!selected[idx];
                    const dateLabel = formatEventLabel(ev);
                    return (
                      <li
                        key={`${ev.uid || ev.title}_${idx}`}
                        className={`cal-import-item ${checked ? 'on' : ''}`}
                        onClick={() => toggleOne(idx)}
                      >
                        <span className="cal-import-check" aria-hidden>
                          {checked ? <CheckSquare size={18} /> : <Square size={18} />}
                        </span>
                        <span className="cal-import-item-body">
                          <strong>{ev.title}</strong>
                          <span>{dateLabel}</span>
                          {ev.recurrence_hint && (
                            <em className="cal-import-rrule">Wiederholung wird als einzelner Termin importiert</em>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>

          <footer className="cal-import-foot">
            {importing && progress.total > 0 && (
              <div className="cal-import-progress">
                <Loader2 size={14} className="cal-import-spin" />
                <span>{progress.done}/{progress.total} importiert{progress.failed ? ` · ${progress.failed} Fehler` : ''}</span>
              </div>
            )}
            <div className="cal-import-actions">
              <button type="button" className="cal-import-btn-secondary" onClick={onClose} disabled={importing}>
                Abbrechen
              </button>
              <button
                type="button"
                className="cal-import-btn-primary"
                onClick={handleImport}
                disabled={!parseResult || selectedCount === 0 || importing}
              >
                <CalendarPlus size={16} />
                {importing ? 'Importiere…' : `Importieren${selectedCount ? ` (${selectedCount})` : ''}`}
              </button>
            </div>
          </footer>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

function formatEventLabel(ev) {
  const dateStr = formatGermanDate(ev.date);
  const endStr = ev.date_end ? ` – ${formatGermanDate(ev.date_end)}` : '';
  if (ev.all_day) {
    return `${dateStr}${endStr} · ganztaegig`;
  }
  const t = ev.time || '';
  const te = ev.time_end ? ` – ${ev.time_end}` : '';
  return `${dateStr}${endStr}${t ? ` · ${t}${te} Uhr` : ''}`;
}

function formatGermanDate(ymd) {
  if (!ymd) return '';
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  return `${m[3]}.${m[2]}.${m[1]}`;
}
