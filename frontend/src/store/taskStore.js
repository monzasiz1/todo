import { create } from 'zustand';
import { api } from '../utils/api';

export const useTaskStore = create((set, get) => ({
  tasks: [],
  taskSummary: { open: 0, completed: 0, today: 0, urgent: 0 },
  categories: [],
  loading: false,
  error: null,
  lastTasksFetchAt: 0,
  lastTasksFetchKey: '',
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
  fetchTasks: async (params = {}, options = {}) => {
    const fetchKey = JSON.stringify(params || {});
    const now = Date.now();
    const maxAgeMs = 15000;
    const force = options?.force === true;
    const sameParams = get().lastTasksFetchKey === fetchKey;
    const stillFresh = now - (get().lastTasksFetchAt || 0) < maxAgeMs;

    if (!force && sameParams && stillFresh) {
      return;
    }

    set({ loading: true });
    try {
      const data = await api.getTasks(params);
      set({
        tasks: data.tasks,
        loading: false,
        lastTasksFetchAt: Date.now(),
        lastTasksFetchKey: fetchKey,
      });
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

  fetchTasksSummary: async () => {
    try {
      const data = await api.getTasksSummary();
      set({
        taskSummary: {
          open: Number(data.open || 0),
          completed: Number(data.completed || 0),
          today: Number(data.today || 0),
          urgent: Number(data.urgent || 0),
        },
      });
      return data;
    } catch (err) {
      set({ error: err.message });
      return null;
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
      // Step 1: Classify intent
      const smart = await api.smartAction(input);

      // Delete
      if (smart.intent === 'delete') {
        if (smart.success && smart.deleted_task) {
          set((s) => ({ tasks: s.tasks.filter((t) => t.id !== smart.deleted_task.id && t.recurrence_parent_id !== smart.deleted_task.id) }));
          get().addToast(`🗑️ ${smart.message}`);
        } else {
          get().addToast(`⚠️ ${smart.message}`, 'error');
        }
        return smart;
      }

      // Move
      if (smart.intent === 'move') {
        if (smart.success && smart.task) {
          set((s) => ({
            tasks: s.tasks.map((t) => t.id === smart.task.id ? { ...t, ...smart.task } : t),
          }));
          get().addToast(`📅 ${smart.message}`);
        } else {
          get().addToast(`⚠️ ${smart.message}`, 'error');
        }
        return smart;
      }

      // Update
      if (smart.intent === 'update') {
        if (smart.success && smart.task) {
          set((s) => ({
            tasks: s.tasks.map((t) => t.id === smart.task.id ? { ...t, ...smart.task } : t),
          }));
          get().addToast(`✏️ ${smart.message}`);
        } else {
          get().addToast(`⚠️ ${smart.message}`, 'error');
        }
        return smart;
      }

      // Attach – return task info so frontend can open file picker
      if (smart.intent === 'attach') {
        if (smart.success && smart.task) {
          get().addToast(`📎 ${smart.message}`);
        } else {
          get().addToast(`⚠️ ${smart.message}`, 'error');
        }
        return smart;
      }

      // Query – return answer for UI to display as chat bubble
      if (smart.intent === 'query') {
        return smart;
      }

      // Create (default / redirect)
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
      get().addToast('❌ ' + (err.message || 'Fehler'), 'error');
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
        tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...data.task } : t)),
      }));
      const current = get().tasks.find((t) => t.id === id);
      return current || data.task;
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

  createCategory: async (category) => {
    try {
      const data = await api.createCategory(category);
      set((s) => ({ categories: [...s.categories, data.category].sort((a, b) => a.name.localeCompare(b.name)) }));
      get().addToast('✅ Kategorie erstellt');
      return data.category;
    } catch (err) {
      get().addToast('❌ ' + err.message, 'error');
      return null;
    }
  },

  updateCategory: async (id, updates) => {
    try {
      const data = await api.updateCategory(id, updates);
      set((s) => ({
        categories: s.categories.map((c) => (c.id === id ? data.category : c)).sort((a, b) => a.name.localeCompare(b.name)),
      }));
      get().addToast('✅ Kategorie aktualisiert');
      return data.category;
    } catch (err) {
      get().addToast('❌ ' + err.message, 'error');
      return null;
    }
  },

  deleteCategory: async (id) => {
    try {
      await api.deleteCategory(id);
      set((s) => ({
        categories: s.categories.filter((c) => c.id !== id),
        tasks: s.tasks.map((t) => (t.category_id === id ? { ...t, category_id: null, category_name: null, category_color: null } : t)),
      }));
      get().addToast('🗑️ Kategorie gelöscht');
      return true;
    } catch (err) {
      get().addToast('❌ ' + err.message, 'error');
      return false;
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
