/**
 * api/billing.js
 *
 * Stripe-Abrechnung fuer BeeQu-Abos.
 *
 *   POST /api/billing/checkout   – auth: erstellt Stripe Checkout Session
 *                                  body: { plan: 'pro'|'team', interval: 'month'|'year' }
 *                                  resp: { url }
 *
 *   POST /api/billing/portal     – auth: Customer-Portal-URL
 *                                  resp: { url }
 *
 *   POST /api/billing/webhook    – public, Stripe-signiert
 *                                  Events: checkout.session.completed,
 *                                          customer.subscription.updated,
 *                                          customer.subscription.deleted,
 *                                          invoice.paid
 *
 *   GET  /api/billing/session?id=... – auth: Status eines abgeschlossenen
 *                                            Checkouts (fuer Success-Page)
 *
 * Benoetigte Env-Variablen:
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 *   STRIPE_PRICE_PRO_MONTH
 *   STRIPE_PRICE_PRO_YEAR
 *   STRIPE_PRICE_TEAM_MONTH
 *   STRIPE_PRICE_TEAM_YEAR
 *   APP_BASE_URL            (z.B. https://beequ.de)
 */

const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

// Lazily konstruieren, damit Builds ohne ENV-Variablen nicht crashen.
let stripeClient = null;
function getStripe() {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY ist nicht gesetzt');
  // eslint-disable-next-line global-require
  const Stripe = require('stripe');
  stripeClient = new Stripe(key, { apiVersion: '2024-12-18.acacia' });
  return stripeClient;
}

const VALID_PLANS = ['pro', 'team'];
const VALID_INTERVALS = ['month', 'year'];

function priceIdFor(plan, interval) {
  const map = {
    pro_month:  process.env.STRIPE_PRICE_PRO_MONTH,
    pro_year:   process.env.STRIPE_PRICE_PRO_YEAR,
    team_month: process.env.STRIPE_PRICE_TEAM_MONTH,
    team_year:  process.env.STRIPE_PRICE_TEAM_YEAR,
  };
  return map[`${plan}_${interval}`] || null;
}

function planForPriceId(priceId) {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_PRO_MONTH)  return { plan: 'pro',  interval: 'month' };
  if (priceId === process.env.STRIPE_PRICE_PRO_YEAR)   return { plan: 'pro',  interval: 'year'  };
  if (priceId === process.env.STRIPE_PRICE_TEAM_MONTH) return { plan: 'team', interval: 'month' };
  if (priceId === process.env.STRIPE_PRICE_TEAM_YEAR)  return { plan: 'team', interval: 'year'  };
  return null;
}

// ── DB-Schema (lazy, idempotent) ───────────────────────────────────────────
let schemaReady = false;
async function ensureSchema(pool) {
  if (schemaReady) return;
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_interval TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_stripe_sub      ON users(stripe_subscription_id)`);
  schemaReady = true;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function appBaseUrl(req) {
  const fromEnv = process.env.APP_BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function ensureCustomer(pool, user) {
  const stripe = getStripe();
  const result = await pool.query(
    'SELECT id, email, name, stripe_customer_id FROM users WHERE id = $1',
    [user.id]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Nutzer nicht gefunden');
  if (row.stripe_customer_id) return row.stripe_customer_id;

  const customer = await stripe.customers.create({
    email: row.email,
    name: row.name || undefined,
    metadata: { user_id: String(row.id) },
  });
  await pool.query(
    'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
    [customer.id, row.id]
  );
  return customer.id;
}

async function applySubscriptionToUser(pool, subscription) {
  if (!subscription) return;
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;
  if (!customerId) return;

  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id;
  const mapped = planForPriceId(priceId);
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;

  const status = subscription.status; // active, trialing, past_due, canceled, ...
  const isActive = status === 'active' || status === 'trialing';

  // Wenn nicht (mehr) aktiv: Plan auf free, expires bleibt für die App lesbar
  if (!isActive || !mapped) {
    await pool.query(
      `UPDATE users
         SET plan = 'free',
             plan_interval = NULL,
             plan_expires_at = $2,
             stripe_subscription_id = $3,
             plan_updated_at = NOW()
       WHERE stripe_customer_id = $1`,
      [customerId, periodEnd, subscription.id || null]
    );
    return;
  }

  await pool.query(
    `UPDATE users
       SET plan = $2,
           plan_interval = $3,
           plan_expires_at = $4,
           stripe_subscription_id = $5,
           plan_updated_at = NOW()
     WHERE stripe_customer_id = $1`,
    [customerId, mapped.plan, mapped.interval, periodEnd, subscription.id]
  );
}

// ── Handler ────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const subPath = req.query.__path || '';
  const segments = subPath.split('/').filter(Boolean);
  const action = segments[0] || '';

  // Webhook: KEIN CORS, raw body!
  if (action === 'webhook') {
    if (req.method !== 'POST') return res.status(405).end();
    return handleWebhook(req, res);
  }

  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'POST' && action === 'checkout')  return await handleCheckout(req, res);
    if (req.method === 'POST' && action === 'portal')    return await handlePortal(req, res);
    if (req.method === 'GET'  && action === 'session')   return await handleSession(req, res);
  } catch (err) {
    console.error('[billing] Fehler:', err);
    return res.status(500).json({ error: err.message || 'Interner Fehler' });
  }

  return res.status(404).json({ error: 'Nicht gefunden' });
};

// Vercel: Body fuer Webhook NICHT parsen (Stripe braucht raw bytes).
module.exports.config = {
  api: { bodyParser: false },
};

// ── /checkout ──────────────────────────────────────────────────────────────
async function handleCheckout(req, res) {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  // Vercel parst Body nicht (config.bodyParser=false) → selbst lesen
  const raw = await readRawBody(req);
  let body = {};
  try { body = raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch { body = {}; }

  const plan = String(body.plan || '').toLowerCase();
  const interval = String(body.interval || 'month').toLowerCase();

  if (!VALID_PLANS.includes(plan)) {
    return res.status(400).json({ error: 'Ungültiger Plan' });
  }
  if (!VALID_INTERVALS.includes(interval)) {
    return res.status(400).json({ error: 'Ungültiges Intervall' });
  }
  const priceId = priceIdFor(plan, interval);
  if (!priceId) {
    return res.status(500).json({ error: `Stripe-Preis für ${plan}/${interval} nicht konfiguriert` });
  }

  const pool = getPool();
  await ensureSchema(pool);
  const customerId = await ensureCustomer(pool, user);

  const stripe = getStripe();
  const base = appBaseUrl(req);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    automatic_tax: { enabled: false },
    billing_address_collection: 'auto',
    locale: 'de',
    client_reference_id: String(user.id),
    metadata: { user_id: String(user.id), plan, interval },
    subscription_data: {
      metadata: { user_id: String(user.id), plan, interval },
    },
    success_url: `${base}/app/upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${base}/app/upgrade/cancel`,
  });

  return res.json({ url: session.url, id: session.id });
}

// ── /portal ────────────────────────────────────────────────────────────────
async function handlePortal(req, res) {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const pool = getPool();
  await ensureSchema(pool);
  const customerId = await ensureCustomer(pool, user);

  const stripe = getStripe();
  const base = appBaseUrl(req);
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${base}/app/profile`,
  });
  return res.json({ url: session.url });
}

// ── /session ───────────────────────────────────────────────────────────────
async function handleSession(req, res) {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'session_id fehlt' });

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(id, {
    expand: ['subscription'],
  });

  // Wenn das Webhook noch nicht durch ist, hier defensiv den Status spiegeln
  if (session.subscription && session.payment_status === 'paid') {
    const pool = getPool();
    await ensureSchema(pool);
    await applySubscriptionToUser(pool, session.subscription);
  }

  const sub = session.subscription;
  return res.json({
    status: session.status,                  // open, complete, expired
    payment_status: session.payment_status,  // paid, unpaid, no_payment_required
    subscription_status: typeof sub === 'object' ? sub?.status : null,
    current_period_end: typeof sub === 'object' && sub?.current_period_end
      ? new Date(sub.current_period_end * 1000)
      : null,
  });
}

// ── /webhook ───────────────────────────────────────────────────────────────
async function handleWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return res.status(400).json({ error: 'Webhook-Signatur fehlt' });
  }

  let raw;
  try { raw = await readRawBody(req); } catch (err) {
    return res.status(400).json({ error: 'Body unlesbar: ' + err.message });
  }

  let event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error('[billing] Webhook-Signaturprüfung fehlgeschlagen:', err.message);
    return res.status(400).json({ error: `Signatur ungültig: ${err.message}` });
  }

  const pool = getPool();
  await ensureSchema(pool);
  const stripe = getStripe();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription' && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          await applySubscriptionToUser(pool, sub);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await applySubscriptionToUser(pool, event.data.object);
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription);
          await applySubscriptionToUser(pool, sub);
        }
        break;
      }
      default:
        // andere Events bewusst ignorieren
        break;
    }
  } catch (err) {
    console.error('[billing] Webhook-Verarbeitung fehlgeschlagen:', err);
    return res.status(500).json({ error: err.message });
  }

  return res.json({ received: true });
}
