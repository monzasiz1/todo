import { create } from 'zustand';
import { api } from '../utils/api';

export const useOrganizationStore = create((set) => ({
  organizations: [],
  currentOrganization: null,
  members: [],
  groups: [],
  loading: false,

  fetchOrganizations: async () => {
    set({ loading: true });
    try {
      const data = await api.getOrganizations();
      set({ organizations: data.organizations || [], loading: false });
      return data.organizations || [];
    } catch {
      set({ loading: false });
      return [];
    }
  },

  createOrganization: async (organizationData) => {
    const data = await api.createOrganization(organizationData);
    set((state) => ({ organizations: [data.organization, ...state.organizations] }));
    return data.organization;
  },

  joinOrganization: async (code) => {
    const data = await api.joinOrganization(code);
    set((state) => ({ organizations: [data.organization, ...state.organizations] }));
    return data.organization;
  },

  fetchOrganization: async (id) => {
    set({ loading: true });
    try {
      const data = await api.getOrganization(id);
      set({
        currentOrganization: data.organization || null,
        members: data.members || [],
        loading: false,
      });
      return data;
    } catch {
      set({ loading: false });
      return null;
    }
  },

  fetchOrganizationGroups: async (id) => {
    try {
      const data = await api.getOrganizationGroups(id);
      set({ groups: data.groups || [] });
      return data.groups || [];
    } catch {
      set({ groups: [] });
      return [];
    }
  },

  assignGroup: async (organizationId, groupId) => {
    const data = await api.assignGroupToOrganization(organizationId, groupId);
    return data.group;
  },

  removeGroup: async (organizationId, groupId) => {
    const data = await api.removeGroupFromOrganization(organizationId, groupId);
    return data.group;
  },
}));