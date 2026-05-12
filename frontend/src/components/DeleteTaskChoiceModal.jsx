import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, EyeOff, AlertTriangle } from 'lucide-react';

/**
 * Native-app feeling delete-choice dialog.
 * Bottom-sheet on mobile, centered card on desktop.
 *
 * Props:
 *   open: boolean
 *   onClose(): void
 *   onFullDelete(): void
 *   onDismiss(): void
 *   taskTitle?: string
 *   taskType?: 'task' | 'event'
 *   canFullDelete?: boolean
 *   isOwner?: boolean
 */
export default function DeleteTaskChoiceModal({
  open,
  onClose,
  onFullDelete,
  onDismiss,
  taskTitle,
  taskType,
  canFullDelete = true,
  isOwner = false,
}) {
  const isEvent = taskType === 'event';
  const nounAcc = isEvent ? 'den Termin' : 'die Aufgabe';
  const heading = isEvent ? 'Termin entfernen' : 'Aufgabe entfernen';

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-overlay dt-choice-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          <motion.div
            className="dt-choice-sheet"
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            dragMomentum={false}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) onClose();
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dt-choice-handle" aria-hidden="true" />

            <div className="dt-choice-header">
              <h2 className="dt-choice-title">{heading}</h2>
              {taskTitle && (
                <p className="dt-choice-task-title">„{taskTitle}"</p>
              )}
              <p className="dt-choice-description">
                {canFullDelete
                  ? (isOwner
                      ? `Du kannst ${nounAcc} komplett löschen oder nur aus deinem eigenen Kalender entfernen.`
                      : `Als Gruppen-Admin kannst du wählen, wie ${nounAcc} entfernt werden soll.`)
                  : `Du kannst ${nounAcc} aus deinem Kalender entfernen.`}
              </p>
            </div>

            <div className="dt-choice-actions">
              <button
                type="button"
                className="dt-choice-btn dt-choice-btn-secondary"
                onClick={() => { onDismiss(); onClose(); }}
              >
                <span className="dt-choice-btn-icon">
                  <EyeOff size={20} />
                </span>
                <span className="dt-choice-btn-content">
                  <span className="dt-choice-btn-label">
                    Aus meinem Kalender entfernen
                  </span>
                  <span className="dt-choice-btn-hint">
                    {isEvent ? 'Der Termin bleibt' : 'Die Aufgabe bleibt'} für alle anderen sichtbar.
                    Du kannst sie später wiederherstellen.
                  </span>
                </span>
              </button>

              {canFullDelete && (
                <button
                  type="button"
                  className="dt-choice-btn dt-choice-btn-danger"
                  onClick={() => { onFullDelete(); onClose(); }}
                >
                  <span className="dt-choice-btn-icon">
                    <Trash2 size={20} />
                  </span>
                  <span className="dt-choice-btn-content">
                    <span className="dt-choice-btn-label">
                      {isEvent ? 'Termin komplett löschen' : 'Aufgabe komplett löschen'}
                    </span>
                    <span className="dt-choice-btn-hint">
                      <AlertTriangle size={12} aria-hidden="true" />
                      Endgültig — auch für alle anderen Mitglieder entfernt.
                    </span>
                  </span>
                </button>
              )}
            </div>

            <button type="button" className="dt-choice-cancel" onClick={onClose}>
              Abbrechen
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
