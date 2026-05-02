import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Paperclip, Upload, X, FileText, Image, File, Loader2, Download, Trash2 } from 'lucide-react';
import { api } from '../utils/api';
import { useTaskStore } from '../store/taskStore';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

const FILE_ICONS = {
  'image/': Image,
  'application/pdf': FileText,
  'text/': FileText,
};

function getFileIcon(mimeType) {
  for (const [prefix, Icon] of Object.entries(FILE_ICONS)) {
    if (mimeType.startsWith(prefix)) return Icon;
  }
  return File;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TaskAttachments({ taskId, canEdit = true, compact = false }) {
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileRef = useRef(null);
  const { addToast } = useTaskStore();

  useEffect(() => {
    if (taskId) loadAttachments();
  }, [taskId]);

  const loadAttachments = async () => {
    try {
      const data = await api.getAttachments(taskId);
      setAttachments(data.attachments || []);
    } catch {
      // Table might not exist yet
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 4 * 1024 * 1024) {
      addToast('Datei zu groß (max. 4 MB)', 'error');
      return;
    }

    setUploading(true);
    try {
      const base64 = await fileToBase64(file);
      const result = await api.uploadAttachment(taskId, {
        file_name: file.name,
        file_type: file.type || 'application/octet-stream',
        file_data: base64,
      });
      setAttachments((prev) => [...prev, result.attachment]);
      addToast(`"${file.name}" angehängt`);
    } catch (err) {
      addToast(err.message || 'Upload fehlgeschlagen', 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDelete = async (attachmentId, fileName) => {
    try {
      await api.deleteAttachment(taskId, attachmentId);
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
      addToast(`"${fileName}" entfernt`);
    } catch (err) {
      addToast(err.message || 'Löschen fehlgeschlagen', 'error');
    }
  };

  const handleOpen = (attachment) => {
    const url = api.getAttachmentUrl(taskId, attachment.id);
    window.open(url, '_blank');
  };

  // Compact mode: just show count + paperclip icon (for TaskCard)
  if (compact) {
    if (attachments.length === 0) return null;
    return (
      <span className="task-attachment-badge">
        <Paperclip size={12} />
        {attachments.length}
      </span>
    );
  }

  // In read-only mode, don't render a temporary loading placeholder.
  // Otherwise the section appears briefly and then vanishes (layout jump).
  const shouldRenderSection = canEdit || attachments.length > 0;
  if (!shouldRenderSection) return null;

  return (
    <div className="task-attachments" style={loading && canEdit ? { minHeight: 88 } : undefined}>
      <div className="task-attachments-header">
        <Paperclip size={14} />
        <span>Dateien</span>
        <span className="task-attachments-count">{loading ? '.../10' : `${attachments.length}/10`}</span>
      </div>

      {loading && attachments.length === 0 && (
        <div className="task-attachment-item" style={{ opacity: 0.8 }}>
          <div className="task-attachment-icon">
            <Loader2 size={16} className="spin" />
          </div>
          <div className="task-attachment-info">
            <span className="task-attachment-name">Dateien werden geladen...</span>
            <span className="task-attachment-meta">Bitte kurz warten</span>
          </div>
        </div>
      )}

      {/* File List */}
      <AnimatePresence>
        {attachments.map((att) => {
          const Icon = getFileIcon(att.file_type);
          const isImage = att.file_type.startsWith('image/');
          return (
            <motion.div
              key={att.id}
              className="task-attachment-item"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <div className="task-attachment-icon" onClick={() => handleOpen(att)}>
                {isImage ? (
                  <img
                    src={api.getAttachmentUrl(taskId, att.id)}
                    alt={att.file_name}
                    className="task-attachment-thumb"
                    loading="lazy"
                  />
                ) : (
                  <Icon size={18} />
                )}
              </div>
              <div className="task-attachment-info" onClick={() => handleOpen(att)}>
                <span className="task-attachment-name">{att.file_name}</span>
                <span className="task-attachment-meta">
                  {formatSize(att.file_size)}
                  {att.created_at && ` · ${formatDistanceToNow(parseISO(att.created_at), { addSuffix: true, locale: de })}`}
                </span>
              </div>
              {canEdit && (
                <button
                  className="task-attachment-delete"
                  onClick={() => handleDelete(att.id, att.file_name)}
                  title="Entfernen"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Upload Button */}
      {canEdit && attachments.length < 10 && (
        <button
          className="task-attachment-upload"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
          {uploading ? 'Wird hochgeladen...' : 'Datei anhängen'}
        </button>
      )}

      <input
        ref={fileRef}
        type="file"
        onChange={handleFileSelect}
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
        style={{ display: 'none' }}
      />
    </div>
  );
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      // Remove data:...;base64, prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
