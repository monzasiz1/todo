const API_URL = '/api';

function getHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function request(endpoint, options = {}) {
  const res = await fetch(`${API_URL}${endpoint}`, {
    headers: getHeaders(),
    ...options,
  });

  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Nicht autorisiert');
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Anfrage fehlgeschlagen');
  }

  return data;
}

export const api = {
  // Auth
  login: (email, password) =>
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (name, email, password) =>
    request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),

  getMe: () => request('/auth/me'),

  // Profile
  getProfile: () => request('/profile'),

  updateProfile: (data) =>
    request('/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  updateAvatar: (avatar_url) =>
    request('/profile/avatar', {
      method: 'PUT',
      body: JSON.stringify({ avatar_url }),
    }),

  changePassword: (current_password, new_password) =>
    request('/profile/password', {
      method: 'PUT',
      body: JSON.stringify({ current_password, new_password }),
    }),

  exportProfile: () => request('/profile/export'),

  deleteAccount: (password) =>
    request('/profile', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    }),

  // Tasks
  getTasks: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/tasks${query ? `?${query}` : ''}`);
  },

  getTasksRange: (start, end) =>
    request(`/tasks/range?start=${start}&end=${end}`),

  createTask: (task) =>
    request('/tasks', {
      method: 'POST',
      body: JSON.stringify(task),
    }),

  updateTask: (id, updates) =>
    request(`/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  toggleTask: (id) =>
    request(`/tasks/${id}/toggle`, { method: 'PATCH' }),

  reorderTasks: (taskIds) =>
    request('/tasks/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ taskIds }),
    }),

  deleteTask: (id) =>
    request(`/tasks/${id}`, { method: 'DELETE' }),

  getDueReminders: () => request('/tasks/reminders/due'),

  // AI
  parseInput: (input) =>
    request('/ai/parse', {
      method: 'POST',
      body: JSON.stringify({ input }),
    }),

  parseAndCreateTask: (input) =>
    request('/ai/parse-and-create', {
      method: 'POST',
      body: JSON.stringify({ input }),
    }),

  // Categories
  getCategories: () => request('/categories'),

  createCategory: (category) =>
    request('/categories', {
      method: 'POST',
      body: JSON.stringify(category),
    }),

  deleteCategory: (id) =>
    request(`/categories/${id}`, { method: 'DELETE' }),

  // Friends
  getFriends: () => request('/friends'),

  inviteFriend: (email) =>
    request('/friends/invite', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  acceptFriend: (id) =>
    request(`/friends/${id}/accept`, { method: 'PATCH' }),

  declineFriend: (id) =>
    request(`/friends/${id}/decline`, { method: 'PATCH' }),

  removeFriend: (id) =>
    request(`/friends/${id}`, { method: 'DELETE' }),

  redeemInviteCode: (code) =>
    request('/friends/invite-code', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  // Permissions
  getPermissions: (taskId) =>
    request(`/permissions/${taskId}`),

  setPermissions: (taskId, data) =>
    request(`/permissions/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // AI Permissions
  parsePermissions: (input) =>
    request('/ai/permissions', {
      method: 'POST',
      body: JSON.stringify({ input }),
    }),
};
