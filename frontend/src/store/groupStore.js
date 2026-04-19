import { create } from 'zustand';
import { api } from '../utils/api';

export const useGroupStore = create((set, get) => ({
  groups: [],
  currentGroup: null,
  members: [],
  groupTasks: [],
  myRole: null,
  loading: false,

  fetchGroups: async () => {
    set({ loading: true });
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
    set({ loading: true });
    try {
      const data = await api.getGroup(id);
      set({
        currentGroup: data.group,
        members: data.members || [],
        groupTasks: data.tasks || [],
        myRole: data.myRole,
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
    set((s) => ({ groupTasks: [data.task, ...s.groupTasks] }));
    return data.task;
  },

  removeGroupTask: async (groupId, taskId) => {
    await api.removeGroupTask(groupId, taskId);
    set((s) => ({ groupTasks: s.groupTasks.filter(t => t.id !== taskId) }));
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
