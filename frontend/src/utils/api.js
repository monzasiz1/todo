const API_URL = '/api';

import { enqueueRequest } from './offlineQueue';

const API_CACHE_PREFIX = 'taski_api_cache_v1:';

function getUserCacheScope() {
  const token = localStorage.getItem('token') || 'anon';
  return token.slice(0, 24);
}

function buildCacheKey(endpoint) {
  return `${API_CACHE_PREFIX}${getUserCacheScope()}:${endpoint}`;
}

function cacheGet(endpoint) {
  try {
    const raw = localStorage.getItem(buildCacheKey(endpoint));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}

function cacheSet(endpoint, data) {
  try {
    const payload = { ts: Date.now(), data };
    localStorage.setItem(buildCacheKey(endpoint), JSON.stringify(payload));
  } catch {
    // ignore quota/security errors
  }
}

export function clearApiCacheForCurrentUser() {
  try {
    const scope = `${API_CACHE_PREFIX}${getUserCacheScope()}:`;
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(scope)) keys.push(key);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}

function getHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Führt einen API-Request aus.
 * Bei Netzwerkfehler (offline) werden mutative Requests (POST/PATCH/PUT/DELETE)
 * in die Offline-Queue eingereiht und ein { __queued: true, tempId } Objekt zurückgegeben.
 * GET-Requests werfen den Fehler weiter.
 */
async function request(endpoint, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const isRead = method === 'GET';
  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      headers: getHeaders(),
      ...options,
    });

    if (res.status === 401) {
      const unauthorized = new Error('Nicht autorisiert');
      unauthorized.status = 401;
      throw unauthorized;
    }

    const rawText = await res.text();
    let data = {};
    if (rawText) {
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { error: rawText };
      }
    }

    if (!res.ok) {
      const err = new Error(data.error || `Anfrage fehlgeschlagen (${res.status})`);
      err.status = res.status;
      err.payload = data;
      throw err;
    }

    if (isRead) {
      cacheSet(endpoint, data);
    }

    return data;
  } catch (err) {
    const isMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
    const isAuthEndpoint = endpoint.startsWith('/auth/');

    // Nur bei echtem Netzwerkfehler (TypeError: Failed to fetch) in Queue einreihen
    const isNetworkError = err instanceof TypeError || err.message === 'Failed to fetch' || !navigator.onLine;

    // Auth Requests niemals in die Queue legen (Login/Register müssen sofort fehlschlagen)
    if (isMutation && isNetworkError && !isAuthEndpoint) {
      const tempId = `offline_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const bodyStr = options.body ?? null;
      const body = bodyStr ? JSON.parse(bodyStr) : null;
      await enqueueRequest({ method, endpoint, body, tempId });
      // Signalwert – der Store muss damit umgehen
      return { __queued: true, tempId };
    }

    // Für Auth-Endpunkte klare Offline-Fehlermeldung statt technischer TypeError
    if (isAuthEndpoint && isNetworkError) {
      throw new Error('Keine Internetverbindung. Login nur online möglich.');
    }

    // Read-Requests aus lokalem Cache bedienen (auch nach App-Neustart)
    if (isRead && isNetworkError) {
      const cached = cacheGet(endpoint);
      if (cached) return cached;
      throw new Error('Offline und keine lokal gespeicherten Daten vorhanden.');
    }

    throw err;
  }
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

  updateVisibility: (profile_visibility) =>
    request('/profile/visibility', {
      method: 'PATCH',
      body: JSON.stringify({ profile_visibility }),
    }),

  getFriendProfile: (id) => request(`/profile/user/${id}`),

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

  getDashboardTasks: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/tasks/dashboard${query ? `?${query}` : ''}`);
  },

  getTasksSummary: () => request('/tasks/summary'),

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

  // Notifications
  getVapidKey: () => request('/notifications/vapid-key'),
  subscribePush: (sub) =>
    request('/notifications/subscribe', { method: 'POST', body: JSON.stringify(sub) }),
  unsubscribePush: (data) =>
    request('/notifications/subscribe', { method: 'DELETE', body: JSON.stringify(data) }),
  getNotificationStatus: () => request('/notifications/status'),
  getNotificationLog: () => request('/notifications/log'),
  createNotificationLog: (payload) =>
    request('/notifications/log', { method: 'POST', body: JSON.stringify(payload) }),
  getNotificationLogFiltered: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/notifications/log${query ? `?${query}` : ''}`);
  },
  clearNotificationLog: (type = null) =>
    request(`/notifications/log${type ? `?type=${encodeURIComponent(type)}` : ''}`, {
      method: 'DELETE',
    }),
  deleteNotificationLogEntry: (id) => request(`/notifications/log/${id}`, { method: 'DELETE' }),
  getNotificationSubscriptions: () => request('/notifications/subscriptions'),
  removeNotificationSubscription: (id) => request(`/notifications/subscriptions/${id}`, { method: 'DELETE' }),
  sendTestNotification: (payload = {}) =>
    request('/notifications/test', { method: 'POST', body: JSON.stringify(payload) }),
  getNotificationPreview: () => request('/notifications/preview'),
  getNotificationHealth: () => request('/notifications/health'),
  updateNotificationPrefs: (prefs) =>
    request('/notifications/prefs', { method: 'PUT', body: JSON.stringify({ prefs }) }),

  // AI
  parseInput: (input) =>
    request('/ai/parse', {
      method: 'POST',
      body: JSON.stringify({ input }),
    }),

  parseAndCreateTask: (input, type = null, groupContext = null, options = {}) =>
    request('/ai/parse-and-create', {
      method: 'POST',
      body: JSON.stringify({ input, type, groupContext, ...options }),
    }),

  createGroupPoll: (groupId, question, options) =>
    request(`/groups/${groupId}/polls`, {
      method: 'POST',
      body: JSON.stringify({ question, options }),
    }),

  voteGroupPoll: (groupId, msgId, optionId) =>
    request(`/groups/${groupId}/polls/${msgId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ optionId }),
    }),

  editGroupMessage: (groupId, msgId, content) =>
    request(`/groups/${groupId}/messages/${msgId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    }),

  deleteGroupMessage: (groupId, msgId) =>
    request(`/groups/${groupId}/messages/${msgId}`, { method: 'DELETE' }),

  smartAction: (input) =>
    request('/ai/smart', {
      method: 'POST',
      body: JSON.stringify({ input }),
    }),

  // Help Chat
  helpChat: (message, history = []) =>
    request('/help/chat', {
      method: 'POST',
      body: JSON.stringify({ message, history }),
    }),

  // Attachments
  getAttachments: (taskId) => request(`/attachments/${taskId}`),

  uploadAttachment: (taskId, { file_name, file_type, file_data }) =>
    request(`/attachments/${taskId}`, {
      method: 'POST',
      body: JSON.stringify({ file_name, file_type, file_data }),
    }),

  deleteAttachment: (taskId, attachmentId) =>
    request(`/attachments/${taskId}/${attachmentId}`, { method: 'DELETE' }),

  getAttachmentUrl: (taskId, attachmentId) => {
    const token = localStorage.getItem('token');
    return `${API_URL}/attachments/${taskId}/${attachmentId}${token ? `?token=${token}` : ''}`;
  },

  // Categories
  getCategories: () => request('/categories'),

  createCategory: (category) =>
    request('/categories', {
      method: 'POST',
      body: JSON.stringify(category),
    }),

  updateCategory: (id, updates) =>
    request(`/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
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

  // Groups
  getGroups: () => request('/groups'),

  createGroup: (data) =>
    request('/groups', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  joinGroup: (code) =>
    request('/groups/join', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  getGroup: (id) => request(`/groups/${id}`),

  updateGroup: (id, data) =>
    request(`/groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteGroup: (id) =>
    request(`/groups/${id}`, { method: 'DELETE' }),

  addGroupTask: (groupId, task) =>
    request(`/groups/${groupId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(task),
    }),

  removeGroupTask: (groupId, taskId) =>
    request(`/groups/${groupId}/tasks/${taskId}`, { method: 'DELETE' }),

  getGroupCategories: (groupId) => request(`/groups/${groupId}/categories`),

  createGroupCategory: (groupId, data) =>
    request(`/groups/${groupId}/categories`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteGroupCategory: (groupId, categoryId) =>
    request(`/groups/${groupId}/categories/${categoryId}`, { method: 'DELETE' }),

  changeGroupMemberRole: (groupId, userId, role) =>
    request(`/groups/${groupId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  removeGroupMember: (groupId, userId) =>
    request(`/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),

  // Group Chat
  getGroupMessages: (groupId) => request(`/groups/${groupId}/messages`),

  sendGroupMessage: (groupId, content) =>
    request(`/groups/${groupId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  shareTaskToGroupChat: (groupId, taskId) =>
    request(`/groups/${groupId}/messages/share-task`, {
      method: 'POST',
      body: JSON.stringify({ task_id: taskId }),
    }),

  claimGroupEvent: (groupId, msgId, role = 'organizer') =>
    request(`/groups/${groupId}/messages/${msgId}/claim`, {
      method: 'POST',
      body: JSON.stringify({ role }),
    }),

  rsvpGroupEvent: (groupId, msgId, status = 'yes') =>
    request(`/groups/${groupId}/messages/${msgId}/rsvp`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),

  pinGroupMessage: (groupId, msgId, pinned) =>
    request(`/groups/${groupId}/messages/${msgId}/pin`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned }),
    }),

  // Plans
  getPlans: () => request('/plans'),

  getMyPlan: () => request('/plans/me'),

  upgradePlan: (plan) =>
    request('/plans/upgrade', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    }),

  // Comments
  getComments: (taskId) =>
    request(`/comments?taskId=${taskId}`),

  addComment: (taskId, emoji, text) =>
    request('/comments', {
      method: 'POST',
      body: JSON.stringify({ taskId, emoji, text }),
    }),

  deleteComment: (commentId) =>
    request(`/comments?commentId=${commentId}`, { method: 'DELETE' }),

  // Microsoft Teams
  getTeamsStatus: () => request('/teams/status'),

  getTeamsConnectUrl: () => request('/teams/connect'),

  disconnectTeams: () =>
    request('/teams/disconnect', { method: 'DELETE' }),

  createTeamsMeeting: ({ task_id, title, date, time, time_end }) =>
    request('/teams/meeting', {
      method: 'POST',
      body: JSON.stringify({ task_id, title, date, time, time_end }),
    }),

  removeTeamsMeeting: (task_id) =>
    request('/teams/meeting', {
      method: 'DELETE',
      body: JSON.stringify({ task_id }),
    }),

  // Notes
  getNotes: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/notes${query ? '?' + query : ''}`);
  },

  createNote: (note) =>
    request('/notes', {
      method: 'POST',
      body: JSON.stringify(note),
    }),

  updateNote: (noteId, updates) =>
    request('/notes', {
      method: 'POST',
      body: JSON.stringify({ action: 'update', id: noteId, ...updates, updates }),
    }),

  deleteNote: (noteId) =>
    request('/notes', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', id: noteId }),
    }),

  linkNoteToTask: (noteId, taskId) =>
    request('/notes', {
      method: 'POST',
      body: JSON.stringify({ action: 'link-task', id: noteId, task_id: taskId }),
    }),

  shareNote: (noteId, data) =>
    request('/notes', {
      method: 'POST',
      body: JSON.stringify({ action: 'share', id: noteId, ...data }),
    }),

  unshareNote: (noteId, friendId) =>
    request('/notes', {
      method: 'POST',
      body: JSON.stringify({ action: 'unshare', id: noteId, friend_id: friendId }),
    }),

  getSharedNotes: () => request('/notes?view=shared'),

  connectNotes: (noteId1, noteId2, relationshipType = 'related') =>
    request('/notes', {
      method: 'POST',
      body: JSON.stringify({
        action: 'connect',
        id: noteId1,
        note_id: noteId2,
        other_note_id: noteId2,
        relationship_type: relationshipType,
      }),
    }),

  disconnectNotes: (noteId1, noteId2) =>
    request('/notes', {
      method: 'POST',
      body: JSON.stringify({
        action: 'disconnect',
        id: noteId1,
        note_id: noteId2,
        other_note_id: noteId2,
      }),
    }),

  getNoteConnections: (noteId) => request(`/notes?id=${encodeURIComponent(noteId)}&view=connections`),
};
