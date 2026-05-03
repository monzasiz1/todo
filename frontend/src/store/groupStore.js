import { create } from 'zustand';
import { api } from '../utils/api';

const GROUP_CACHE_KEY = 'beequ_groups_cache_v1';

function readGroupCache() {
  try {
    const raw = localStorage.getItem(GROUP_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      currentGroup: parsed.currentGroup || null,
      members: Array.isArray(parsed.members) ? parsed.members : [],
      groupTasks: Array.isArray(parsed.groupTasks) ? parsed.groupTasks : [],
      myRole: parsed.myRole || null,
      subgroups: Array.isArray(parsed.subgroups) ? parsed.subgroups : [],
      groupDetailsById: parsed.groupDetailsById && typeof parsed.groupDetailsById === 'object'
        ? parsed.groupDetailsById
        : {},
    };
  } catch {
    return null;
  }
}

function writeGroupCache(state) {
  try {
    localStorage.setItem(GROUP_CACHE_KEY, JSON.stringify({
      groups: state.groups || [],
      currentGroup: state.currentGroup || null,
      members: state.members || [],
      groupTasks: state.groupTasks || [],
      myRole: state.myRole || null,
      subgroups: state.subgroups || [],
      groupDetailsById: state.groupDetailsById || {},
    }));
  } catch {
    // ignore
  }
}

const cached = readGroupCache();

export const useGroupStore = create((set, get) => ({
  groups: cached?.groups || [],
  currentGroup: cached?.currentGroup || null,
  members: cached?.members || [],
  groupTasks: cached?.groupTasks || [],
  myRole: cached?.myRole || null,
  subgroups: cached?.subgroups || [],
  groupDetailsById: cached?.groupDetailsById || {},
  loading: false,

  fetchGroups: async () => {
    set({ loading: get().groups.length === 0 });
    try {
      const data = await api.getGroups();
      set({ groups: data.groups || [], loading: false });
    } catch {
      set({ loading: false });
    }
  },

  createGroup: async (groupData) => {
    try {
      const data = await api.createGroup(groupData);
      set((s) => ({ groups: [data.group, ...s.groups] }));
      return data.group;
    } catch (err) {
      throw err;
    }
  },

  joinGroup: async (code) => {
    const data = await api.joinGroup(code);
    set((s) => ({ groups: [data.group, ...s.groups] }));
    return data;
  },

  fetchGroup: async (id) => {
    const key = String(id);
    const cachedDetail = get().groupDetailsById?.[key];
    if (cachedDetail) {
      set({
        currentGroup: cachedDetail.group || null,
        members: cachedDetail.members || [],
        groupTasks: cachedDetail.tasks || [],
        myRole: cachedDetail.myRole || null,
        subgroups: cachedDetail.subgroups || [],
        loading: false,
      });
    } else {
      set({ loading: true });
    }

    try {
      const data = await api.getGroup(id);
      set({
        currentGroup: data.group,
        members: data.members || [],
        groupTasks: data.tasks || [],
        myRole: data.myRole,
        subgroups: data.subgroups || [],
        groupDetailsById: {
          ...(get().groupDetailsById || {}),
          [key]: {
            group: data.group || null,
            members: data.members || [],
            tasks: data.tasks || [],
            myRole: data.myRole || null,
            subgroups: data.subgroups || [],
          },
        },
        loading: false,
      });
      return data;
    } catch {
      set({ loading: false });
    }
  },

  updateGroup: async (id, updates) => {
    const data = await api.updateGroup(id, updates);
    set((s) => ({
      currentGroup: data.group,
      groups: s.groups.map(g => g.id === id ? { ...g, ...data.group } : g),
      groupDetailsById: {
        ...(s.groupDetailsById || {}),
        [String(id)]: {
          group: data.group,
          members: s.members,
          tasks: s.groupTasks,
          myRole: s.myRole,
        },
      },
    }));
    return data.group;
  },

  deleteGroup: async (id) => {
    await api.deleteGroup(id);
    set((s) => ({
      groups: s.groups.filter(g => g.id !== id),
      currentGroup: null,
    }));
  },

  addGroupTask: async (groupId, task) => {
    const data = await api.addGroupTask(groupId, task);
    set((s) => {
      const nextTasks = [data.task, ...s.groupTasks];
      return {
        groupTasks: nextTasks,
        groupDetailsById: {
          ...(s.groupDetailsById || {}),
          [String(groupId)]: {
            group: s.currentGroup,
            members: s.members,
            tasks: nextTasks,
            myRole: s.myRole,
          },
        },
      };
    });
    return data.task;
  },

  removeGroupTask: async (groupId, taskId) => {
    await api.removeGroupTask(groupId, taskId);
    set((s) => {
      const nextTasks = s.groupTasks.filter((t) => t.id !== taskId);
      return {
        groupTasks: nextTasks,
        groupDetailsById: {
          ...(s.groupDetailsById || {}),
          [String(groupId)]: {
            group: s.currentGroup,
            members: s.members,
            tasks: nextTasks,
            myRole: s.myRole,
          },
        },
      };
    });
  },

  updateGroupTask: (taskId, updates) => {
    set((s) => {
      const nextTasks = s.groupTasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t));
      const currentId = s.currentGroup?.id;
      return {
        groupTasks: nextTasks,
        groupDetailsById: currentId
          ? {
              ...(s.groupDetailsById || {}),
              [String(currentId)]: {
                group: s.currentGroup,
                members: s.members,
                tasks: nextTasks,
                myRole: s.myRole,
              },
            }
          : s.groupDetailsById,
      };
    });
  },

  changeMemberRole: async (groupId, userId, role) => {
    await api.changeGroupMemberRole(groupId, userId, role);
    set((s) => ({
      members: s.members.map(m => m.user_id === userId ? { ...m, role } : m),
    }));
  },

  removeMember: async (groupId, userId) => {
    const data = await api.removeGroupMember(groupId, userId);
    if (data.dissolved) {
      set((s) => ({
        groups: s.groups.filter(g => g.id !== groupId),
        currentGroup: null,
      }));
    } else {
      set((s) => ({
        members: s.members.filter(m => m.user_id !== userId),
      }));
    }
    return data;
  },
}));

useGroupStore.subscribe((state) => {
  writeGroupCache(state);
});

