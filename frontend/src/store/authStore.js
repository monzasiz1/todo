import { create } from 'zustand';
import { api, clearApiCacheForCurrentUser } from '../utils/api';

const TASK_CACHE_KEY = 'taski_tasks_cache_v1';

export const useAuthStore = create((set) => ({
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  token: localStorage.getItem('token') || null,
  loading: false,
  error: null,

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const data = await api.login(email, password);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      set({ user: data.user, token: data.token, loading: false });
      return true;
    } catch (err) {
      set({ error: err.message, loading: false });
      return false;
    }
  },

  register: async (name, email, password) => {
    set({ loading: true, error: null });
    try {
      const data = await api.register(name, email, password);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      set({ user: data.user, token: data.token, loading: false });
      return true;
    } catch (err) {
      set({ error: err.message, loading: false });
      return false;
    }
  },

  checkAuth: async () => {
    try {
      const data = await api.getMe();
      set({ user: data.user, error: null });
    } catch (err) {
      // Nur bei echter 401 Session löschen. Bei Offline/Netzwerkfehler Session behalten.
      if (err?.status === 401 || err?.message === 'Nicht autorisiert') {
        clearApiCacheForCurrentUser();
        set({ user: null, token: null });
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem(TASK_CACHE_KEY);
        return;
      }

      set({ error: 'Offline-Modus aktiv. Du bleibst eingeloggt.' });
    }
  },

  logout: () => {
    clearApiCacheForCurrentUser();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem(TASK_CACHE_KEY);
    set({ user: null, token: null });
    window.location.href = '/login';
  },

  setUser: (user) => {
    localStorage.setItem('user', JSON.stringify(user));
    set({ user });
  },

  clearError: () => set({ error: null }),
}));
