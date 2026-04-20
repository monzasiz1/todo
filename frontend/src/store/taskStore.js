import { create } from 'zustand';
import { api } from '../utils/api';

export const useTaskStore = create((set, get) => ({
  tasks: [],
  categories: [],
  loading: false,
  error: null,
  filter: { category: null, priority: null, completed: null, search: '' },
  toasts: [],

  // Toast management
  addToast: (message, type = 'success') => {
    const id = Date.now();
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3000);
  },

  // Task CRUD
  fetchTasks: async (params = {}) => {
    set({ loading: true });
    try {
      const data = await api.getTasks(params);
      set({ tasks: data.tasks, loading: false });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  fetchTasksRange: async (start, end) => {
    try {
      const data = await api.getTasksRange(start, end);
      return data.tasks;
    } catch (err) {
      set({ error: err.message });
      return [];
    }
  },

  createTask: async (task) => {
    try {
      const data = await api.createTask(task);
      const created = Array.isArray(data.created_tasks) && data.created_tasks.length > 0
        ? data.created_tasks
        : [data.task];
      set((s) => ({ tasks: [...created, ...s.tasks] }));
      const groupMsg = data.group?.name ? ` · Gruppe: ${data.group.name}` : '';
      const recurrenceMsg = (data.created_count || 0) > 1
        ? ` · ${data.created_count} Termine erstellt`
        : '';
      const typeMsg = task.type === 'event' ? '📅 Termin' : '✅ Aufgabe';
      get().addToast(`${typeMsg} erstellt${groupMsg}${recurrenceMsg}`);
      return data;
    } catch (err) {
      get().addToast('❌ ' + err.message, 'error');
      return null;
    }
  },

  aiCreateTask: async (input) => {
    try {
      const data = await api.parseAndCreateTask(input);
      const created = Array.isArray(data.created_tasks) && data.created_tasks.length > 0
        ? data.created_tasks
        : [data.task];
      set((s) => ({ tasks: [...created, ...s.tasks] }));
      const cat = data.parsed.category ? ` → ${data.parsed.category}` : '';
      const range = data.parsed.date_end ? ` (${data.parsed.date} bis ${data.parsed.date_end})` : '';
      const shared = data.shared_with && data.shared_with.length > 0
        ? ` 👥 Geteilt mit ${data.shared_with.join(', ')}`
        : '';
      const groupMsg = data.group ? ` 📋 Gruppe: ${data.group.name}` : '';
      const recMsg = (data.created_count || 0) > 1
        ? ` 🔄 ${data.created_count} Termine erstellt`
        : (data.parsed.recurrence_rule ? ' 🔄 Wiederkehrend' : '');
      const shareErr = data.parsed.share_error ? `\n⚠️ ${data.parsed.share_error}` : '';
      get().addToast(`✅ "${data.parsed.title}"${cat}${range}${shared}${groupMsg}${recMsg} gespeichert${shareErr}`);
      return data;
    } catch (err) {
      get().addToast('❌ ' + err.message, 'error');
      return null;
    }
  },

  aiParseOnly: async (input) => {
    try {
      const data = await api.parseInput(input);
      return data.parsed;
    } catch (err) {
      get().addToast('❌ ' + err.message, 'error');
      return null;
    }
  },

  updateTask: async (id, updates) => {
    try {
      const data = await api.updateTask(id, updates);
      set((s) => ({
        tasks: s.tasks.map((t) => (t.id === id ? data.task : t)),
      }));
      return data.task;
    } catch (err) {
      get().addToast('❌ ' + err.message, 'error');
      return null;
    }
  },

  toggleTask: async (id) => {
    // Optimistic update
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, completed: !t.completed } : t
      ),
    }));
    try {
      const data = await api.toggleTask(id);
      let tasks = get().tasks.map((t) => (t.id === id ? data.task : t));
      // If a recurring task generated a next occurrence, add it
      if (data.nextTask) {
        tasks = [data.nextTask, ...tasks];
      }
      set({ tasks });
      const task = data.task;
      if (task.completed && data.nextTask) {
        get().addToast('✅ Erledigt! 🔄 Nächste Wiederholung erstellt');
      } else {
        get().addToast(task.completed ? '✅ Erledigt!' : '↩️ Wieder offen');
      }
    } catch (err) {
      // Revert
      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === id ? { ...t, completed: !t.completed } : t
        ),
      }));
      get().addToast('❌ ' + err.message, 'error');
    }
  },

  reorderTasks: async (taskIds) => {
    try {
      await api.reorderTasks(taskIds);
    } catch (err) {
      get().addToast('❌ ' + err.message, 'error');
    }
  },

  deleteTask: async (id) => {
    // Optimistic removal
    const prev = get().tasks;
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
    try {
      await api.deleteTask(id);
      get().addToast('🗑️ Gelöscht');
    } catch (err) {
      set({ tasks: prev });
      get().addToast('❌ ' + err.message, 'error');
    }
  },

  // Categories
  fetchCategories: async () => {
    try {
      const data = await api.getCategories();
      set({ categories: data.categories });
    } catch (err) {
      set({ error: err.message });
    }
  },

  // Filters
  setFilter: (key, value) => {
    set((s) => ({ filter: { ...s.filter, [key]: value } }));
  },

  clearFilters: () => {
    set({ filter: { category: null, priority: null, completed: null, search: '' } });
  },

  // Get filtered tasks
  getFilteredTasks: () => {
    const { tasks, filter } = get();
    return tasks.filter((t) => {
      if (filter.category && t.category_id !== filter.category) return false;
      if (filter.priority && t.priority !== filter.priority) return false;
      if (filter.completed !== null && t.completed !== filter.completed) return false;
      if (filter.search && !t.title.toLowerCase().includes(filter.search.toLowerCase())) return false;
      return true;
    });
  },
}));
