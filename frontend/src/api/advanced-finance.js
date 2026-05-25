/**
 * Frontend API Clients für Advanced Finance Features
 */

// Net Worth API
export const netWorthAPI = {
  async getNetWorth() {
    const res = await fetch('/api/net-worth');
    if (!res.ok) throw new Error('Net Worth fetch failed');
    return res.json();
  },

  async createAccount(data) {
    const res = await fetch('/api/net-worth/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Create account failed');
    return res.json();
  },

  async updateAccount(id, data) {
    const res = await fetch(`/api/net-worth/accounts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Update account failed');
    return res.json();
  },

  async deleteAccount(id) {
    const res = await fetch(`/api/net-worth/accounts/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete account failed');
    return res.json();
  },

  async createLiability(data) {
    const res = await fetch('/api/net-worth/liabilities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Create liability failed');
    return res.json();
  },

  async updateLiability(id, data) {
    const res = await fetch(`/api/net-worth/liabilities/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Update liability failed');
    return res.json();
  },

  async deleteLiability(id) {
    const res = await fetch(`/api/net-worth/liabilities/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete liability failed');
    return res.json();
  },
};

// Financial Goals API
export const goalsAPI = {
  async getGoals() {
    const res = await fetch('/api/goals');
    if (!res.ok) throw new Error('Goals fetch failed');
    return res.json();
  },

  async createGoal(data) {
    const res = await fetch('/api/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Create goal failed');
    return res.json();
  },

  async updateGoal(id, data) {
    const res = await fetch(`/api/goals/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Update goal failed');
    return res.json();
  },

  async contributeToGoal(id, amount) {
    const res = await fetch(`/api/goals/${id}/contribute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    });
    if (!res.ok) throw new Error('Contribute failed');
    return res.json();
  },

  async deleteGoal(id) {
    const res = await fetch(`/api/goals/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete goal failed');
    return res.json();
  },
};

// Cashflow API
export const cashflowAPI = {
  async getTimeline(months = 3) {
    const res = await fetch(`/api/cashflow/timeline?months=${months}`);
    if (!res.ok) throw new Error('Timeline fetch failed');
    return res.json();
  },

  async getProjections(months = 3) {
    const res = await fetch(`/api/cashflow/projections?months=${months}`);
    if (!res.ok) throw new Error('Projections fetch failed');
    return res.json();
  },

  async createEvent(data) {
    const res = await fetch('/api/cashflow/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Create event failed');
    return res.json();
  },

  async updateEvent(id, data) {
    const res = await fetch(`/api/cashflow/events/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Update event failed');
    return res.json();
  },

  async deleteEvent(id) {
    const res = await fetch(`/api/cashflow/events/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete event failed');
    return res.json();
  },
};
