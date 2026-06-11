const webpush = require('web-push');
const { getPool } = require('./db');

let firebaseAdmin;
let firebaseMessaging;
let firebaseInitAttempted = false;

function initFirebaseAdmin() {
  if (firebaseInitAttempted) return;
  firebaseInitAttempted = true;

  try {
    firebaseAdmin = require('firebase-admin');
  } catch (err) {
    console.warn('[pushService] Firebase Admin not installed:', err.message);
    return;
  }

  try {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      : null;

    if (serviceAccount) {
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(serviceAccount),
      });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      firebaseAdmin.initializeApp();
    } else if (process.env.FIREBASE_PROJECT_ID) {
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.applicationDefault(),
      });
    } else {
      console.warn('[pushService] Firebase service account not configured. Native mobile push disabled.');
      return;
    }

    firebaseMessaging = firebaseAdmin.messaging();
    console.log('[pushService] Firebase Admin initialized for mobile push.');
  } catch (err) {
    console.error('[pushService] Firebase initialization failed:', err.message);
  }
}

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
// Push-Typen, für die wir 'high' Urgency setzen → iOS/APNs liefert
// sofort statt zu batchen. Sonst kann der Timer/Reminder erst beim
// nächsten App-Öffnen ankommen.
const HIGH_URGENCY_TYPES = new Set(['focus_timer', 'reminder', 'reminder_seen']);

async function sendPushToUser(userId, payload, type, taskId = null, groupId = null, prefKey = null) {
  const pool = getPool();

  // ─── STEP 0: Respect the recipient's notification preferences ───────────
  // If a prefKey is given (e.g. 'team_task' for group notifications) and the
  // user disabled that category, skip the notification entirely — no log,
  // no push. This mirrors how the cron/groups paths skip the call upfront,
  // so "Gruppen-Benachrichtigungen aus" really means nothing arrives.
  if (prefKey) {
    try {
      const { rows } = await pool.query('SELECT notification_prefs FROM users WHERE id = $1', [userId]);
      let prefs = rows[0]?.notification_prefs || {};
      if (typeof prefs === 'string') {
        try { prefs = JSON.parse(prefs); } catch { prefs = {}; }
      }
      if (prefs[prefKey] === false) {
        console.log(`[pushService] pref '${prefKey}' disabled for user ${userId} — skipping ${type}`);
        return 0;
      }
    } catch (prefErr) {
      // Fail open: on lookup error we still deliver rather than silently drop.
      console.error('[pushService] pref lookup failed:', prefErr.message);
    }
  }

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
  let mobileSubs = [];
  try {
    const result = await pool.query(
      'SELECT * FROM push_subscriptions WHERE user_id = $1',
      [userId]
    );
    subs = result.rows;
    const mobileResult = await pool.query(
      'SELECT * FROM mobile_push_subscriptions WHERE user_id = $1',
      [userId]
    );
    mobileSubs = mobileResult.rows;
  } catch (err) {
    console.error('[pushService] Failed to fetch subscriptions:', err.message);
    return 0;
  }

  if (subs.length === 0 && mobileSubs.length === 0) {
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

  // Zeit-kritische Pushes mit 'high' Urgency senden → APNs/FCM
  // liefern sofort statt im üblichen Batch-Intervall.
  const pushOptions = HIGH_URGENCY_TYPES.has(type)
    ? { urgency: 'high', TTL: 60 * 60 } // 1h TTL für zeitkritische
    : { urgency: 'normal', TTL: 24 * 60 * 60 };

  let sent = 0;

  for (const sub of subs) {
    const pushSub = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
    };
    try {
      await webpush.sendNotification(pushSub, notifPayload, pushOptions);
      sent++;
      console.log(`[pushService] Push sent to subscription ${sub.id} for user ${userId} (urgency=${pushOptions.urgency})`);
    } catch (err) {
      console.error(`[pushService] Push failed for sub ${sub.id}:`, err.statusCode, err.message);
      if (err.statusCode === 404 || err.statusCode === 410) {
        await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]).catch(() => {});
        console.log(`[pushService] Removed expired subscription ${sub.id}`);
      }
    }
  }

  if (mobileSubs.length > 0) {
    initFirebaseAdmin();
    if (!firebaseMessaging) {
      console.warn('[pushService] Mobile push subscriptions exist but Firebase is not configured. Skipping native delivery.');
    } else {
      for (const sub of mobileSubs) {
        try {
          const token = String(sub.token);
          const message = {
            token,
            notification: {
              title: payload.title,
              body: payload.body,
              image: payload.icon || undefined,
            },
            android: {
              priority: HIGH_URGENCY_TYPES.has(type) ? 'high' : 'normal',
              notification: {
                sound: 'default',
              },
            },
            data: {
              url: payload.url || '/',
              tag: payload.tag || `${type}-${Date.now()}`,
              type,
            },
          };
          await firebaseMessaging.send(message);
          sent++;
          console.log(`[pushService] Mobile push sent to token ${sub.id} for user ${userId}`);
        } catch (err) {
          console.error(`[pushService] Mobile push failed for token ${sub.id}:`, err.code || err.message || err);
          if (err.code === 'messaging/registration-token-not-registered' || err.code === 'messaging/invalid-registration-token' || err.code === 'messaging/mismatched-credential') {
            await pool.query('DELETE FROM mobile_push_subscriptions WHERE id = $1', [sub.id]).catch(() => {});
            console.log(`[pushService] Removed invalid mobile push token ${sub.id}`);
          }
        }
      }
    }
  }

  console.log(`[pushService] Sent ${sent}/${subs.length + mobileSubs.length} pushes for user ${userId}, type=${type}`);
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

