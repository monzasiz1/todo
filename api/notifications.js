const { getPool } = require('./_lib/db');
const { authenticate } = require('./_lib/auth');

module.exports = async function handler(req, res) {
  // CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const user = authenticate(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const pool = getPool();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const segments = url.pathname.replace('/api/notifications/', '').split('/').filter(Boolean);

  // Update last_active_at on every authenticated request
  pool.query('UPDATE users SET last_active_at = NOW() WHERE id = $1', [user.id]).catch(() => {});

  // POST /api/notifications/subscribe – save push subscription
  if (segments[0] === 'subscribe' && req.method === 'POST') {
    try {
      const { endpoint, keys } = req.body;
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ error: 'Ungültige Subscription-Daten' });
      }

      await pool.query(
        `INSERT INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, endpoint) DO UPDATE SET
           keys_p256dh = EXCLUDED.keys_p256dh,
           keys_auth = EXCLUDED.keys_auth`,
        [user.id, endpoint, keys.p256dh, keys.auth]
      );

      return res.json({ success: true });
    } catch (err) {
      console.error('Subscribe error:', err);
      return res.status(500).json({ error: 'Fehler beim Speichern' });
    }
  }

  // DELETE /api/notifications/subscribe – remove subscription
  if (segments[0] === 'subscribe' && req.method === 'DELETE') {
    try {
      const { endpoint } = req.body;
      if (!endpoint) return res.status(400).json({ error: 'Endpoint fehlt' });

      await pool.query(
        'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
        [user.id, endpoint]
      );

      return res.json({ success: true });
    } catch (err) {
      console.error('Unsubscribe error:', err);
      return res.status(500).json({ error: 'Fehler beim Löschen' });
    }
  }

  // GET /api/notifications/vapid-key – public VAPID key
  if (segments[0] === 'vapid-key' && req.method === 'GET') {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) return res.status(500).json({ error: 'VAPID nicht konfiguriert' });
    return res.json({ publicKey: key });
  }

  // GET /api/notifications/log – recent notification history
  if (segments[0] === 'log' && req.method === 'GET') {
    try {
      const { rows } = await pool.query(
        `SELECT id, type, task_id, title, body, sent_at
         FROM notification_log
         WHERE user_id = $1
         ORDER BY sent_at DESC
         LIMIT 30`,
        [user.id]
      );
      return res.json({ notifications: rows });
    } catch (err) {
      console.error('Log error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden' });
    }
  }

  // GET /api/notifications/status – check subscription status + preferences
  if (segments[0] === 'status' && req.method === 'GET') {
    try {
      const { rows: subRows } = await pool.query(
        'SELECT COUNT(*) as count FROM push_subscriptions WHERE user_id = $1',
        [user.id]
      );
      const { rows: userRows } = await pool.query(
        'SELECT notification_prefs FROM users WHERE id = $1',
        [user.id]
      );
      const prefs = userRows[0]?.notification_prefs || { reminder: true, daily_tasks: true, engagement: true, team_task: true };
      return res.json({ subscribed: parseInt(subRows[0].count) > 0, prefs });
    } catch (err) {
      return res.status(500).json({ error: 'Fehler' });
    }
  }

  // PUT /api/notifications/prefs – save notification preferences
  if (segments[0] === 'prefs' && req.method === 'PUT') {
    try {
      const { prefs } = req.body;
      if (!prefs || typeof prefs !== 'object') {
        return res.status(400).json({ error: 'Ungültige Preferences' });
      }
      // Only allow known keys
      const allowed = ['reminder', 'daily_tasks', 'engagement', 'team_task'];
      const clean = {};
      for (const k of allowed) {
        clean[k] = prefs[k] !== false;
      }
      await pool.query(
        'UPDATE users SET notification_prefs = $1 WHERE id = $2',
        [JSON.stringify(clean), user.id]
      );
      return res.json({ success: true, prefs: clean });
    } catch (err) {
      console.error('Prefs error:', err);
      return res.status(500).json({ error: 'Fehler beim Speichern' });
    }
  }

  return res.status(404).json({ error: 'Nicht gefunden' });
};
