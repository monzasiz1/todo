import { Router } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI;
const SCOPES = 'OnlineMeetings.ReadWrite offline_access';
const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const AUTH_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-dev-secret';

function buildGraphDateTime(dateValue, timeValue, fallbackIso) {
  const dateStr = dateValue ? String(dateValue).substring(0, 10) : null;
  const timeStr = timeValue ? String(timeValue).substring(0, 5) : null;
  if (!dateStr || !timeStr) return fallbackIso;
  const dt = new Date(`${dateStr}T${timeStr}:00`);
  if (Number.isNaN(dt.getTime())) return fallbackIso;
  return dt.toISOString();
}

function frontendProfileUrl(params) {
  const query = new URLSearchParams(params).toString();
  return `${FRONTEND_URL}/profile${query ? `?${query}` : ''}`;
}

async function getValidAccessToken(userId) {
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
      // Continue with potentially stale token
    }
  }

  return ms_access_token;
}

router.get('/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return res.redirect(302, frontendProfileUrl({ teams_error: oauthError }));
  }
  if (!code || !state) {
    return res.redirect(302, frontendProfileUrl({ teams_error: 'missing_params' }));
  }

  let userId;
  try {
    const decoded = jwt.verify(state, JWT_SECRET);
    userId = decoded.id;
  } catch {
    return res.redirect(302, frontendProfileUrl({ teams_error: 'invalid_state' }));
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
      return res.redirect(302, frontendProfileUrl({
        teams_error: tokenData.error_description || tokenData.error || 'token_failed',
      }));
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

    return res.redirect(302, frontendProfileUrl({ teams_connected: '1' }));
  } catch (err) {
    console.error('Teams callback error:', err);
    return res.redirect(302, frontendProfileUrl({ teams_error: 'server_error' }));
  }
});

router.use(authenticate);

router.get('/status', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT ms_token_expires_at FROM users WHERE id = $1',
      [req.user.id]
    );
    return res.json({ connected: !!result.rows[0]?.ms_token_expires_at });
  } catch (err) {
    console.error('Teams status error:', err);
    return res.status(500).json({ error: 'Teams-Status konnte nicht geladen werden' });
  }
});

router.get('/connect', async (req, res) => {
  if (!CLIENT_ID || !REDIRECT_URI) {
    return res.status(503).json({
      error: 'Teams-Integration nicht konfiguriert. Bitte MICROSOFT_CLIENT_ID und MICROSOFT_REDIRECT_URI setzen.',
    });
  }

  const state = jwt.sign({ id: req.user.id }, JWT_SECRET, { expiresIn: '10m' });
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    response_mode: 'query',
    prompt: 'select_account',
  });

  return res.json({ url: `${AUTH_ENDPOINT}?${params.toString()}` });
});

router.delete('/disconnect', async (req, res) => {
  try {
    await pool.query(
      `UPDATE users
          SET ms_access_token = NULL,
              ms_refresh_token = NULL,
              ms_token_expires_at = NULL
        WHERE id = $1`,
      [req.user.id]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('Teams disconnect error:', err);
    return res.status(500).json({ error: 'Microsoft-Konto konnte nicht getrennt werden' });
  }
});

router.post('/meeting', async (req, res) => {
  const { task_id, title, date, time, time_end } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Titel erforderlich' });

  try {
    const accessToken = await getValidAccessToken(req.user.id);
    if (!accessToken) {
      return res.status(403).json({ error: 'Microsoft-Konto nicht verbunden. Bitte zuerst verbinden.' });
    }

    const now = new Date();
    const defaultStart = new Date(now.getTime() + 5 * 60 * 1000);
    const defaultEnd = new Date(defaultStart.getTime() + 60 * 60 * 1000);

    const startDateTime = buildGraphDateTime(date, time || '09:00', defaultStart.toISOString());
    let endDateTime = buildGraphDateTime(date, time_end || time || '10:00', defaultEnd.toISOString());

    if (new Date(endDateTime).getTime() <= new Date(startDateTime).getTime()) {
      endDateTime = new Date(new Date(startDateTime).getTime() + 60 * 60 * 1000).toISOString();
    }

    const meetingPayload = {
      subject: String(title).trim(),
      startDateTime,
      endDateTime,
    };

    const meetingRes = await fetch('https://graph.microsoft.com/v1.0/me/onlineMeetings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(meetingPayload),
    });

    if (!meetingRes.ok) {
      const raw = await meetingRes.text().catch(() => '');
      let errBody = {};
      try { errBody = raw ? JSON.parse(raw) : {}; } catch { errBody = { raw }; }
      const graphMsg = errBody?.error?.message || 'Unbekannter Graph-Fehler';
      console.error('Teams meeting error:', { status: meetingRes.status, payload: meetingPayload, errBody });
      return res.status(502).json({ error: `Teams-Meeting konnte nicht erstellt werden: ${graphMsg}` });
    }

    const meetingData = await meetingRes.json();
    const joinUrl = meetingData.joinWebUrl;
    const meetingId = meetingData.id;

    if (task_id) {
      const tid = parseInt(task_id, 10);
      if (!Number.isNaN(tid)) {
        await pool.query(
          `UPDATE tasks
              SET teams_join_url = $1, teams_meeting_id = $2
            WHERE id = $3 AND user_id = $4`,
          [joinUrl, meetingId, tid, req.user.id]
        );
      }
    }

    return res.json({ join_url: joinUrl, meeting_id: meetingId });
  } catch (err) {
    console.error('Teams meeting create error:', err);
    return res.status(500).json({ error: 'Teams-Meeting konnte nicht erstellt werden' });
  }
});

export default router;
