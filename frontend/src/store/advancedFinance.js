import { create } from 'zustand';
import { netWorthAPI, goalsAPI, cashflowAPI } from '../api/advanced-finance';

/**
 * Net Worth Store
 */
export const useNetWorthStore = create((set, get) => ({
  accounts: [],
  liabilities: [],
  summary: null,
  loading: false,

  fetchNetWorth: async () => {
    set({ loading: true });
    try {
      const data = await netWorthAPI.getNetWorth();
      set({
        accounts: data.accounts || [],
        liabilities: data.liabilities || [],
        summary: data.summary,
        loading: false,
      });
    } catch (err) {
      console.error('Net worth fetch error:', err);
      set({ loading: false });
    }
  },

  createAccount: async (data) => {
    try {
      const res = await netWorthAPI.createAccount(data);
      set((state) => ({
        accounts: [...state.accounts, res.account],
      }));
      return res;
    } catch (err) {
      console.error('Create account error:', err);
      throw err;
    }
  },

  updateAccount: async (id, data) => {
    try {
      const res = await netWorthAPI.updateAccount(id, data);
      set((state) => ({
        accounts: state.accounts.map((a) => (a.id === id ? res.account : a)),
      }));
      return res;
    } catch (err) {
      console.error('Update account error:', err);
      throw err;
    }
  },

  deleteAccount: async (id) => {
    try {
      await netWorthAPI.deleteAccount(id);
      set((state) => ({
        accounts: state.accounts.filter((a) => a.id !== id),
      }));
    } catch (err) {
      console.error('Delete account error:', err);
      throw err;
    }
  },

  createLiability: async (data) => {
    try {
      const res = await netWorthAPI.createLiability(data);
      set((state) => ({
        liabilities: [...state.liabilities, res.liability],
      }));
      return res;
    } catch (err) {
      console.error('Create liability error:', err);
      throw err;
    }
  },

  updateLiability: async (id, data) => {
    try {
      const res = await netWorthAPI.updateLiability(id, data);
      set((state) => ({
        liabilities: state.liabilities.map((l) => (l.id === id ? res.liability : l)),
      }));
      return res;
    } catch (err) {
      console.error('Update liability error:', err);
      throw err;
    }
  },

  deleteLiability: async (id) => {
    try {
      await netWorthAPI.deleteLiability(id);
      set((state) => ({
        liabilities: state.liabilities.filter((l) => l.id !== id),
      }));
    } catch (err) {
      console.error('Delete liability error:', err);
      throw err;
    }
  },
}));

/**
 * Financial Goals Store
 */
export const useGoalsStore = create((set, get) => ({
  goals: [],
  summary: null,
  loading: false,

  fetchGoals: async () => {
    set({ loading: true });
    try {
      const data = await goalsAPI.getGoals();
      set({
        goals: data.goals || [],
        summary: data.summary,
        loading: false,
      });
    } catch (err) {
      console.error('Goals fetch error:', err);
      set({ loading: false });
    }
  },

  createGoal: async (data) => {
    try {
      const res = await goalsAPI.createGoal(data);
      set((state) => ({
        goals: [...state.goals, res.goal],
      }));
      return res;
    } catch (err) {
      console.error('Create goal error:', err);
      throw err;
    }
  },

  updateGoal: async (id, data) => {
    try {
      const res = await goalsAPI.updateGoal(id, data);
      set((state) => ({
        goals: state.goals.map((g) => (g.id === id ? res.goal : g)),
      }));
      return res;
    } catch (err) {
      console.error('Update goal error:', err);
      throw err;
    }
  },

  contributeToGoal: async (id, amount) => {
    try {
      const res = await goalsAPI.contributeToGoal(id, amount);
      set((state) => ({
        goals: state.goals.map((g) => (g.id === id ? res.goal : g)),
      }));
      return res;
    } catch (err) {
      console.error('Contribute error:', err);
      throw err;
    }
  },

  deleteGoal: async (id) => {
    try {
      await goalsAPI.deleteGoal(id);
      set((state) => ({
        goals: state.goals.filter((g) => g.id !== id),
      }));
    } catch (err) {
      console.error('Delete goal error:', err);
      throw err;
    }
  },
}));

/**
 * Cashflow & Timeline Store
 */
export const useCashflowStore = create((set, get) => ({
  timeline: [],
  projections: [],
  timelineLoading: false,
  projectionsLoading: false,

  fetchTimeline: async (months = 3) => {
    set({ timelineLoading: true });
    try {
      const data = await cashflowAPI.getTimeline(months);
      set({
        timeline: data.timeline || [],
        timelineLoading: false,
      });
    } catch (err) {
      console.error('Timeline fetch error:', err);
      set({ timelineLoading: false });
    }
  },

  fetchProjections: async (months = 3) => {
    set({ projectionsLoading: true });
    try {
      const data = await cashflowAPI.getProjections(months);
      set({
        projections: data.projections || [],
        projectionsLoading: false,
      });
    } catch (err) {
      console.error('Projections fetch error:', err);
      set({ projectionsLoading: false });
    }
  },

  createEvent: async (data) => {
    try {
      const res = await cashflowAPI.createEvent(data);
      set((state) => ({
        timeline: [...state.timeline, res.event],
      }));
      return res;
    } catch (err) {
      console.error('Create event error:', err);
      throw err;
    }
  },

  deleteEvent: async (id) => {
    try {
      await cashflowAPI.deleteEvent(id);
      set((state) => ({
        timeline: state.timeline.filter((e) => e.id !== id),
      }));
    } catch (err) {
      console.error('Delete event error:', err);
      throw err;
    }
  },
}));
