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
      set((s) => ({ tasks: [data.task, ...s.tasks] }));
      get().addToast('✅ Aufgabe erstellt');
      return data.task;
    } catch (err) {
      get().addToast('❌ ' + err.message, 'error');
      return null;
    }
  },

  aiCreateTask: async (input) => {
    try {
      const data = await api.parseAndCreateTask(input);
      set((s) => ({ tasks: [data.task, ...s.tasks] }));
      const cat = data.parsed.category ? ` → ${data.parsed.category}` : '';
      get().addToast(`✅ "${data.parsed.title}"${cat} gespeichert`);
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
      set((s) => ({
        tasks: s.tasks.map((t) => (t.id === id ? data.task : t)),
      }));
      const task = data.task;
      get().addToast(task.completed ? '✅ Erledigt!' : '↩️ Wieder offen');
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
