const webpush = require('web-push');
const { getPool } = require('./db');

// VAPID keys aus Environment Variables
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
let VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@taski.app';

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
 */
async function sendPushToUser(userId, payload, type, taskId = null) {
  const pool = getPool();

  // Get all subscriptions for this user
  const { rows: subs } = await pool.query(
    'SELECT * FROM push_subscriptions WHERE user_id = $1',
    [userId]
  );

  if (subs.length === 0) return 0;

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
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        // Subscription expired/invalid – remove it
        await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
      }
    }
  }

  // Always log for in-app notification center, even when push delivery is 0.
  await pool.query(
    'INSERT INTO notification_log (user_id, type, task_id, title, body) VALUES ($1, $2, $3, $4, $5)',
    [userId, type, taskId, payload.title, payload.body]
  );

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
