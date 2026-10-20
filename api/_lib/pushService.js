const webpush = require('web-push');
const { getPool } = require('./db');

// VAPID keys aus Environment Variables
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
let VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@beequ.app';

// Sicherstellen dass mailto: Prefix vorhanden ist
if (VAPID_EMAIL && !VAPID_EMAIL.startsWith('mailto:') && !VAPID_EMAIL.startsWith('https://')) {
  VAPID_EMAIL = `mailto:${VAPID_EMAIL}`;
}

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try {
    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
  } catch (err) {
    console.error('VAPID setup error:', err.message);
  }
}

/**
 * Send push notification to a specific user
 * @param {string} userId
 * @param {object} payload - { title, body, icon?, url?, tag? }
 * @param {string} type - notification type for logging
 * @param {string|null} taskId - optional related task
 * @param {string|null} groupId - optional related group
 */
async function sendPushToUser(userId, payload, type, taskId = null, groupId = null) {
  const pool = getPool();

  // ─── STEP 1: ALWAYS log to notification_log FIRST ───────────────────────
  // This guarantees the in-app notification bell always shows entries,
  // even if the user has no push subscriptions or push delivery fails.
  try {
    await pool.query(
      'INSERT INTO notification_log (user_id, type, task_id, group_id, title, body) VALUES ($1, $2, $3, $4, $5, $6)',
      [userId, type, taskId || null, groupId || null, payload.title, payload.body]
    );
  } catch (logErr) {
    console.error('[pushService] notification_log insert failed:', logErr.message);
  }

  // ─── STEP 2: Try push delivery ───────────────────────────────────────────
  let subs = [];
  try {
    const result = await pool.query(
      'SELECT * FROM push_subscriptions WHERE user_id = $1',
      [userId]
    );
    subs = result.rows;
  } catch (err) {
    console.error('[pushService] Failed to fetch subscriptions:', err.message);
    return 0;
  }

  if (subs.length === 0) {
    console.log(`[pushService] No push subscriptions for user ${userId}, logged only`);
    return 0;
  }

  const notifPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: payload.icon || '/icons/icon-192.png',
    url: payload.url || '/',
    tag: payload.tag || `${type}-${Date.now()}`,
  });

  let sent = 0;
  for (const sub of subs) {
    const pushSub = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
    };
    try {
      await webpush.sendNotification(pushSub, notifPayload);
      sent++;
      console.log(`[pushService] Push sent to subscription ${sub.id} for user ${userId}`);
    } catch (err) {
      console.error(`[pushService] Push failed for sub ${sub.id}:`, err.statusCode, err.message);
      if (err.statusCode === 404 || err.statusCode === 410) {
        // Subscription expired/invalid – remove it
        await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]).catch(() => {});
        console.log(`[pushService] Removed expired subscription ${sub.id}`);
      }
    }
  }

  console.log(`[pushService] Sent ${sent}/${subs.length} pushes for user ${userId}, type=${type}`);
  return sent;
}

/**
 * Check if a notification of given type was sent to user today
 */
async function wasSentToday(userId, type) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT 1 FROM notification_log
     WHERE user_id = $1 AND type = $2
     AND sent_at >= CURRENT_DATE AND sent_at < CURRENT_DATE + INTERVAL '1 day'
     LIMIT 1`,
    [userId, type]
  );
  return rows.length > 0;
}

/**
 * Check if a specific task reminder was already sent
 */
async function wasTaskReminderSent(userId, taskId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT 1 FROM notification_log
     WHERE user_id = $1 AND task_id = $2 AND type = 'reminder'
     LIMIT 1`,
    [userId, taskId]
  );
  return rows.length > 0;
}

async function wasTaskTypeSent(userId, taskId, type) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT 1 FROM notification_log
     WHERE user_id = $1 AND task_id = $2 AND type = $3
     LIMIT 1`,
    [userId, taskId, type]
  );
  return rows.length > 0;
}

module.exports = { sendPushToUser, wasSentToday, wasTaskReminderSent, wasTaskTypeSent };

