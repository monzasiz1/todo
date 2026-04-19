import { useTaskStore } from '../store/taskStore';
import TaskCard from './TaskCard';
import { AnimatePresence, Reorder } from 'framer-motion';
import { ClipboardList } from 'lucide-react';
import { useState } from 'react';

export default function TaskList() {
  const { getFilteredTasks, reorderTasks, filter, setFilter, clearFilters } = useTaskStore();
  const tasks = getFilteredTasks();
  const [showCompleted, setShowCompleted] = useState(false);

  const activeTasks = tasks.filter((t) => !t.completed);
  const completedTasks = tasks.filter((t) => t.completed);

  const handleReorder = (newOrder) => {
    const ids = newOrder.map((t) => t.id);
    reorderTasks(ids);
  };

  const priorities = [
    { value: null, label: 'Alle' },
    { value: 'urgent', label: '🔴 Dringend' },
    { value: 'high', label: '🟠 Hoch' },
    { value: 'medium', label: '🔵 Mittel' },
    { value: 'low', label: '🟢 Niedrig' },
  ];

  return (
    <div>
      {/* Filter Bar */}
      <div className="filter-bar">
        {priorities.map((p) => (
          <button
            key={p.value || 'all'}
            className={`filter-btn ${filter.priority === p.value ? 'active' : ''}`}
            onClick={() => setFilter('priority', p.value)}
          >
            {p.label}
          </button>
        ))}
        <input
          type="text"
          className="filter-search"
          placeholder="🔍 Suchen..."
          value={filter.search}
          onChange={(e) => setFilter('search', e.target.value)}
        />
      </div>

      {/* Active Tasks */}
      {activeTasks.length > 0 ? (
        <div className="task-section">
          <div className="task-section-header">
            <span className="task-section-title">Offen</span>
            <span className="task-section-count">{activeTasks.length}</span>
          </div>
          <Reorder.Group
            axis="y"
            values={activeTasks}
            onReorder={handleReorder}
            className="task-list"
            style={{ listStyle: 'none' }}
          >
            <AnimatePresence mode="popLayout">
              {activeTasks.map((task, i) => (
                <Reorder.Item key={task.id} value={task} style={{ listStyle: 'none' }}>
                  <TaskCard task={task} index={i} />
                </Reorder.Item>
              ))}
            </AnimatePresence>
          </Reorder.Group>
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state-icon">
            <ClipboardList size={36} />
          </div>
          <h3>Keine Aufgaben</h3>
          <p>Nutze die KI-Eingabe oder die manuelle Eingabe oben, um deine erste Aufgabe zu erstellen.</p>
        </div>
      )}

      {/* Completed Tasks Toggle */}
      {completedTasks.length > 0 && (
        <div className="task-section" style={{ marginTop: 24 }}>
          <div className="task-section-header">
            <button
              className="task-section-title"
              onClick={() => setShowCompleted(!showCompleted)}
              style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0, font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit' }}
            >
              {showCompleted ? '▾' : '▸'} Erledigt
            </button>
            <span className="task-section-count">{completedTasks.length}</span>
          </div>
          <AnimatePresence>
            {showCompleted && (
              <div className="task-list">
                {completedTasks.map((task, i) => (
                  <TaskCard key={task.id} task={task} index={i} />
                ))}
              </div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
