const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');
const jwt = require('jsonwebtoken');

const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI;
const SCOPES = 'OnlineMeetings.ReadWrite offline_access';
const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const AUTH_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';

// Refreshes the stored access token if it is within 60 s of expiry.
// Returns the (possibly new) access token string, or null if refresh failed.
async function getValidAccessToken(pool, userId) {
  const row = await pool.query(
    'SELECT ms_access_token, ms_refresh_token, ms_token_expires_at FROM users WHERE id = $1',
    [userId]
  );
  if (!row.rows[0]?.ms_access_token) return null;

  let { ms_access_token, ms_refresh_token, ms_token_expires_at } = row.rows[0];

  const needsRefresh =
    ms_token_expires_at &&
    new Date(ms_token_expires_at).getTime() - Date.now() < 60_000;

  if (needsRefresh && ms_refresh_token) {
    try {
      const refreshRes = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          refresh_token: ms_refresh_token,
          grant_type: 'refresh_token',
          scope: SCOPES,
        }),
      });
      const refreshData = await refreshRes.json();
      if (!refreshData.error && refreshData.access_token) {
        ms_access_token = refreshData.access_token;
        const newExpiry = new Date(Date.now() + refreshData.expires_in * 1000);
        await pool.query(
          `UPDATE users
              SET ms_access_token = $1,
                  ms_refresh_token = $2,
                  ms_token_expires_at = $3
            WHERE id = $4`,
          [ms_access_token, refreshData.refresh_token || ms_refresh_token, newExpiry, userId]
        );
      }
    } catch {
      // Proceed with potentially stale token
    }
  }

  return ms_access_token;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const subPath = req.query.__path || '';
  const pool = getPool();

  // ──────────────────────────────────────────────────────────
  // GET /api/teams/callback  (no auth – called by Microsoft)
  // ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && subPath === 'callback') {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      return res.redirect(302, `/profile?teams_error=${encodeURIComponent(oauthError)}`);
    }
    if (!code || !state) {
      return res.redirect(302, '/profile?teams_error=missing_params');
    }

    let userId;
    try {
      const decoded = jwt.verify(state, process.env.JWT_SECRET);
      userId = decoded.id;
    } catch {
      return res.redirect(302, '/profile?teams_error=invalid_state');
    }

    try {
      const tokenRes = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
          scope: SCOPES,
        }),
      });
      const tokenData = await tokenRes.json();

      if (tokenData.error || !tokenData.access_token) {
        const desc = encodeURIComponent(tokenData.error_description || tokenData.error || 'token_failed');
        return res.redirect(302, `/profile?teams_error=${desc}`);
      }

      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
      await pool.query(
        `UPDATE users
            SET ms_access_token = $1,
                ms_refresh_token = $2,
                ms_token_expires_at = $3
          WHERE id = $4`,
        [tokenData.access_token, tokenData.refresh_token, expiresAt, userId]
      );

      return res.redirect(302, '/profile?teams_connected=1');
    } catch (err) {
      console.error('Teams callback error:', err);
      return res.redirect(302, '/profile?teams_error=server_error');
    }
  }

  // All other routes require a valid app JWT
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  // ──────────────────────────────────────────────────────────
  // GET /api/teams/status
  // ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && subPath === 'status') {
    const result = await pool.query(
      'SELECT ms_token_expires_at FROM users WHERE id = $1',
      [user.id]
    );
    const connected = !!result.rows[0]?.ms_token_expires_at;
    return res.json({ connected });
  }

  // ──────────────────────────────────────────────────────────
  // GET /api/teams/connect  →  returns Microsoft OAuth URL
  // ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && subPath === 'connect') {
    if (!CLIENT_ID || !REDIRECT_URI) {
      return res.status(503).json({ error: 'Teams-Integration nicht konfiguriert. Bitte MICROSOFT_CLIENT_ID und MICROSOFT_REDIRECT_URI setzen.' });
    }

    // Embed the user's JWT as state so we can identify them on callback
    const state = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '10m' });

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      state,
      response_mode: 'query',
      prompt: 'select_account',
    });

    return res.json({ url: `${AUTH_ENDPOINT}?${params}` });
  }

  // ──────────────────────────────────────────────────────────
  // DELETE /api/teams/disconnect
  // ──────────────────────────────────────────────────────────
  if (req.method === 'DELETE' && subPath === 'disconnect') {
    await pool.query(
      `UPDATE users
          SET ms_access_token = NULL,
              ms_refresh_token = NULL,
              ms_token_expires_at = NULL
        WHERE id = $1`,
      [user.id]
    );
    return res.json({ success: true });
  }

  // ──────────────────────────────────────────────────────────
  // POST /api/teams/meeting  →  create meeting + optionally update task
  // Body: { task_id?, title, date, time?, time_end? }
  // ──────────────────────────────────────────────────────────
  if (req.method === 'POST' && subPath === 'meeting') {
    const { task_id, title, date, time, time_end } = req.body || {};
    if (!title) return res.status(400).json({ error: 'Titel erforderlich' });

    const accessToken = await getValidAccessToken(pool, user.id);
    if (!accessToken) {
      return res.status(403).json({ error: 'Microsoft-Konto nicht verbunden. Bitte zuerst in den Profileinstellungen verbinden.' });
    }

    // Build ISO date-time strings
    const startDateStr = date ? String(date).substring(0, 10) : new Date().toISOString().substring(0, 10);
    const startTimeStr = time ? String(time).substring(0, 5) : '09:00';
    // Default meeting duration: 1 hour
    const [sh, sm] = startTimeStr.split(':').map(Number);
    const defaultEndH = String(Math.min(23, sh + 1)).padStart(2, '0');
    const endTimeStr = time_end ? String(time_end).substring(0, 5) : `${defaultEndH}:${String(sm).padStart(2, '0')}`;

    const startDateTime = `${startDateStr}T${startTimeStr}:00`;
    const endDateTime = `${startDateStr}T${endTimeStr}:00`;

    const meetingRes = await fetch('https://graph.microsoft.com/v1.0/me/onlineMeetings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ startDateTime, endDateTime, subject: title }),
    });

    if (!meetingRes.ok) {
      const errBody = await meetingRes.json().catch(() => ({}));
      console.error('Graph API error:', errBody);
      return res.status(502).json({ error: 'Teams-Meeting konnte nicht erstellt werden. Bitte erneut versuchen.' });
    }

    const meetingData = await meetingRes.json();
    const joinUrl = meetingData.joinWebUrl;
    const meetingId = meetingData.id;

    if (!joinUrl) {
      return res.status(502).json({ error: 'Teams-Meeting erstellt, aber kein Join-Link zurückgegeben.' });
    }

    // Optionally store on task row
    if (task_id) {
      const tid = parseInt(task_id, 10);
      if (!isNaN(tid)) {
        await pool.query(
          `UPDATE tasks
              SET teams_join_url = $1, teams_meeting_id = $2
            WHERE id = $3 AND user_id = $4`,
          [joinUrl, meetingId, tid, user.id]
        );
      }
    }

    return res.json({ join_url: joinUrl, meeting_id: meetingId });
  }

  // ──────────────────────────────────────────────────────────
  // DELETE /api/teams/meeting  →  remove meeting link from task
  // Body: { task_id }
  // ──────────────────────────────────────────────────────────
  if (req.method === 'DELETE' && subPath === 'meeting') {
    const { task_id } = req.body || {};
    if (!task_id) return res.status(400).json({ error: 'task_id erforderlich' });

    const tid = parseInt(task_id, 10);
    if (isNaN(tid)) return res.status(400).json({ error: 'Ungültige task_id' });

    await pool.query(
      `UPDATE tasks
          SET teams_join_url = NULL, teams_meeting_id = NULL
        WHERE id = $1 AND user_id = $2`,
      [tid, user.id]
    );

    return res.json({ success: true });
  }

  return res.status(404).json({ error: 'Nicht gefunden' });
};
