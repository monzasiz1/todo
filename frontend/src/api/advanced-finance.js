/**
 * Frontend API Clients für Advanced Finance Features
 */

// Utility for API calls with error handling
async function apiCall(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });
    
    if (!res.ok) {
      const error = await res.text();
      throw new Error(`API Error: ${res.status} - ${error}`);
    }
    
    return await res.json();
  } catch (err) {
    console.error(`API call to ${url} failed:`, err);
    throw err;
  }
}

// Net Worth API
export const netWorthAPI = {
  async getNetWorth() {
    return apiCall('/api/net-worth');
  },

  async createAccount(data) {
    return apiCall('/api/net-worth/accounts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateAccount(id, data) {
    return apiCall(`/api/net-worth/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteAccount(id) {
    return apiCall(`/api/net-worth/accounts/${id}`, { method: 'DELETE' });
  },

  async createLiability(data) {
    return apiCall('/api/net-worth/liabilities', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateLiability(id, data) {
    return apiCall(`/api/net-worth/liabilities/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteLiability(id) {
    return apiCall(`/api/net-worth/liabilities/${id}`, { method: 'DELETE' });
  },
};

// Financial Goals API
export const goalsAPI = {
  async getGoals() {
    return apiCall('/api/financial-goals');
  },

  async createGoal(data) {
    return apiCall('/api/financial-goals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateGoal(id, data) {
    return apiCall(`/api/financial-goals/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async contributeToGoal(id, amount) {
    return apiCall(`/api/financial-goals/${id}/contribute`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });
  },

  async deleteGoal(id) {
    return apiCall(`/api/financial-goals/${id}`, { method: 'DELETE' });
  },
};

// Cashflow API
export const cashflowAPI = {
  async getTimeline(months = 3) {
    return apiCall(`/api/cashflow/timeline?months=${months}`);
  },

  async getProjections(months = 3) {
    return apiCall(`/api/cashflow/projections?months=${months}`);
  },

  async createEvent(data) {
    return apiCall('/api/cashflow/events', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateEvent(id, data) {
    return apiCall(`/api/cashflow/events/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteEvent(id) {
    return apiCall(`/api/cashflow/events/${id}`, { method: 'DELETE' });
  },
};
