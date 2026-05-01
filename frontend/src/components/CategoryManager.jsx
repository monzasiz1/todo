import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Pencil, Trash2, Check, Tag } from 'lucide-react';
import { useTaskStore } from '../store/taskStore';

const PRESET_COLORS = [
  '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#FF6482',
  '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#30B0C7',
  '#8E8E93', '#636366',
];

function CategoryItem({ category, onEdit, onDelete }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="catm-item">
      <div className="catm-item-color" style={{ background: category.color }} />
      <span className="catm-item-name">{category.name}</span>
      <div className="catm-item-actions">
        <button className="catm-item-btn edit" onClick={() => onEdit(category)} title="Bearbeiten">
          <Pencil size={14} />
        </button>
        {confirming ? (
          <button
            className="catm-item-btn delete confirm"
            onClick={() => { onDelete(category.id); setConfirming(false); }}
            title="Löschen bestätigen"
          >
            <Check size={14} />
          </button>
        ) : (
          <button
            className="catm-item-btn delete"
            onClick={() => setConfirming(true)}
            onBlur={() => setTimeout(() => setConfirming(false), 200)}
            title="Löschen"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function CategoryForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [color, setColor] = useState(initial?.color || '#007AFF');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), color });
  };

  return (
    <form className="catm-form" onSubmit={handleSubmit}>
      <div className="catm-form-field">
        <label>Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z.B. Sport, Projekte..."
          className="catm-form-input"
          autoFocus
          maxLength={50}
        />
      </div>
      <div className="catm-form-field">
        <label>Farbe</label>
        <div className="catm-color-grid">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`catm-color-swatch ${color === c ? 'active' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <div className="catm-color-custom">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="catm-color-picker"
          />
          <span className="catm-color-hex">{color}</span>
        </div>
      </div>
      <div className="catm-form-actions">
        <button type="button" className="catm-btn-cancel" onClick={onCancel}>
          Abbrechen
        </button>
        <button type="submit" className="catm-btn-save" disabled={!name.trim()}>
          {initial ? 'Speichern' : 'Erstellen'}
        </button>
      </div>
    </form>
  );
}

export default function CategoryManager({ onClose }) {
  const { categories, createCategory, updateCategory, deleteCategory } = useTaskStore();
  const [mode, setMode] = useState('list'); // 'list' | 'create' | 'edit'
  const [editCat, setEditCat] = useState(null);

  const handleCreate = async (data) => {
    const result = await createCategory(data);
    if (result) setMode('list');
  };

  const handleUpdate = async (data) => {
    if (!editCat) return;
    const result = await updateCategory(editCat.id, data);
    if (result) {
      setMode('list');
      setEditCat(null);
    }
  };

  const handleDelete = async (id) => {
    await deleteCategory(id);
  };

  const startEdit = (cat) => {
    setEditCat(cat);
    setMode('edit');
  };

  return createPortal(
    <motion.div
      className="friends-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="friends-panel catm-panel"
        initial={{ x: 300, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 300, opacity: 0 }}
        transition={{ type: 'spring', damping: 25 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="friends-header">
          <h2><Tag size={20} /> Kategorien</h2>
          <button className="friends-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <AnimatePresence mode="wait">
          {mode === 'list' && (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="catm-content"
            >
              <button
                className="catm-add-btn"
                onClick={() => setMode('create')}
              >
                <Plus size={18} />
                Neue Kategorie
              </button>

              <div className="catm-list">
                {categories.length > 0 ? (
                  categories.map((cat) => (
                    <CategoryItem
                      key={cat.id}
                      category={cat}
                      onEdit={startEdit}
                      onDelete={handleDelete}
                    />
                  ))
                ) : (
                  <div className="catm-empty">
                    Keine Kategorien vorhanden.
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {mode === 'create' && (
            <motion.div
              key="create"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="catm-content"
            >
              <div className="catm-form-title">Neue Kategorie</div>
              <CategoryForm
                onSave={handleCreate}
                onCancel={() => setMode('list')}
              />
            </motion.div>
          )}

          {mode === 'edit' && editCat && (
            <motion.div
              key="edit"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="catm-content"
            >
              <div className="catm-form-title">Kategorie bearbeiten</div>
              <CategoryForm
                initial={editCat}
                onSave={handleUpdate}
                onCancel={() => { setMode('list'); setEditCat(null); }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>,
    document.body
  );
}
