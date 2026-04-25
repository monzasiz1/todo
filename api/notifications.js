const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');
const { sendPushToUser } = require('./_lib/pushService');

function parsePositiveInt(value, fallback, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

module.exports = async function handler(req, res) {
  cors(res);

  // CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const pool = getPool();
  const subPath = req.query.__path || '';
  const segments = subPath.split('/').filter(Boolean);

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
      const limit = parsePositiveInt(req.query.limit, 30, 200);
      const offset = Math.max(0, Number.parseInt(String(req.query.offset || '0'), 10) || 0);
      const type = String(req.query.type || '').trim();
      const since = String(req.query.since || '').trim();
      const params = [user.id];
      const where = ['user_id = $1'];

      if (type) {
        params.push(type);
        where.push(`type = $${params.length}`);
      }

      if (since) {
        params.push(since);
        where.push(`sent_at >= $${params.length}::timestamptz`);
      }

      params.push(limit);
      const limitParam = `$${params.length}`;
      params.push(offset);
      const offsetParam = `$${params.length}`;

      const { rows } = await pool.query(
        `SELECT id, type, task_id, title, body, sent_at
         FROM notification_log
         WHERE ${where.join(' AND ')}
         ORDER BY sent_at DESC
         LIMIT ${limitParam}
         OFFSET ${offsetParam}`,
        params
      );

      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM notification_log
         WHERE ${where.join(' AND ')}`,
        params.slice(0, where.length)
      );

      return res.json({
        notifications: rows,
        paging: {
          total: countRows[0]?.total || 0,
          limit,
          offset,
        },
      });
    } catch (err) {
      console.error('Log error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden' });
    }
  }

  // DELETE /api/notifications/log – clear current user's log (optional by type)
  if (segments[0] === 'log' && req.method === 'DELETE' && segments.length === 1) {
    try {
      const type = String(req.body?.type || req.query?.type || '').trim();
      if (type) {
        const deleted = await pool.query(
          'DELETE FROM notification_log WHERE user_id = $1 AND type = $2 RETURNING id',
          [user.id, type]
        );
        return res.json({ success: true, deleted: deleted.rowCount, scope: { type } });
      }

      const deleted = await pool.query(
        'DELETE FROM notification_log WHERE user_id = $1 RETURNING id',
        [user.id]
      );
      return res.json({ success: true, deleted: deleted.rowCount, scope: 'all' });
    } catch (err) {
      console.error('Log clear error:', err);
      return res.status(500).json({ error: 'Fehler beim Leeren des Logs' });
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

  // GET /api/notifications/subscriptions – list current device subscriptions
  if (segments[0] === 'subscriptions' && req.method === 'GET') {
    try {
      const { rows } = await pool.query(
        `SELECT id, endpoint, created_at
         FROM push_subscriptions
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [user.id]
      );

      const subscriptions = rows.map((row) => {
        const endpointText = String(row.endpoint || '');
        return {
          id: row.id,
          endpoint: endpointText,
          endpoint_preview: endpointText.length > 60
            ? `${endpointText.slice(0, 30)}...${endpointText.slice(-20)}`
            : endpointText,
          created_at: row.created_at,
        };
      });

      return res.json({ subscriptions, count: subscriptions.length });
    } catch (err) {
      console.error('Subscriptions list error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden der Subscriptions' });
    }
  }

  // DELETE /api/notifications/subscriptions/:id – remove one subscription by id
  if (segments[0] === 'subscriptions' && segments.length === 2 && req.method === 'DELETE') {
    try {
      const subId = Number.parseInt(String(segments[1]), 10);
      if (!Number.isFinite(subId) || subId <= 0) {
        return res.status(400).json({ error: 'Ungueltige Subscription-ID' });
      }

      const deleted = await pool.query(
        'DELETE FROM push_subscriptions WHERE id = $1 AND user_id = $2 RETURNING id',
        [subId, user.id]
      );

      if (deleted.rowCount === 0) {
        return res.status(404).json({ error: 'Subscription nicht gefunden' });
      }

      return res.json({ success: true, removedId: subId });
    } catch (err) {
      console.error('Subscription remove error:', err);
      return res.status(500).json({ error: 'Fehler beim Entfernen der Subscription' });
    }
  }

  // POST /api/notifications/test – send a test push to the current user
  if (segments[0] === 'test' && req.method === 'POST') {
    try {
      const title = String(req.body?.title || 'Test-Benachrichtigung');
      const body = String(req.body?.body || '✅ Push funktioniert auf diesem Geraet.');
      const url = String(req.body?.url || '/');
      const tag = String(req.body?.tag || `test-${Date.now()}`);

      // Always log, even if push send fails
      await pool.query(
        `INSERT INTO notification_log (user_id, type, title, body)
         VALUES ($1, $2, $3, $4)`,
        [user.id, 'test', title, body]
      ).catch(() => null);

      // Try to send push (best-effort)
      const sent = await sendPushToUser(
        user.id,
        { title, body, url, tag },
        'test',
        null
      ).catch(() => 0);

      return res.json({ 
        success: true, 
        sent,
        message: 'Test-Benachrichtigung versendet. Prüfe Glocke oder Handy.' 
      });
    } catch (err) {
      console.error('Test push error:', err);
      return res.status(500).json({ error: 'Fehler beim Senden des Test-Push', details: err.message });
    }
  }

  // GET /api/notifications/preview – operational preview for upcoming deliveries
  if (segments[0] === 'preview' && req.method === 'GET') {
    try {
      const { rows: prefsRows } = await pool.query(
        'SELECT notification_prefs FROM users WHERE id = $1',
        [user.id]
      );
      const prefs = prefsRows[0]?.notification_prefs || { reminder: true, daily_tasks: true, engagement: true, team_task: true };

      const { rows: subRows } = await pool.query(
        'SELECT COUNT(*)::int as count FROM push_subscriptions WHERE user_id = $1',
        [user.id]
      );

      const { rows: dueRows } = await pool.query(
        `SELECT COUNT(*)::int as due
           FROM tasks
          WHERE user_id = $1
            AND completed = false
            AND reminder_at IS NOT NULL
            AND reminder_at <= NOW()
            AND reminder_at > NOW() - INTERVAL '1 hour'`,
        [user.id]
      );

      const { rows: nextRows } = await pool.query(
        `SELECT id, title, date, time, reminder_at
           FROM tasks
          WHERE user_id = $1
            AND completed = false
            AND reminder_at IS NOT NULL
            AND reminder_at > NOW()
          ORDER BY reminder_at ASC
          LIMIT 5`,
        [user.id]
      );

      const now = new Date();
      return res.json({
        subscribed: (subRows[0]?.count || 0) > 0,
        subscription_count: subRows[0]?.count || 0,
        prefs,
        due_in_window_count: dueRows[0]?.due || 0,
        next_reminders: nextRows,
        server_time: now.toISOString(),
      });
    } catch (err) {
      console.error('Preview error:', err);
      return res.status(500).json({ error: 'Fehler beim Erstellen der Vorschau' });
    }
  }

  // GET /api/notifications/health – diagnostics for push setup
  if (segments[0] === 'health' && req.method === 'GET') {
    try {
      const { rows: subRows } = await pool.query(
        'SELECT COUNT(*)::int as count FROM push_subscriptions WHERE user_id = $1',
        [user.id]
      );
      const { rows: userRows } = await pool.query(
        'SELECT notification_prefs, last_active_at FROM users WHERE id = $1',
        [user.id]
      );
      
      // Check recent reminder sends
      const { rows: recentReminders } = await pool.query(
        `SELECT COUNT(*)::int as count FROM notification_log
         WHERE user_id = $1 AND type = 'reminder' AND sent_at >= NOW() - INTERVAL '24 hours'`,
        [user.id]
      );
      
      // Check due reminders now
      const { rows: dueNow } = await pool.query(
        `SELECT COUNT(*)::int as count FROM tasks
         WHERE user_id = $1 AND completed = false 
           AND reminder_at IS NOT NULL 
           AND reminder_at <= NOW()
           AND reminder_at > NOW() - INTERVAL '1 hour'`,
        [user.id]
      );

      return res.json({
        ok: true,
        vapidConfigured: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
        cronConfigured: !!process.env.CRON_SECRET,
        hasSubscription: (subRows[0]?.count || 0) > 0,
        subscriptionCount: subRows[0]?.count || 0,
        reminders_sent_24h: recentReminders[0]?.count || 0,
        reminders_due_now: dueNow[0]?.count || 0,
        prefs: userRows[0]?.notification_prefs || null,
        lastActiveAt: userRows[0]?.last_active_at || null,
        serverTime: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Health error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden der Notification-Health' });
    }
  }
  
  // GET /api/notifications/diagnostic – detailed push diagnostics (verbose)
  if (segments[0] === 'diagnostic' && req.method === 'GET') {
    try {
      const { rows: subRows } = await pool.query(
        `SELECT id, endpoint, created_at FROM push_subscriptions WHERE user_id = $1`,
        [user.id]
      );
      
      const { rows: logRows } = await pool.query(
        `SELECT type, COUNT(*)::int as count FROM notification_log
         WHERE user_id = $1 AND sent_at >= NOW() - INTERVAL '7 days'
         GROUP BY type ORDER BY count DESC`,
        [user.id]
      );
      
      const { rows: recentReminders } = await pool.query(
        `SELECT id, title, reminder_at FROM tasks
         WHERE user_id = $1 AND reminder_at IS NOT NULL
         ORDER BY reminder_at DESC LIMIT 10`,
        [user.id]
      );

      return res.json({
        diagnostics: {
          subscriptions_total: subRows.length,
          subscriptions: subRows.map(s => ({
            id: s.id,
            endpoint_preview: `${String(s.endpoint).slice(0, 40)}...`,
            created_at: s.created_at,
          })),
          notification_log_7d: logRows,
          recent_tasks_with_reminders: recentReminders.map(t => ({
            id: t.id,
            title: t.title,
            reminder_at: t.reminder_at,
          })),
        },
      });
    } catch (err) {
      console.error('Diagnostic error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden der Diagnostik' });
    }
  }

  // GET /api/notifications/debug-reminders – debug why reminders aren't showing
  if (segments[0] === 'debug-reminders' && req.method === 'GET') {
    try {
      const now = new Date();
      
      // 1. All user tasks with reminder_at
      const { rows: allReminders } = await pool.query(
        `SELECT id, title, reminder_at, completed FROM tasks
         WHERE user_id = $1 AND reminder_at IS NOT NULL
         ORDER BY reminder_at DESC LIMIT 20`,
        [user.id]
      );
      
      // 2. Due reminders (should trigger notification)
      const { rows: dueReminders } = await pool.query(
        `SELECT id, title, reminder_at, completed FROM tasks
         WHERE user_id = $1 AND completed = false
           AND reminder_at IS NOT NULL
           AND reminder_at <= NOW()
           AND reminder_at > NOW() - INTERVAL '24 hours'
         ORDER BY reminder_at DESC`,
        [user.id]
      );
      
      // 3. What's in notification_log for reminders
      const { rows: logEntries } = await pool.query(
        `SELECT id, type, title, body, sent_at FROM notification_log
         WHERE user_id = $1 AND type IN ('reminder', 'reminder_created')
         ORDER BY sent_at DESC LIMIT 20`,
        [user.id]
      );
      
      // 4. Try the actual due-reminders API query
      let visibleIds = [];
      try {
        const { rows: visible } = await pool.query(
          `WITH visible_ids AS (
             SELECT t.id
             FROM tasks t
             WHERE t.user_id = $1
             UNION ALL
             SELECT t.id
             FROM tasks t
             WHERE t.visibility = 'shared'
               AND EXISTS (
                 SELECT 1
                 FROM friends f
                 WHERE f.status = 'accepted'
                   AND ((f.user_id = t.user_id AND f.friend_id = $1) OR (f.user_id = $1 AND f.friend_id = t.user_id))
               )
             UNION ALL
             SELECT tp.task_id AS id
             FROM task_permissions tp
             WHERE tp.user_id = $1 AND tp.can_view = true
             UNION ALL
             SELECT gt.task_id AS id
             FROM group_tasks gt
             JOIN group_members gm ON gm.group_id = gt.group_id
             WHERE gm.user_id = $1
           )
           SELECT DISTINCT id FROM visible_ids LIMIT 50`,
          [user.id]
        );
        visibleIds = visible.map(r => r.id);
      } catch (e) {
        console.log('Visible IDs query failed:', e.message);
      }
      
      return res.json({
        debug_timestamp: now.toISOString(),
        all_reminders_total: allReminders.length,
        all_reminders: allReminders.map(t => ({
          id: t.id,
          title: t.title,
          reminder_at: t.reminder_at,
          completed: t.completed,
          is_due: t.reminder_at <= now && t.reminder_at > new Date(now.getTime() - 24*60*60*1000),
        })),
        due_reminders_count: dueReminders.length,
        due_reminders: dueReminders.map(t => ({
          id: t.id,
          title: t.title,
          reminder_at: t.reminder_at,
          seconds_overdue: Math.round((now - new Date(t.reminder_at)) / 1000),
        })),
        notification_log_reminders: logEntries.map(e => ({
          type: e.type,
          title: e.title,
          body: e.body,
          sent_at: e.sent_at,
        })),
        visible_task_ids_count: visibleIds.length,
      });
    } catch (err) {
      console.error('Debug reminders error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden der Debug-Info', details: err.message });
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

  // GET /api/notifications/debug-updates – debug task update consistency
  if (segments[0] === 'debug-updates' && req.method === 'GET') {
    try {
      const taskId = req.query.task_id;
      
      if (!taskId) {
        // Return summary of recent updates
        const { rows: recentUpdates } = await pool.query(
          `SELECT id, title, priority, date, time, updated_at 
           FROM tasks 
           WHERE user_id = $1 
           ORDER BY updated_at DESC 
           LIMIT 10`,
          [user.id]
        );
        
        const { rows: updates7d } = await pool.query(
          `SELECT COUNT(*)::int as count 
           FROM tasks 
           WHERE user_id = $1 AND updated_at >= NOW() - INTERVAL '7 days'`,
          [user.id]
        );
        
        return res.json({
          debug_type: 'summary',
          recent_updates: recentUpdates,
          updates_7d: updates7d[0]?.count || 0,
          timestamp: new Date().toISOString()
        });
      }
      
      // Detailed check for a specific task
      const { rows: taskRows } = await pool.query(
        `SELECT id, title, priority, date, time, completed, updated_at, last_edited_by 
         FROM tasks 
         WHERE id = $1 AND user_id = $2`,
        [taskId, user.id]
      );
      
      if (taskRows.length === 0) {
        return res.status(404).json({ error: 'Task nicht gefunden' });
      }
      
      const task = taskRows[0];
      return res.json({
        debug_type: 'task_detail',
        task: {
          id: task.id,
          title: task.title,
          priority: task.priority,
          date: task.date,
          time: task.time,
          completed: task.completed,
          updated_at: task.updated_at,
          last_edited_by: task.last_edited_by
        },
        timestamp: new Date().toISOString(),
        notes: 'Wenn updated_at alt ist, prüfe dass der Frontend die Änderung sendet. Wenn neu, aber nicht sichtbar im Kalender, prüfe Browser-Cache.'
      });
    } catch (err) {
      console.error('Debug updates error:', err);
      return res.status(500).json({ error: 'Fehler beim Debuggen', details: err.message });
    }
  }

  return res.status(404).json({ error: 'Nicht gefunden' });
};
