import { create } from 'zustand';
import { api } from '../utils/api';

const CACHE_KEY = 'beequ_spending_cache_v1';

function getCacheKey() {
  try {
    const token = localStorage.getItem('token') || 'anon';
    return `${CACHE_KEY}:${token.slice(0, 24)}`;
  } catch {
    return `${CACHE_KEY}:anon`;
  }
}

function readCache() {
  try {
    const raw = localStorage.getItem(getCacheKey());
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return null;
    return Array.isArray(parsed.groups) ? parsed.groups : null;
  } catch {
    return null;
  }
}

function writeCache(groups) {
  try {
    localStorage.setItem(getCacheKey(), JSON.stringify({ groups }));
  } catch {
    // ignore
  }
}

export const useSharedSpendingStore = create((set, get) => ({
  groups: readCache() || [],
  activeGroup: null,
  loading: false,
  detailLoading: false,
  error: null,

  fetchGroups: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api.getSpendingGroups();
      const groups = data.groups || [];
      set({ groups, loading: false });
      writeCache(groups);
      return groups;
    } catch (err) {
      set({ loading: false, error: err.message });
      return [];
    }
  },

  fetchGroupDetail: async (groupId) => {
    set({ detailLoading: true, error: null });
    try {
      const data = await api.getSpendingGroup(groupId);
      set({ activeGroup: data.group, detailLoading: false });
      return data.group;
    } catch (err) {
      set({ detailLoading: false, error: err.message });
      return null;
    }
  },

  createGroup: async (name) => {
    try {
      const data = await api.createSpendingGroup(name);
      await get().fetchGroups();
      return { success: true, group: data.group };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  deleteGroup: async (groupId) => {
    try {
      await api.deleteSpendingGroup(groupId);
      const groups = get().groups.filter((g) => g.id !== groupId);
      set({
        groups,
        activeGroup: get().activeGroup?.id === groupId ? null : get().activeGroup,
      });
      writeCache(groups);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  inviteMember: async (groupId, { email, user_id }) => {
    try {
      await api.inviteToSpendingGroup(groupId, { email, user_id });
      await get().fetchGroupDetail(groupId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  acceptInvite: async (groupId) => {
    try {
      await api.acceptSpendingInvite(groupId);
      await get().fetchGroups();
      if (get().activeGroup?.id === groupId) {
        await get().fetchGroupDetail(groupId);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  declineInvite: async (groupId) => {
    try {
      await api.declineSpendingInvite(groupId);
      const groups = get().groups.filter((g) => g.id !== groupId);
      set({ groups });
      writeCache(groups);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  leaveGroup: async (groupId) => {
    try {
      await api.leaveSpendingGroup(groupId);
      const groups = get().groups.filter((g) => g.id !== groupId);
      set({
        groups,
        activeGroup: get().activeGroup?.id === groupId ? null : get().activeGroup,
      });
      writeCache(groups);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  removeMember: async (groupId, userId) => {
    try {
      await api.removeSpendingMember(groupId, userId);
      if (get().activeGroup?.id === groupId) {
        await get().fetchGroupDetail(groupId);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  addEntry: async (groupId, payload) => {
    try {
      await api.addSpendingEntry(groupId, payload);
      if (get().activeGroup?.id === groupId) {
        await get().fetchGroupDetail(groupId);
      }
      await get().fetchGroups();
      return { success: true };
    } catch (err) {
      console.error('addEntry error:', err, err.payload);
      const errorMsg = err.payload?.error || err.message;
      return { success: false, error: errorMsg };
    }
  },

  updateEntry: async (groupId, entryId, payload) => {
    try {
      await api.updateSpendingEntry(groupId, entryId, payload);
      if (get().activeGroup?.id === groupId) {
        await get().fetchGroupDetail(groupId);
      }
      await get().fetchGroups();
      return { success: true };
    } catch (err) {
      console.error('updateEntry error:', err, err.payload);
      const errorMsg = err.payload?.error || err.message;
      return { success: false, error: errorMsg };
    }
  },

  deleteEntry: async (groupId, entryId) => {
    try {
      await api.deleteSpendingEntry(groupId, entryId);
      if (get().activeGroup?.id === groupId) {
        await get().fetchGroupDetail(groupId);
      }
      await get().fetchGroups();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  setOverride: async (groupId, entryId, override) => {
    try {
      await api.setSpendingOverride(groupId, entryId, override);
      if (get().activeGroup?.id === groupId) {
        await get().fetchGroupDetail(groupId);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  removeOverride: async (groupId, entryId, month) => {
    try {
      await api.removeSpendingOverride(groupId, entryId, month);
      if (get().activeGroup?.id === groupId) {
        await get().fetchGroupDetail(groupId);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  parseWithAI: async (input) => {
    try {
      const data = await api.parseSpendingText(input);
      return { success: true, parsed: data.parsed };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  createCustomCategory: async (groupId, { kind, label, color }) => {
    try {
      const data = await api.createSpendingCustomCategory(groupId, { kind, label, color });
      // Aktualisiere die activeGroup mit der neuen Kategorie
      if (get().activeGroup?.id === groupId) {
        const updated = { ...get().activeGroup };
        if (!updated.custom_categories) updated.custom_categories = [];
        updated.custom_categories.push(data.category);
        set({ activeGroup: updated });
      }
      return { success: true, category: data.category };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  deleteCustomCategory: async (groupId, categoryId) => {
    try {
      await api.deleteSpendingCustomCategory(groupId, categoryId);
      if (get().activeGroup?.id === groupId) {
        const updated = { ...get().activeGroup };
        if (updated.custom_categories) {
          updated.custom_categories = updated.custom_categories.filter((c) => c.id !== categoryId);
        }
        set({ activeGroup: updated });
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  setActiveGroup: (group) => set({ activeGroup: group }),
}));
