import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../utils/api';
import { useTaskStore } from '../store/taskStore';
import { useAuthStore } from '../store/authStore';
import AvatarBadge from './AvatarBadge';
import {
  Plus, X, ChevronDown, ChevronRight, CalendarDays, Clock,
  Flag, Check, Trash2, Pencil, Pin, PinOff, FolderKanban,
  LayoutList, AlertCircle, CheckCircle2, Circle, Layers,
} from 'lucide-react';
import { format, parseISO, differenceInDays, isToday, isBefore } from 'date-fns';
import { de } from 'date-fns/locale';

const PROJECT_COLORS = [
  '#007AFF','#5856D6','#34C759','#FF9500','#FF3B30',
  '#AF52DE','#FF2D55','#00C7BE','#5AC8FA','#FFCC00',
];

const PRIORITY_CONFIG = {
  urgent: { label: 'Dringend', color: '#FF3B30' },
  high:   { label: 'Hoch',     color: '#FF9500' },
  medium: { label: 'Mittel',   color: '#007AFF' },
  low:    { label: 'Niedrig',  color: '#34C759' },
};

const STATUS_CONFIG = {
  active:   { label: 'Aktiv',      color: '#007AFF', bg: '#EFF6FF' },
  done:     { label: 'Abgeschlossen', color: '#34C759', bg: '#F0FFF4' },
  archived: { label: 'Archiviert', color: '#8E8E93', bg: '#F5F5F5' },
};

function fmtDate(dateStr) {
  if (!dateStr) return '';
  try { return format(parseISO(String(dateStr).slice(0,10)), 'd. MMM yyyy', { locale: de }); }
  catch { return String(dateStr).slice(0,10); }
}

function ProjectProgress({ items }) {
  const total = items.length;
  const done  = items.filter(i => i.completed).length;
  const pct   = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="gp-progress-wrap">
      <div className="gp-progress-bar">
        <div className="gp-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="gp-progress-label">{done}/{total} erledigt</span>
    </div>
  );
}

function TaskPill({ item, onUnpin, canUnpin }) {
  const isTask  = !item.type || item.type === 'task';
  const isEvent = item.type === 'event';
  const pCfg    = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.medium;
  const ended   = item.completed;
  return (
    <div className={`gp-task-pill${ended ? ' done' : ''}`}>
      <div className="gp-task-pill-left">
        <span className="gp-task-pill-type">
          {isEvent ? <CalendarDays size={13} color="#5856D6"/> : <Check size={13} color="#007AFF"/>}
        </span>
        <div className="gp-task-pill-info">
          <span className="gp-task-pill-title">{item.title}</span>
          <div className="gp-task-pill-meta">
            {item.date && (
              <span className="gp-task-pill-date">
                <CalendarDays size={11}/> {fmtDate(item.date)}
                {item.time && <> · <Clock size={11}/> {String(item.time).slice(0,5)}</>}
              </span>
            )}
            {item.category_name && (
              <span className="gp-task-pill-cat" style={{ background: `${item.category_color}22`, color: item.category_color }}>
                {item.category_name}
              </span>
            )}
            <span className="gp-task-pill-prio" style={{ color: pCfg.color }}>
              <Flag size={10}/> {pCfg.label}
            </span>
            {item.task_owner_name && (
              <span className="gp-task-pill-owner">
                <AvatarBadge name={item.task_owner_name} color={item.task_owner_color || '#8E8E93'} avatarUrl={item.task_owner_avatar} size={16}/>
                {item.task_owner_name}
              </span>
            )}
          </div>
          {item.note && <p className="gp-task-pill-note">"{item.note}"</p>}
        </div>
      </div>
      {canUnpin && (
        <button className="gp-task-unpin-btn" onClick={() => onUnpin(item.pin_id)} title="Ablösen">
          <PinOff size={14}/>
        </button>
      )}
    </div>
  );
}

function PinTaskModal({ groupId, projectId, groupTasks, pinnedIds, onPin, onClose }) {
  const [search, setSearch] = useState('');
  const [note,   setNote]   = useState('');
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const available = useMemo(() =>
    groupTasks.filter(t =>
      !pinnedIds.has(t.id) &&
      t.title.toLowerCase().includes(search.toLowerCase())
    ), [groupTasks, pinnedIds, search]);

  const handlePin = async () => {
    if (!selected) return;
    setSaving(true); setError('');
    try {
      await onPin(selected.id, note);
      onClose();
    } catch (e) {
      setError(e.message || 'Fehler beim Anheften');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div className="gp-modal-overlay" onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="gp-modal" onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.97 }} transition={{ duration: 0.22 }}>
        <div className="gp-modal-head">
          <h3><Pin size={16}/> Aufgabe/Termin anheften</h3>
          <button className="gp-modal-close" onClick={onClose}><X size={17}/></button>
        </div>

        <div className="gp-modal-search-wrap">
          <input
            className="gp-modal-search"
            placeholder="Suchen…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className="gp-modal-task-list">
          {available.length === 0 ? (
            <p className="gp-modal-empty">Keine Aufgaben gefunden</p>
          ) : available.map(t => (
            <button
              key={t.id}
              className={`gp-modal-task-row${selected?.id === t.id ? ' selected' : ''}`}
              onClick={() => setSelected(t)}
            >
              <span className="gp-modal-task-icon">
                {t.type === 'event' ? <CalendarDays size={14} color="#5856D6"/> : <Circle size={14} color="#007AFF"/>}
              </span>
              <span className="gp-modal-task-title">{t.title}</span>
              {t.date && <span className="gp-modal-task-date">{fmtDate(t.date)}</span>}
              {selected?.id === t.id && <Check size={14} color="#007AFF" style={{ marginLeft: 'auto' }}/>}
            </button>
          ))}
        </div>

        {selected && (
          <div className="gp-modal-note-wrap">
            <label>Notiz (optional)</label>
            <input
              className="gp-modal-note"
              placeholder="Kurze Notiz zum Anheften…"
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={200}
            />
          </div>
        )}

        {error && <div className="bq-auth-error" style={{ margin: '0 0 8px' }}><AlertCircle size={14}/><span>{error}</span></div>}

        <div className="gp-modal-footer">
          <button className="gp-modal-cancel" onClick={onClose}>Abbrechen</button>
          <button
            className="gp-modal-confirm"
            disabled={!selected || saving}
            onClick={handlePin}
          >
            {saving ? <span className="bq-auth-spinner"/> : <><Pin size={14}/> Anheften</>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ProjectCard({ project, groupId, groupTasks, isAdmin, userId, onEdit, onDelete, onProjectUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems]       = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [error, setError]       = useState('');

  const pinnedIds = useMemo(() => new Set(items.map(i => i.id)), [items]);
  const canEdit   = isAdmin || project.created_by === userId;

  const totalDays     = differenceInDays(parseISO(String(project.date_end).slice(0,10)), parseISO(String(project.date_start).slice(0,10))) + 1;
  const daysLeft      = differenceInDays(parseISO(String(project.date_end).slice(0,10)), new Date());
  const isOverdue     = daysLeft < 0 && project.status !== 'done';
  const endingSoon    = daysLeft >= 0 && daysLeft <= 3 && project.status === 'active';

  const loadItems = useCallback(async () => {
    setLoadingItems(true);
    try {
      const data = await api.getGroupProjectItems(groupId, project.id);
      setItems(data.items || []);
    } catch { setItems([]); }
    finally { setLoadingItems(false); }
  }, [groupId, project.id]);

  useEffect(() => { if (expanded) loadItems(); }, [expanded]);

  const handlePin = async (taskId, note) => {
    await api.pinGroupProjectItem(groupId, project.id, taskId, note);
    await loadItems();
  };

  const handleUnpin = async (pinId) => {
    await api.unpinGroupProjectItem(groupId, project.id, pinId);
    setItems(prev => prev.filter(i => i.pin_id !== pinId));
  };

  const handleStatusChange = async (status) => {
    try {
      const data = await api.updateGroupProject(groupId, project.id, { status });
      onProjectUpdate(data.project);
    } catch (e) {
      setError(e.message);
    }
  };

  const cfg = STATUS_CONFIG[project.status] || STATUS_CONFIG.active;

  return (
    <motion.div
      className={`gp-card${project.status === 'done' ? ' gp-card-done' : ''}${project.status === 'archived' ? ' gp-card-archived' : ''}`}
      style={{ '--proj-color': project.color }}
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22 }}
    >
      {/* Color bar */}
      <div className="gp-card-bar" style={{ background: project.color }}/>

      {/* Header */}
      <div className="gp-card-head">
        <button className="gp-card-expand" onClick={() => setExpanded(v => !v)}>
          {expanded ? <ChevronDown size={18}/> : <ChevronRight size={18}/>}
        </button>

        <div className="gp-card-title-area">
          <h4 className="gp-card-title">{project.title}</h4>
          {project.description && <p className="gp-card-desc">{project.description}</p>}
          <div className="gp-card-meta">
            <span className="gp-card-dates">
              <CalendarDays size={13}/> {fmtDate(project.date_start)} – {fmtDate(project.date_end)}
            </span>
            <span className="gp-card-duration">
              {totalDays} {totalDays === 1 ? 'Tag' : 'Tage'}
            </span>
            {project.status === 'active' && isOverdue && (
              <span className="gp-badge gp-badge-overdue">Überfällig</span>
            )}
            {endingSoon && (
              <span className="gp-badge gp-badge-soon">Endet bald</span>
            )}
            <span className="gp-status-badge" style={{ background: cfg.bg, color: cfg.color }}>
              {cfg.label}
            </span>
            <span className="gp-card-items-count">
              <Layers size={12}/> {Number(project.item_count) || 0} Items
            </span>
          </div>
          {expanded && items.length > 0 && <ProjectProgress items={items}/>}
        </div>

        <div className="gp-card-actions">
          {canEdit && (
            <>
              {project.status === 'active' && (
                <button className="gp-card-action-btn gp-done-btn" title="Als erledigt markieren"
                  onClick={() => handleStatusChange('done')}>
                  <CheckCircle2 size={16}/>
                </button>
              )}
              <button className="gp-card-action-btn" title="Bearbeiten" onClick={() => onEdit(project)}>
                <Pencil size={15}/>
              </button>
              <button className="gp-card-action-btn gp-del-btn" title="Löschen" onClick={() => onDelete(project.id)}>
                <Trash2 size={15}/>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Expanded body */}
      <AnimatePresence>
        {expanded && (
          <motion.div className="gp-card-body"
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>

            <div className="gp-card-body-inner">
              {loadingItems ? (
                <div className="gp-items-loading">Laden…</div>
              ) : items.length === 0 ? (
                <div className="gp-items-empty">
                  <Pin size={18} color="#C7C7CC"/>
                  <p>Noch keine Aufgaben oder Termine angeheftet.</p>
                </div>
              ) : (
                <div className="gp-items-list">
                  {items.map(item => (
                    <TaskPill
                      key={item.pin_id}
                      item={item}
                      canUnpin={isAdmin || item.pinned_by === userId || item.user_id === userId}
                      onUnpin={handleUnpin}
                    />
                  ))}
                </div>
              )}

              <button className="gp-pin-btn" onClick={() => setShowPinModal(true)}>
                <Pin size={14}/> Aufgabe/Termin anheften
              </button>

              {project.status === 'active' && canEdit && (
                <div className="gp-status-row">
                  <span>Status ändern:</span>
                  <button className="gp-status-chip" style={STATUS_CONFIG.done}
                    onClick={() => handleStatusChange('done')}>
                    <CheckCircle2 size={13}/> Abschließen
                  </button>
                  <button className="gp-status-chip" style={{ color: '#8E8E93' }}
                    onClick={() => handleStatusChange('archived')}>
                    Archivieren
                  </button>
                </div>
              )}
              {project.status !== 'active' && canEdit && (
                <div className="gp-status-row">
                  <button className="gp-status-chip" style={{ color: '#007AFF' }}
                    onClick={() => handleStatusChange('active')}>
                    Wieder aktivieren
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && <div className="gp-card-error"><AlertCircle size={13}/> {error}</div>}

      <AnimatePresence>
        {showPinModal && (
          <PinTaskModal
            groupId={groupId}
            projectId={project.id}
            groupTasks={groupTasks}
            pinnedIds={pinnedIds}
            onPin={handlePin}
            onClose={() => setShowPinModal(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ProjectForm({ initial, onSave, onCancel, loading, error }) {
  const today = new Date().toISOString().slice(0,10);
  const [title,      setTitle]      = useState(initial?.title       || '');
  const [desc,       setDesc]       = useState(initial?.description  || '');
  const [color,      setColor]      = useState(initial?.color        || '#007AFF');
  const [dateStart,  setDateStart]  = useState(initial?.date_start   ? String(initial.date_start).slice(0,10) : today);
  const [dateEnd,    setDateEnd]    = useState(initial?.date_end     ? String(initial.date_end).slice(0,10)   : today);
  const [formErr,    setFormErr]    = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) { setFormErr('Bitte einen Titel eingeben.'); return; }
    if (!dateStart || !dateEnd) { setFormErr('Bitte Start- und Enddatum angeben.'); return; }
    if (dateStart > dateEnd) { setFormErr('Startdatum muss vor dem Enddatum liegen.'); return; }
    setFormErr('');
    onSave({ title: title.trim(), description: desc.trim(), color, date_start: dateStart, date_end: dateEnd });
  };

  return (
    <motion.div className="gp-form-overlay" onClick={onCancel}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="gp-form-modal" onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, y: 28, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.24 }}>
        <div className="gp-modal-head">
          <h3><FolderKanban size={17}/> {initial ? 'Projekt bearbeiten' : 'Neues Projekt'}</h3>
          <button className="gp-modal-close" onClick={onCancel}><X size={17}/></button>
        </div>

        <form className="gp-form" onSubmit={handleSubmit}>
          <div className="gp-form-field">
            <label>Titel *</label>
            <input className="gp-form-input" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="z.B. Sommerfest 2026" maxLength={200} autoFocus/>
          </div>

          <div className="gp-form-field">
            <label>Beschreibung</label>
            <textarea className="gp-form-input gp-form-textarea" value={desc}
              onChange={e => setDesc(e.target.value)} placeholder="Was wird in diesem Projekt geplant?" rows={3}/>
          </div>

          <div className="gp-form-row">
            <div className="gp-form-field">
              <label>Von *</label>
              <input className="gp-form-input" type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} required/>
            </div>
            <div className="gp-form-field">
              <label>Bis *</label>
              <input className="gp-form-input" type="date" value={dateEnd} min={dateStart} onChange={e => setDateEnd(e.target.value)} required/>
            </div>
          </div>

          <div className="gp-form-field">
            <label>Farbe</label>
            <div className="gp-color-picker">
              {PROJECT_COLORS.map(c => (
                <button type="button" key={c}
                  className={`gp-color-dot${color === c ? ' selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          {(formErr || error) && (
            <div className="bq-auth-error">
              <AlertCircle size={14}/>
              <span>{formErr || error}</span>
            </div>
          )}

          <div className="gp-modal-footer">
            <button type="button" className="gp-modal-cancel" onClick={onCancel}>Abbrechen</button>
            <button type="submit" className="gp-modal-confirm" disabled={loading}>
              {loading ? <span className="bq-auth-spinner"/> : <>{initial ? 'Speichern' : <><Plus size={14}/> Erstellen</>}</>}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

export default function GroupProjectBoard({ groupId, groupTasks, isAdmin, userId }) {
  const [projects,    setProjects]    = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [showCreate,  setShowCreate]  = useState(false);
  const [editProject, setEditProject] = useState(null);
  const [filter,      setFilter]      = useState('active'); // 'all' | 'active' | 'done' | 'archived'

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getGroupProjects(groupId);
      setProjects(data.projects || []);
    } catch { setProjects([]); }
    finally { setLoading(false); }
  }, [groupId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (data) => {
    setSaving(true); setError('');
    try {
      const res = await api.createGroupProject(groupId, data);
      setProjects(prev => [res.project, ...prev]);
      setShowCreate(false);
    } catch (e) {
      setError(e.message || 'Fehler beim Erstellen');
    } finally { setSaving(false); }
  };

  const handleEdit = async (data) => {
    setSaving(true); setError('');
    try {
      const res = await api.updateGroupProject(groupId, editProject.id, data);
      setProjects(prev => prev.map(p => p.id === res.project.id ? res.project : p));
      setEditProject(null);
    } catch (e) {
      setError(e.message || 'Fehler beim Speichern');
    } finally { setSaving(false); }
  };

  const handleDelete = async (projectId) => {
    if (!window.confirm('Projekt wirklich löschen? Alle angehefteten Items werden gelöst.')) return;
    try {
      await api.deleteGroupProject(groupId, projectId);
      setProjects(prev => prev.filter(p => p.id !== projectId));
    } catch (e) {
      setError(e.message);
    }
  };

  const handleProjectUpdate = (updated) => {
    setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
  };

  const filtered = useMemo(() => {
    if (filter === 'all') return projects;
    return projects.filter(p => p.status === filter);
  }, [projects, filter]);

  const counts = useMemo(() => ({
    active:   projects.filter(p => p.status === 'active').length,
    done:     projects.filter(p => p.status === 'done').length,
    archived: projects.filter(p => p.status === 'archived').length,
  }), [projects]);

  return (
    <div className="gp-board">
      {/* Toolbar */}
      <div className="gp-board-toolbar">
        <div className="gp-board-title">
          <FolderKanban size={18} color="#5856D6"/>
          <h3>Projekte</h3>
          <span className="gp-board-total">{projects.length}</span>
        </div>
        <div className="gp-board-filters">
          {['all', 'active', 'done', 'archived'].map(f => (
            <button
              key={f}
              className={`gp-filter-chip${filter === f ? ' active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all'      ? `Alle (${projects.length})`           : ''}
              {f === 'active'   ? `Aktiv (${counts.active})`            : ''}
              {f === 'done'     ? `Abgeschlossen (${counts.done})`      : ''}
              {f === 'archived' ? `Archiviert (${counts.archived})`     : ''}
            </button>
          ))}
        </div>
        <button className="gp-new-btn" onClick={() => setShowCreate(true)}>
          <Plus size={15}/> Neues Projekt
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="gp-loading">
          <span className="bq-auth-spinner" style={{ width: 22, height: 22, borderWidth: 2 }}/>
          <span>Projekte laden…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="gp-empty">
          <FolderKanban size={36} color="#C7C7CC"/>
          <p>{filter === 'all' ? 'Noch keine Projekte in dieser Gruppe.' : `Keine ${STATUS_CONFIG[filter]?.label || ''}-Projekte.`}</p>
          {filter === 'all' && (
            <button className="gp-new-btn" onClick={() => setShowCreate(true)}>
              <Plus size={14}/> Erstes Projekt erstellen
            </button>
          )}
        </div>
      ) : (
        <div className="gp-project-list">
          <AnimatePresence>
            {filtered.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                groupId={groupId}
                groupTasks={groupTasks}
                isAdmin={isAdmin}
                userId={userId}
                onEdit={setEditProject}
                onDelete={handleDelete}
                onProjectUpdate={handleProjectUpdate}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {showCreate && (
          <ProjectForm
            key="create"
            onSave={handleCreate}
            onCancel={() => { setShowCreate(false); setError(''); }}
            loading={saving}
            error={error}
          />
        )}
        {editProject && (
          <ProjectForm
            key={`edit-${editProject.id}`}
            initial={editProject}
            onSave={handleEdit}
            onCancel={() => { setEditProject(null); setError(''); }}
            loading={saving}
            error={error}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
