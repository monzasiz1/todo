import { create } from 'zustand';
import { api } from '../utils/api';
import { getAllQueued, removeQueued, incrementRetry } from '../utils/offlineQueue';

const TASK_CACHE_KEY = 'beequ_tasks_cache_v1';
const TASK_RANGE_CACHE_KEY = 'beequ_tasks_range_cache_v1';
const TASK_RANGE_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const TASK_RANGE_CACHE_MAX_ENTRIES = 12;

function readCachedTasks() {
  try {
    const raw = localStorage.getItem(TASK_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedTasks(tasks) {
  try {
    localStorage.setItem(TASK_CACHE_KEY, JSON.stringify(Array.isArray(tasks) ? tasks : []));
  } catch {
    // ignore quota/security errors
  }
}

function readCachedTaskRanges() {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return {};
    const raw = sessionStorage.getItem(TASK_RANGE_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const now = Date.now();
    return Object.fromEntries(
      Object.entries(parsed).filter(([, entry]) => {
        if (!entry || typeof entry !== 'object') return false;
        if (!Array.isArray(entry.tasks)) return false;
        if (typeof entry.fetchedAt !== 'number') return false;
        return now - entry.fetchedAt <= TASK_RANGE_CACHE_MAX_AGE_MS;
      })
    );
  } catch {
    return {};
  }
}

function writeCachedTaskRanges(rangeCache) {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    const normalized = Object.entries(rangeCache || {})
      .filter(([, entry]) => entry && Array.isArray(entry.tasks) && typeof entry.fetchedAt === 'number')
      .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
      .slice(0, TASK_RANGE_CACHE_MAX_ENTRIES);
    sessionStorage.setItem(TASK_RANGE_CACHE_KEY, JSON.stringify(Object.fromEntries(normalized)));
  } catch {
    // ignore quota/security errors
  }
}

function buildNextRangeCache(prevCache, key, tasks) {
  const now = Date.now();
  const next = {
    ...(prevCache || {}),
    [key]: { tasks: Array.isArray(tasks) ? tasks : [], fetchedAt: now },
  };

  return Object.fromEntries(
    Object.entries(next)
      .filter(([, entry]) => now - (entry.fetchedAt || 0) <= TASK_RANGE_CACHE_MAX_AGE_MS)
      .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
      .slice(0, TASK_RANGE_CACHE_MAX_ENTRIES)
  );
}

function emitTasksChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('beequ:tasks-changed'));
  }
}

function buildTaskRestorePayload(task) {
  if (!task) return null;

  return {
    title: task.title,
    description: task.description || '',
    date: task.date || null,
    date_end: task.date_end || null,
    time: task.time || null,
    time_end: task.time_end || null,
    priority: task.priority || 'medium',
    category_id: task.category_id || null,
    reminder_at: task.reminder_at || null,
    recurrence_rule: task.recurrence_rule || null,
    recurrence_interval: task.recurrence_interval || null,
    recurrence_end: task.recurrence_end || null,
    group_id: task.group_id || null,
    group_category_id: task.group_category_id || null,
    visibility: task.visibility || 'private',
    permissions: task.permissions || null,
    type: task.type || 'task',
  };
}

export const useTaskStore = create((set, get) => ({
  tasks: readCachedTasks(),
  rangeCache: readCachedTaskRanges(),
  taskSummary: { open: 0, completed: 0, today: 0, urgent: 0 },
  categories: [],
  loading: false,
  error: null,
  lastTasksFetchAt: 0,
  lastTasksFetchKey: '',
  filter: { category: null, priority: null, completed: null, search: '' },
  toasts: [],

  // Toast management
  addToast: (message, type = 'success', options = {}) => {
    const id = Date.now();
    const duration = typeof options.duration === 'number' ? options.duration : 4000;
    const toast = {
      id,
      message,
      type,
      duration,
      actionLabel: options.actionLabel || null,
      onAction: typeof options.onAction === 'function' ? options.onAction : null,
    };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, duration);
  },
  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  restoreDeletedTask: async (task) => {
    const payload = buildTaskRestorePayload(task);
    if (!payload) return false;

    try {
      const data = await api.createTask(payload);
      const restored = Array.isArray(data.created_tasks) && data.created_tasks.length > 0
        ? data.created_tasks
        : [data.task];
      set((s) => ({ tasks: [...restored, ...s.tasks], rangeCache: {} }));
      writeCachedTaskRanges({});
      emitTasksChanged();
      get().addToast('Löschen rückgängig gemacht');
      return true;
    } catch (err) {
      get().addToast('❌ Wiederherstellen fehlgeschlagen', 'error');
      return false;
    }
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

    set({ loading: get().tasks.length === 0, error: null });
    try {
      // Keep one canonical task source for dashboard/calendar sync.
      // Only explicit lite mode may use the dashboard endpoint.
      const useDashboardEndpoint = params?.lite === 'true' || params?.lite === true;
      const requestParams = { ...params };
      delete requestParams.dashboard;
      const data = useDashboardEndpoint ? await api.getDashboardTasks(requestParams) : await api.getTasks(requestParams);
      set({
        tasks: data.tasks,
        rangeCache: {},
        loading: false,
        lastTasksFetchAt: Date.now(),
        lastTasksFetchKey: fetchKey,
      });
      writeCachedTasks(data.tasks);
      writeCachedTaskRanges({});
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  getCachedTasksRange: (start, end, maxAgeMs = 30000) => {
    const key = `${String(start).slice(0, 10)}|${String(end).slice(0, 10)}`;
    const entry = get().rangeCache[key];
    if (!entry) return null;
    if (Date.now() - (entry.fetchedAt || 0) > maxAgeMs) return null;
    return Array.isArray(entry.tasks) ? entry.tasks : null;
  },

  primeTasksRangeCache: (start, end, tasks) => {
    const key = `${String(start).slice(0, 10)}|${String(end).slice(0, 10)}`;
    set((s) => {
      const rangeCache = buildNextRangeCache(s.rangeCache, key, tasks);
      writeCachedTaskRanges(rangeCache);
      return { rangeCache };
    });
  },

  fetchTasksRange: async (start, end, options = {}) => {
    const key = `${String(start).slice(0, 10)}|${String(end).slice(0, 10)}`;
    const force = options?.force === true;
    const cached = get().getCachedTasksRange(start, end, options?.maxAgeMs ?? 30000);
    if (!force && cached) {
      return cached;
    }

    try {
      const data = await api.getTasksRange(start, end);
      set((s) => {
        const rangeCache = buildNextRangeCache(s.rangeCache, key, data.tasks);
        writeCachedTaskRanges(rangeCache);
        return { rangeCache };
      });
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

      // Offline: task wurde in Queue eingereiht → optimistisch als Platzhalter einfügen
      if (data?.__queued) {
        const tempTask = {
          id: data.tempId,
          ...task,
          completed: false,
          __offline: true,
        };
        set((s) => ({ tasks: [tempTask, ...s.tasks], rangeCache: {} }));
        writeCachedTaskRanges({});
        get().addToast('📵 Offline gespeichert – wird synchronisiert sobald du online bist', 'info');
        return { task: tempTask };
      }

      const created = Array.isArray(data.created_tasks) && data.created_tasks.length > 0
        ? data.created_tasks
        : [data.task];
      set((s) => ({ tasks: [...created, ...s.tasks], rangeCache: {} }));
      writeCachedTaskRanges({});
      emitTasksChanged();
      const groupMsg = data.group?.name ? ` · Gruppe: ${data.group.name}` : '';
      const recurrenceMsg = (data.created_count || 0) > 1
        ? ` · ${data.created_count} Termine erstellt`
        : '';
      const typeMsg = task.type === 'event' ? '📅 Termin' : '✅ Aufgabe';
      get().addToast(`${typeMsg} erstellt${groupMsg}${recurrenceMsg}`);
        // Invalidate dashboard cache to ensure Dashboard stays in sync with new task
        set((s) => ({ lastTasksFetchKey: '', lastTasksFetchAt: 0 }));
      return data;
    } catch (err) {
      get().addToast('❌ ' + err.message, 'error');
      return null;
    }
  },

  /**
   * Offline-Queue abspielen: alle wartenden Requests an die API senden.
   * Wird aufgerufen sobald die App wieder online ist.
   */
  syncOfflineQueue: async () => {
    const entries = await getAllQueued();
    if (entries.length === 0) return;

    get().addToast(`🔄 ${entries.length} Offline-Änderung(en) werden synchronisiert…`, 'info');

    for (const entry of entries) {
      try {
        // Direkt per fetch ohne nochmal in Queue einzureihen
        const token = localStorage.getItem('token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`/api${entry.endpoint}`, {
          method: entry.method,
          headers,
          body: entry.body ? JSON.stringify(entry.body) : undefined,
        });

        if (res.ok) {
          await removeQueued(entry.id);
          // Temp-Task aus Store entfernen wenn vorhanden (wird durch fetchTasks ersetzt)
          if (entry.tempId) {
            set((s) => ({ tasks: s.tasks.filter((t) => t.id !== entry.tempId) }));
          }
        } else if (res.status === 401) {
          // Auth-Fehler: Queue leeren macht keinen Sinn
          break;
        } else {
          await incrementRetry(entry.id);
        }
      } catch {
        await incrementRetry(entry.id);
      }
    }

    // Tasks neu laden um echte IDs zu bekommen
    await get().fetchTasks({ dashboard: 'true' }, { force: true });
    get().addToast('✅ Offline-Änderungen synchronisiert');
  },

  aiCreateTask: async (input) => {
    try {
      // Step 1: Classify intent
      const smart = await api.smartAction(input);

      // Delete
      if (smart.intent === 'delete') {
        if (smart.success && smart.deleted_task) {
          set((s) => ({ tasks: s.tasks.filter((t) => t.id !== smart.deleted_task.id && t.recurrence_parent_id !== smart.deleted_task.id), rangeCache: {} }));
          writeCachedTaskRanges({});
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
            rangeCache: {},
          }));
          writeCachedTaskRanges({});
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
            rangeCache: {},
          }));
          writeCachedTaskRanges({});
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
      set((s) => ({ tasks: [...created, ...s.tasks], rangeCache: {} }));
      writeCachedTaskRanges({});
      emitTasksChanged();
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
      if (data.conflict_info?.has_conflict) {
        get().addToast(`⚠️ ${data.conflict_info.message}`, 'error');
      }
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
      console.log(`[taskStore] Updating task ${id} with:`, updates);
      const data = await api.updateTask(id, updates);
      console.log(`[taskStore] Update successful, got:`, data.task);
      
      // Update store immediately (optimistic update)
      set((s) => ({
        tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...data.task } : t)),
        rangeCache: {},
      }));
      writeCachedTaskRanges({});
      
      // Reset fetch cache to force next load from server (ensures consistency)
      set({ lastTasksFetchKey: '', lastTasksFetchAt: 0 });
      console.log(`[taskStore] Invalidated fetch cache, next load will fetch fresh data`);
      emitTasksChanged();
      
      const current = get().tasks.find((t) => t.id === id);
      return current || data.task;
    } catch (err) {
      console.error('[taskStore] updateTask error:', err);
      get().addToast('❌ ' + err.message, 'error');
      // On error: also reset cache to ensure fresh data on retry
      set({ lastTasksFetchKey: '', lastTasksFetchAt: 0 });
      return null;
    }
  },

  toggleTask: async (id) => {
    // Optimistic update
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, completed: !t.completed } : t
      ),
      rangeCache: {},
    }));
    writeCachedTaskRanges({});
    try {
      const data = await api.toggleTask(id);
      let tasks = get().tasks.map((t) => (t.id === id ? data.task : t));
      // If a recurring task generated a next occurrence, add it
      if (data.nextTask) {
        tasks = [data.nextTask, ...tasks];
      }
      set({ tasks, rangeCache: {} });
      writeCachedTaskRanges({});
      emitTasksChanged();
      const task = data.task;
      if (task.completed && data.nextTask) {
        get().addToast('✅ Erledigt! 🔄 Nächste Wiederholung erstellt');
      } else {
        get().addToast(task.completed ? '✅ Erledigt!' : '↩️ Wieder offen');
      }
      return data.task;
    } catch (err) {
      // Revert
      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === id ? { ...t, completed: !t.completed } : t
        ),
      }));
      get().addToast('❌ ' + err.message, 'error');
      return null;
    }
  },

  reorderTasks: async (taskIds) => {
    try {
      await api.reorderTasks(taskIds);
      emitTasksChanged();
    } catch (err) {
      get().addToast('❌ ' + err.message, 'error');
    }
  },

  deleteTask: async (id) => {
    // Optimistic removal
    const prev = get().tasks;
    const deletedTask = prev.find((task) => task.id === id) || null;
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id), rangeCache: {} }));
    writeCachedTaskRanges({});
    try {
      await api.deleteTask(id);
      get().addToast('Gelöscht', 'info', deletedTask ? {
        actionLabel: 'Rückgängig',
        duration: 6000,
        onAction: async () => {
          await get().restoreDeletedTask(deletedTask);
        },
      } : undefined);
      emitTasksChanged();
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

// Tasks dauerhaft lokal halten, damit sie nach App-Neustart offline sichtbar bleiben.
useTaskStore.subscribe((state) => {
  writeCachedTasks(state.tasks);
});

