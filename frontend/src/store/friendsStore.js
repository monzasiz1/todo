import { create } from 'zustand';
import { api } from '../utils/api';

const FRIENDS_CACHE_KEY = 'beequ_friends_cache_v1';

function getFriendsCacheKey() {
  try {
    const token = localStorage.getItem('token') || 'anon';
    return `${FRIENDS_CACHE_KEY}:${token.slice(0, 24)}`;
  } catch {
    return `${FRIENDS_CACHE_KEY}:anon`;
  }
}

function readFriendsCache() {
  try {
    const raw = localStorage.getItem(getFriendsCacheKey());
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
    localStorage.setItem(getFriendsCacheKey(), JSON.stringify({
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
      const newState = { friends: accepted, pending, loading: false, error: null };
      set(newState);
      writeFriendsCache(newState);
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
    } catch (err) {
      // 404 = Anfrage existiert nicht mehr (z.B. bereits angenommen/abgelehnt
      // oder durch lokalen Cache veralteter Eintrag). Eintrag optimistisch
      // aus der Liste werfen, damit der Karte nicht endlos stehen bleibt.
      const msg = String(err?.message || '');
      if (msg.includes('404') || /nicht gefunden/i.test(msg)) {
        const pending = get().pending.filter((p) => p.id !== id);
        const next = { ...get(), pending };
        set({ pending });
        writeFriendsCache(next);
      } else {
        set({ error: err.message });
      }
    } finally {
      // Immer mit Server synchronisieren – auch im Fehlerfall, damit der
      // lokale Cache nicht weiter „pending" zeigt, wenn der Server bereits
      // einen anderen Status kennt.
      get().fetchFriends();
    }
  },

  declineFriend: async (id) => {
    try {
      await api.declineFriend(id);
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.includes('404') || /nicht gefunden/i.test(msg)) {
        const pending = get().pending.filter((p) => p.id !== id);
        const next = { ...get(), pending };
        set({ pending });
        writeFriendsCache(next);
      } else {
        set({ error: err.message });
      }
    } finally {
      get().fetchFriends();
    }
  },

  removeFriend: async (id) => {
    try {
      await api.removeFriend(id);
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.includes('404') || /nicht gefunden/i.test(msg)) {
        const friends = get().friends.filter((f) => f.id !== id);
        const pending = get().pending.filter((p) => p.id !== id);
        const next = { ...get(), friends, pending };
        set({ friends, pending });
        writeFriendsCache(next);
      } else {
        set({ error: err.message });
      }
    } finally {
      get().fetchFriends();
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

