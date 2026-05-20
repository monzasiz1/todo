const API_URL = '/api';

import { enqueueRequest } from './offlineQueue';

const API_CACHE_PREFIX = 'beequ_api_cache_v1:';

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
  // Service-Worker API-Cache ebenfalls leeren, damit nach Logout kein
  // ge-cachter Response des Vorgaengers an einen neuen Nutzer geliefert wird.
  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_API_CACHE' });
    }
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
  // Transiente Server-Fehler (502 Bad Gateway, 503 Service Unavailable, 504 Gateway Timeout)
  // sind auf Vercel/Supabase oft kurze Cold-Start- oder Connection-Limit-Glitches.
  // Wir wiederholen lesende Requests mit exponentiellem Backoff, damit der Nutzer
  // davon im Idealfall nichts mitbekommt.
  const TRANSIENT_STATUSES = new Set([502, 503, 504]);
  const MAX_RETRIES = isRead ? 3 : 1;
  let attempt = 0;
  let res;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      res = await fetch(`${API_URL}${endpoint}`, {
        headers: getHeaders(),
        ...options,
      });
      if (!TRANSIENT_STATUSES.has(res.status) || attempt >= MAX_RETRIES - 1) break;
      attempt += 1;
      const delay = 250 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 120);
      await new Promise((r) => setTimeout(r, delay));
    }

    if (res.status === 401) {
      // Versuche die echte Backend-Fehlermeldung zu lesen (z.B. "Ungültige Anmeldedaten",
      // "Ungültiger 2FA-Code", "E-Mail nicht verifiziert" …) statt generisch "Nicht autorisiert".
      let serverMsg = null;
      let payload = null;
      try {
        const raw = await res.text();
        if (raw) {
          try { payload = JSON.parse(raw); serverMsg = payload?.error || payload?.message || null; }
          catch { serverMsg = raw; }
        }
      } catch { /* body nicht lesbar */ }
      const unauthorized = new Error(serverMsg || 'Nicht autorisiert');
      unauthorized.status = 401;
      if (payload) unauthorized.payload = payload;

      // Bei 401 auf NICHT-Auth-Endpunkten ist die Session abgelaufen (Token
      // ungueltig / abgelaufen / Server-Secret rotiert). In der PWA fuehrt das
      // sonst nur zu einem generischen "Nicht autorisiert"-Toast, ohne dass
      // der User zum Login zurueckkommt. Wir leeren hier die Session-Daten
      // und feuern ein globales Event, auf das App.jsx/AuthStore reagieren
      // und sauber zum Login leiten kann.
      const isAuthEndpoint = endpoint.startsWith('/auth/');
      if (!isAuthEndpoint && typeof window !== 'undefined' && localStorage.getItem('token')) {
        try {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        } catch { /* ignore */ }
        try {
          window.dispatchEvent(new CustomEvent('beequ:unauthorized', {
            detail: { message: unauthorized.message, endpoint },
          }));
        } catch { /* ignore */ }
      }
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
      // Bei transienten Server-Fehlern bei GET-Requests: lokalen Cache verwenden,
      // damit die UI weiter funktioniert (Profil, Tasks, Kategorien usw.).
      if (isRead && TRANSIENT_STATUSES.has(res.status)) {
        const cached = cacheGet(endpoint);
        if (cached) return cached;
      }
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
  login: (email, password, twofa_code) =>
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(
        typeof twofa_code !== 'undefined'
          ? { email, password, twofa_code }
          : { email, password }
      ),
    }),

  register: (name, email, password) =>
    request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),

  verifyCode: (email, code) =>
    request('/auth/verify-code', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),

  resendCode: (email) =>
    request('/auth/resend-code', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  getMe: () => request('/auth/me'),

  // Realtime: holt ein Supabase-kompatibles JWT (kurzlebig, RLS-aware).
  getRealtimeToken: () => request('/auth/realtime-token'),

  // 2FA
  setup2FA:   ()       => request('/auth/2fa/setup',   { method: 'POST', body: '{}' }),
  confirm2FA: (code)   => request('/auth/2fa/confirm', { method: 'POST', body: JSON.stringify({ code }) }),
  disable2FA: (code)   => request('/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) }),

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

  getTask: (id) => request(`/tasks/${id}`),

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

  deleteTask: (id, { mode } = {}) => {
    const query = mode ? `?mode=${encodeURIComponent(mode)}` : '';
    return request(`/tasks/${id}${query}`, { method: 'DELETE' });
  },

  restoreTaskDismissal: (id) =>
    request(`/tasks/${id}/dismissal`, { method: 'DELETE' }),

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

  // Focus Timer (server-side scheduled push)
  getFocusTimer: () => request('/focus-timer'),
  startFocusTimer: (payload) =>
    request('/focus-timer', { method: 'POST', body: JSON.stringify(payload) }),
  cancelFocusTimer: () => request('/focus-timer', { method: 'DELETE' }),

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

  parseNoteChecklist: (input) =>
    request('/ai/note-checklist', {
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

  getAttachmentUrl: (taskId, attachmentId, downloadUrl) => {
    // Bevorzugt die signierte Short-TTL-URL (15 min), die das Backend
    // jetzt in jedem Attachment-Listen-Response mitliefert (`download_url`).
    // Fallback: nur fuer Abwaertskompatibilitaet falls eine alte Komponente
    // die URL ohne Token braucht — Backend wird sie ohne gueltiges Token
    // mit 401 ablehnen.
    if (downloadUrl) return `${API_URL.replace(/\/api$/, '')}${downloadUrl}`;
    return `${API_URL}/attachments/${taskId}/${attachmentId}`;
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

  getGroupDismissedTasks: (groupId) =>
    request(`/groups/${groupId}/dismissed-tasks`),

  updateGroupTask: (groupId, taskId, data) =>
    request(`/groups/${groupId}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  getGroupCategories: (groupId) => request(`/groups/${groupId}/categories`),

  createGroupCategory: (groupId, data) =>
    request(`/groups/${groupId}/categories`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateGroupCategory: (groupId, categoryId, data) =>
    request(`/groups/${groupId}/categories/${categoryId}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteGroupCategory: (groupId, categoryId) =>
    request(`/groups/${groupId}/categories/${categoryId}`, { method: 'DELETE' }),

  // Group Subgroups
  getGroupSubgroups: (groupId) => request(`/groups/${groupId}/subgroups`),

  createGroupSubgroup: (groupId, data) =>
    request(`/groups/${groupId}/subgroups`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteGroupSubgroup: (groupId, subgroupId) =>
    request(`/groups/${groupId}/subgroups/${subgroupId}`, { method: 'DELETE' }),

  // Group invite & join requests
  searchGroupUsers: (groupId, q) =>
    request(`/groups/${groupId}/search-users?q=${encodeURIComponent(q)}`),

  inviteGroupUser: (groupId, userId) =>
    request(`/groups/${groupId}/invite-user`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    }),

  sendGroupJoinRequest: (groupId, message = '') =>
    request(`/groups/${groupId}/join-request`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  getGroupJoinRequests: (groupId) =>
    request(`/groups/${groupId}/join-requests`),

  handleGroupJoinRequest: (groupId, requestId, action) =>
    request(`/groups/${groupId}/join-requests/${requestId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
    }),

  searchGroups: (q) =>
    request(`/groups/search?q=${encodeURIComponent(q)}`),

  getMyGroupRequests: () => request('/groups/my-requests'),

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

  shareTaskToGroupChat: (groupId, taskId, options = {}) =>
    request(`/groups/${groupId}/messages/share-task`, {
      method: 'POST',
      body: JSON.stringify({ task_id: taskId, with_rsvp: options.withRsvp === true }),
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

  // Stripe Billing
  /** Erstellt eine Stripe-Checkout-Session und liefert die Redirect-URL. */
  createCheckoutSession: (plan, interval = 'month') =>
    request('/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ plan, interval }),
    }),

  /** URL zum Stripe-Customer-Portal (Abos verwalten, kuendigen, Rechnungen). */
  getBillingPortalUrl: () =>
    request('/billing/portal', { method: 'POST' }),

  /** Status einer Checkout-Session abfragen (fuer Success-Page). */
  getCheckoutSession: (sessionId) =>
    request(`/billing/session?id=${encodeURIComponent(sessionId)}`),

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

  // Task Votes (TaskDetailModal)
  getTaskVotes: (taskId) =>
    request(`/task-votes?taskId=${taskId}`),

  voteTask: (taskId, status = null) =>
    request('/task-votes', {
      method: 'POST',
      body: JSON.stringify({ taskId, status }),
    }),

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

  getArchivedNotes: () => request('/notes?view=archived'),

  // Eingehende Share-Anfragen (opt-in: muss aktiv akzeptiert werden, sonst
  // taucht die Notiz nicht in der "Mit mir geteilt"-Liste auf).
  getNoteShareRequests: () => request('/notes/share-requests'),

  acceptNoteShareRequest: (noteId) =>
    request('/notes/share-requests/accept', {
      method: 'POST',
      body: JSON.stringify({ note_id: noteId }),
    }),

  declineNoteShareRequest: (noteId) =>
    request('/notes/share-requests/decline', {
      method: 'POST',
      body: JSON.stringify({ note_id: noteId }),
    }),

  // Activity-Feed (chronologischer Verlauf einer Note: created, edited,
  // shared, unshared, completed, …). Sichtbar fuer alle mit Lese-Zugriff.
  getNoteActivity: (noteId, { limit = 50 } = {}) =>
    request(`/notes/${encodeURIComponent(noteId)}/activity?limit=${limit}`),

  // Kommentare auf Notes (separater Endpoint, eigene Tabelle note_comments)
  getNoteComments: (noteId) =>
    request(`/note-comments?noteId=${encodeURIComponent(noteId)}`),

  addNoteComment: (noteId, text, emoji) =>
    request('/note-comments', {
      method: 'POST',
      body: JSON.stringify({ noteId, text, emoji: emoji || null }),
    }),

  deleteNoteComment: (commentId) =>
    request(`/note-comments?commentId=${encodeURIComponent(commentId)}`, {
      method: 'DELETE',
    }),

  // Mentionable Users fuer eine Note (Friends + Note-Teilnehmer). Wird vom
  // @-Autocomplete-Dropdown im Kommentar-Feld benutzt.
  getMentionableUsers: (noteId) =>
    request(`/notes/${encodeURIComponent(noteId)}/mentionable`),

  // Version History fuer eine Note.
  listNoteVersions: (noteId) =>
    request(`/notes/${encodeURIComponent(noteId)}/versions`),
  getNoteVersion: (noteId, versionNo) =>
    request(`/notes/${encodeURIComponent(noteId)}/versions/${encodeURIComponent(versionNo)}`),
  restoreNoteVersion: (noteId, versionNo) =>
    request(`/notes/${encodeURIComponent(noteId)}/versions/${encodeURIComponent(versionNo)}/restore`, {
      method: 'POST',
    }),

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

  // ── Mindmap-Verbindungen (separater Endpoint) ─────────────────────────
  // Liefert alle Connections fuer den eingeloggten User auf einmal.
  listNoteConnections: () => request('/note-connections'),

  addNoteConnection: (noteId1, noteId2, relationshipType = 'related') =>
    request('/note-connections', {
      method: 'POST',
      body: JSON.stringify({
        note_id_1: noteId1,
        note_id_2: noteId2,
        relationship_type: relationshipType,
      }),
    }),

  removeNoteConnection: (noteId1, noteId2) =>
    request('/note-connections', {
      method: 'DELETE',
      body: JSON.stringify({ note_id_1: noteId1, note_id_2: noteId2 }),
    }),

  removeNoteConnectionById: (connectionId) =>
    request(`/note-connections?id=${encodeURIComponent(connectionId)}`, {
      method: 'DELETE',
    }),

  // Canvas Texts
  getCanvasTexts: () => request('/canvas-texts'),
  upsertCanvasText: (entry) =>
    request('/canvas-texts', {
      method: 'POST',
      body: JSON.stringify({ action: 'upsert', ...entry }),
    }),
  deleteCanvasText: (id) =>
    request('/canvas-texts', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', id }),
    }),
};

