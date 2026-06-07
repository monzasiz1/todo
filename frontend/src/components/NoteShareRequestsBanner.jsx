import { useEffect, useState } from 'react';
import { Bell, Check, X } from 'lucide-react';
import { useNotesStore } from '../store/notesStore';
import AvatarBadge from './AvatarBadge';

/**
 * Kleiner Header-Button mit Badge fuer eingehende Notiz-Share-Anfragen.
 * - Holt Anfragen beim Mount und bei Realtime-Events.
 * - Modal-Liste mit "Annehmen" / "Ablehnen" pro Anfrage.
 */
export default function NoteShareRequestsBanner() {
  const requests = useNotesStore((s) => s.shareRequests);
  const fetchShareRequests = useNotesStore((s) => s.fetchShareRequests);
  const acceptShareRequest = useNotesStore((s) => s.acceptShareRequest);
  const declineShareRequest = useNotesStore((s) => s.declineShareRequest);

  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchShareRequests();
    // Periodisch (alle 60 s) im Hintergrund nachladen, damit neue Anfragen
    // ankommen auch ohne harten Page-Refresh.
    const interval = setInterval(() => {
      fetchShareRequests();
    }, 60000);
    const onRealtime = () => fetchShareRequests();
    window.addEventListener('beequ:notes-changed', onRealtime);
    window.addEventListener('focus', onRealtime);
    return () => {
      clearInterval(interval);
      window.removeEventListener('beequ:notes-changed', onRealtime);
      window.removeEventListener('focus', onRealtime);
    };
  }, [fetchShareRequests]);

  const count = requests?.length || 0;

  const handleAccept = async (noteId) => {
    setBusyId(String(noteId));
    setError(null);
    try {
      await acceptShareRequest(noteId);
    } catch (err) {
      setError(err?.message || 'Annahme fehlgeschlagen');
    } finally {
      setBusyId(null);
    }
  };

  const handleDecline = async (noteId) => {
    setBusyId(String(noteId));
    setError(null);
    try {
      await declineShareRequest(noteId);
    } catch (err) {
      setError(err?.message || 'Ablehnen fehlgeschlagen');
    } finally {
      setBusyId(null);
    }
  };

  if (count === 0) {
    // Kein Indicator wenn nichts offen ist.
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="board-control-btn note-share-requests-btn"
        onClick={() => setOpen(true)}
        title={`${count} offene Notiz-Anfrage${count === 1 ? '' : 'n'}`}
        aria-label={`${count} offene Notiz-Anfragen anzeigen`}
      >
        <Bell size={16} />
        {count > 0 && (
          <span className="note-share-requests-badge">{count}</span>
        )}
      </button>

      {open && (
        <div
          className="note-share-requests-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Eingehende Notiz-Anfragen"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="note-share-requests-modal">
            <div className="note-share-requests-header">
              <h2>Geteilte Notizen</h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setOpen(false)}
                aria-label="Schließen"
              >
                <X size={18} />
              </button>
            </div>

            {error && (
              <div className="note-share-requests-error" role="alert">
                {error}
              </div>
            )}

            {count === 0 ? (
              <div className="note-share-requests-empty">
                Keine offenen Anfragen.
              </div>
            ) : (
              <ul className="note-share-requests-list">
                {requests.map((req) => {
                  const noteId = req.note_id;
                  const isBusy = busyId === String(noteId);
                  return (
                    <li key={String(noteId)} className="note-share-request-item">
                      <div className="note-share-request-info">
                        <AvatarBadge
                          name={req.owner_name}
                          avatarUrl={req.owner_avatar_url}
                          color={req.owner_avatar_color || '#007AFF'}
                          size={36}
                        />
                        <div className="note-share-request-text">
                          <div className="note-share-request-title">
                            {req.title || 'Notiz ohne Titel'}
                          </div>
                          <div className="note-share-request-sub">
                            <strong>{req.owner_name || 'Jemand'}</strong> moechte
                            diese Notiz mit dir teilen
                            {req.permission && req.permission !== 'view' ? (
                              <span> ({req.permission === 'edit' ? 'Bearbeiten' : 'Kommentieren'})</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="note-share-request-actions">
                        <button
                          type="button"
                          className="note-share-request-btn decline"
                          onClick={() => handleDecline(noteId)}
                          disabled={isBusy}
                          title="Ablehnen"
                        >
                          <X size={14} />
                          <span>Ablehnen</span>
                        </button>
                        <button
                          type="button"
                          className="note-share-request-btn accept"
                          onClick={() => handleAccept(noteId)}
                          disabled={isBusy}
                          title="Annehmen"
                        >
                          <Check size={14} />
                          <span>Annehmen</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
