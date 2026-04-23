import { create } from 'zustand';
import { api } from '../utils/api';

const FRIENDS_CACHE_KEY = 'taski_friends_cache_v1';

function readFriendsCache() {
  try {
    const raw = localStorage.getItem(FRIENDS_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      friends: Array.isArray(parsed.friends) ? parsed.friends : [],
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
    };
  } catch {
    return null;
  }
}

function writeFriendsCache(state) {
  try {
    localStorage.setItem(FRIENDS_CACHE_KEY, JSON.stringify({
      friends: state.friends || [],
      pending: state.pending || [],
    }));
  } catch {
    // ignore
  }
}

const cached = readFriendsCache();

export const useFriendsStore = create((set, get) => ({
  friends: cached?.friends || [],
  pending: cached?.pending || [],
  loading: false,
  error: null,

  fetchFriends: async () => {
    set({ loading: true });
    try {
      const data = await api.getFriends();
      const accepted = (data.friends || []).filter(f => f.status === 'accepted');
      const pending = (data.friends || []).filter(f => f.status === 'pending');
      set({ friends: accepted, pending, loading: false, error: null });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  inviteFriend: async (email) => {
    try {
      await api.inviteFriend(email);
      get().fetchFriends();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  acceptFriend: async (id) => {
    try {
      await api.acceptFriend(id);
      get().fetchFriends();
    } catch (err) {
      set({ error: err.message });
    }
  },

  declineFriend: async (id) => {
    try {
      await api.declineFriend(id);
      get().fetchFriends();
    } catch (err) {
      set({ error: err.message });
    }
  },

  removeFriend: async (id) => {
    try {
      await api.removeFriend(id);
      get().fetchFriends();
    } catch (err) {
      set({ error: err.message });
    }
  },

  redeemInviteCode: async (code) => {
    try {
      const data = await api.redeemInviteCode(code);
      get().fetchFriends();
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
}));

useFriendsStore.subscribe((state) => {
  writeFriendsCache(state);
});
