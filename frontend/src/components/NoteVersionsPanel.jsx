// Versions-Panel fuer eine Note. Zeigt die letzten Snapshots (max 50)
// mit Autor + Zeit. Ein Klick auf "Vorschau" laedt den vollen Content
// und blendet ihn in einer kleinen Preview-Box ein; "Wiederherstellen"
// ueberschreibt die aktuelle Note (Backend snapshottet vorher).
//
// Bewusst leichtgewichtig - keine Diff-Anzeige, das kommt spaeter.

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { History, RotateCcw, Eye, X, Loader2 } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { api } from '../utils/api';
import AvatarBadge from './AvatarBadge';
import { sanitizeHtml, looksLikeHtml } from '../lib/noteFormat';

function relTime(iso) {
  if (!iso) return '';
  try {
    const d = typeof iso === 'string' ? parseISO(iso) : new Date(iso);
    return formatDistanceToNow(d, { addSuffix: true, locale: de });
  } catch {
    return '';
  }
}

export default function NoteVersionsPanel({ noteId, onClose, onRestored, canEdit = true }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [previewNo, setPreviewNo] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [restoring, setRestoring] = useState(null); // version_no, das gerade restored wird

  const load = useCallback(async () => {
    if (!noteId) return;
    setLoading(true);
    try {
      const data = await api.listNoteVersions(noteId);
      setVersions(Array.isArray(data?.versions) ? data.versions : []);
      setError(null);
    } catch (err) {
      console.error('[NoteVersionsPanel] load failed:', err);
      setError('Verlauf konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => { load(); }, [load]);

  const handlePreview = useCallback(async (versionNo) => {
    if (previewNo === versionNo) {
      setPreviewNo(null);
      setPreviewData(null);
      return;
    }
    setPreviewNo(versionNo);
    setPreviewData(null);
    setPreviewLoading(true);
    try {
      const data = await api.getNoteVersion(noteId, versionNo);
      setPreviewData(data?.version || null);
    } catch (err) {
      console.error('[NoteVersionsPanel] preview failed:', err);
      setPreviewData(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [noteId, previewNo]);

  const handleRestore = useCallback(async (versionNo) => {
    if (!canEdit) return;
    const ok = window.confirm(
      `Diese Version (Nr. ${versionNo}) wiederherstellen? Der aktuelle Stand wird vorher als neue Version gesichert.`
    );
    if (!ok) return;
    setRestoring(versionNo);
    try {
      await api.restoreNoteVersion(noteId, versionNo);
      onRestored?.();
      await load();
    } catch (err) {
      console.error('[NoteVersionsPanel] restore failed:', err);
      window.alert('Wiederherstellung fehlgeschlagen.');
    } finally {
      setRestoring(null);
    }
  }, [noteId, canEdit, onRestored, load]);

  return (
    <motion.div
      className="nem-ver-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      role="presentation"
    >
      <motion.div
        className="nem-ver-panel"
        initial={{ opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.985 }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
        role="dialog"
        aria-modal="true"
        aria-label="Versionsverlauf"
        onClick={(e) => e.stopPropagation()}
      >
      <div className="nem-ver-head">
        <div className="nem-ver-head-title">
          <History size={16} />
          <span>Verlauf</span>
          {versions.length > 0 && <span className="nem-ver-count">({versions.length})</span>}
        </div>
        <button type="button" className="nem-ver-close" onClick={onClose} title="Schliessen">
          <X size={16} />
        </button>
      </div>

      <div className="nem-ver-body">
        {loading ? (
          <div className="nem-ver-empty"><Loader2 size={16} className="nem-ver-spin" /> Lade Verlauf...</div>
        ) : error ? (
          <div className="nem-ver-empty nem-ver-error">{error}</div>
        ) : versions.length === 0 ? (
          <div className="nem-ver-empty">Noch keine Versionen vorhanden. Sobald die Notiz bearbeitet wird, werden hier Snapshots angelegt.</div>
        ) : (
          <ul className="nem-ver-list">
            <AnimatePresence initial={false}>
              {versions.map((v) => {
                const isOpen = previewNo === v.version_no;
                const isRestoring = restoring === v.version_no;
                return (
                  <motion.li
                    key={v.id}
                    className={`nem-ver-item${isOpen ? ' is-open' : ''}`}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.14 }}
                  >
                    <div className="nem-ver-row">
                      <AvatarBadge
                        name={v.author_name || 'Unbekannt'}
                        avatarUrl={v.author_avatar_url}
                        color={v.author_avatar_color}
                        size={26}
                      />
                      <div className="nem-ver-meta">
                        <div className="nem-ver-line">
                          <span className="nem-ver-no">v{v.version_no}</span>
                          <span className="nem-ver-author">{v.author_name || 'Unbekannt'}</span>
                        </div>
                        <div className="nem-ver-time">{relTime(v.created_at)}</div>
                      </div>
                      <div className="nem-ver-actions">
                        <button
                          type="button"
                          className="nem-ver-btn"
                          onClick={() => handlePreview(v.version_no)}
                          title="Vorschau"
                        >
                          <Eye size={14} />
                        </button>
                        {canEdit && (
                          <button
                            type="button"
                            className="nem-ver-btn is-primary"
                            onClick={() => handleRestore(v.version_no)}
                            disabled={isRestoring}
                            title="Diese Version wiederherstellen"
                          >
                            {isRestoring ? <Loader2 size={14} className="nem-ver-spin" /> : <RotateCcw size={14} />}
                          </button>
                        )}
                      </div>
                    </div>
                    <AnimatePresence>
                      {isOpen && (
                        <motion.div
                          className="nem-ver-preview"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.18 }}
                        >
                          {previewLoading ? (
                            <div className="nem-ver-empty"><Loader2 size={14} className="nem-ver-spin" /> Lade Vorschau...</div>
                          ) : previewData ? (
                            <>
                              {previewData.title && (
                                <div className="nem-ver-preview-title">{previewData.title}</div>
                              )}
                              {looksLikeHtml(previewData.content || '') ? (
                                <div
                                  className="nem-ver-preview-content"
                                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(previewData.content || '') }}
                                />
                              ) : (
                                <pre className="nem-ver-preview-content nem-ver-preview-pre">{previewData.content || '(leer)'}</pre>
                              )}
                            </>
                          ) : (
                            <div className="nem-ver-empty">Vorschau konnte nicht geladen werden.</div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>
      </motion.div>
    </motion.div>
  );
}
