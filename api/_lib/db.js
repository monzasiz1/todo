const { Pool } = require('pg');

let pool;
let schemaInitPromise = null;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function shouldRunSchemaInit() {
  const explicit = String(process.env.DB_SCHEMA_INIT_ON_START || '').trim().toLowerCase();
  if (explicit === '1' || explicit === 'true' || explicit === 'yes') return true;
  if (explicit === '0' || explicit === 'false' || explicit === 'no') return false;
  return process.env.NODE_ENV !== 'production';
}

async function runSchemaInit(rawQuery) {
  const statements = [
    // Notifications core
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL,
      keys_p256dh TEXT NOT NULL,
      keys_auth TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, endpoint)
    )`,
    `CREATE TABLE IF NOT EXISTS mobile_push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      token TEXT NOT NULL,
      device_info TEXT DEFAULT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, platform, token)
    )`,
    `CREATE TABLE IF NOT EXISTS notification_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      sent_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_push_sub_user ON push_subscriptions(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mobile_push_user ON mobile_push_subscriptions(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_notif_log_user_type ON notification_log(user_id, type, sent_at)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{"reminder":true,"daily_tasks":true,"engagement":true,"team_task":true,"group_message":true}'::jsonb`,
    // Task location (free-text Ort / Google-Maps Query)
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS location TEXT`,

    // Groups core
    `CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      description TEXT DEFAULT '',
      color VARCHAR(7) DEFAULT '#007AFF',
      image_url TEXT DEFAULT NULL,
      icon VARCHAR(20) DEFAULT 'users',
      invite_code VARCHAR(8) UNIQUE,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `ALTER TABLE groups ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`,
    `ALTER TABLE groups ADD COLUMN IF NOT EXISTS color VARCHAR(7) DEFAULT '#007AFF'`,
    `ALTER TABLE groups ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT NULL`,
    `ALTER TABLE groups ADD COLUMN IF NOT EXISTS icon VARCHAR(20) DEFAULT 'users'`,
    `ALTER TABLE groups ADD COLUMN IF NOT EXISTS invite_code VARCHAR(8)`,
    `ALTER TABLE groups ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE groups ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE groups ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `CREATE TABLE IF NOT EXISTS group_members (
      id SERIAL PRIMARY KEY,
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(group_id, user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS group_tasks (
      id SERIAL PRIMARY KEY,
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(group_id, task_id)
    )`,
    `CREATE TABLE IF NOT EXISTS group_categories (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      color VARCHAR(7) NOT NULL DEFAULT '#8E8E93',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(group_id, name)
    )`,
    `ALTER TABLE group_tasks ADD COLUMN IF NOT EXISTS group_category_id INTEGER REFERENCES group_categories(id) ON DELETE SET NULL`,
    `CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id)`,
    `CREATE INDEX IF NOT EXISTS idx_group_tasks_group ON group_tasks(group_id)`,
    `CREATE INDEX IF NOT EXISTS idx_group_tasks_task ON group_tasks(task_id)`,
    `CREATE INDEX IF NOT EXISTS idx_group_tasks_group_category ON group_tasks(group_category_id)`,
    `CREATE INDEX IF NOT EXISTS idx_group_categories_group ON group_categories(group_id)`,
    `CREATE INDEX IF NOT EXISTS idx_groups_invite_code ON groups(invite_code)`,
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conname = 'groups_invite_code_key'
       ) THEN
         BEGIN
           ALTER TABLE groups ADD CONSTRAINT groups_invite_code_key UNIQUE (invite_code);
         EXCEPTION WHEN duplicate_table OR duplicate_object THEN
           NULL;
         END;
       END IF;
     END $$`,

    // Group chat/messages
    `CREATE TABLE IF NOT EXISTS group_messages (
      id BIGSERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
      is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
      pinned_at TIMESTAMPTZ,
      pinned_by INTEGER REFERENCES users(id),
      edited_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS is_poll BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ`,
    `ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS pinned_by INTEGER REFERENCES users(id)`,
    `ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ`,
    `ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS poll_options JSONB`,
    `ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text'`,
    `ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS linked_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL`,
    `ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS responsible_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS responsible_role TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_group_messages_group_id ON group_messages(group_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_group_messages_pinned ON group_messages(group_id, is_pinned)`,
    `CREATE INDEX IF NOT EXISTS idx_group_messages_type ON group_messages(group_id, message_type)`,
    `CREATE INDEX IF NOT EXISTS idx_group_messages_linked_task ON group_messages(linked_task_id)`,

    // Group polls + RSVP
    `CREATE TABLE IF NOT EXISTS group_poll_votes (
      id BIGSERIAL PRIMARY KEY,
      message_id BIGINT NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      option_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(message_id, user_id, option_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_poll_votes_message ON group_poll_votes(message_id)`,
    `CREATE TABLE IF NOT EXISTS group_event_rsvps (
      id BIGSERIAL PRIMARY KEY,
      message_id BIGINT NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('yes', 'maybe', 'no')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(message_id, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_group_event_rsvps_message ON group_event_rsvps(message_id)`,

    // Shared spending: gemeinsame Ausgaben-Gruppen mit Mitgliedern und Ausgaben.
    `CREATE TABLE IF NOT EXISTS spending_groups (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_spending_groups_owner ON spending_groups(owner_id)`,
    `CREATE TABLE IF NOT EXISTS spending_members (
      id SERIAL PRIMARY KEY,
      spending_group_id INTEGER NOT NULL REFERENCES spending_groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
      invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(spending_group_id, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_spending_members_group ON spending_members(spending_group_id)`,
    `CREATE INDEX IF NOT EXISTS idx_spending_members_user ON spending_members(user_id, status)`,
    `CREATE TABLE IF NOT EXISTS spending_expenses (
      id SERIAL PRIMARY KEY,
      spending_group_id INTEGER NOT NULL REFERENCES spending_groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category VARCHAR(40) NOT NULL,
      amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
      description TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `ALTER TABLE spending_expenses ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'expense'`,
    `ALTER TABLE spending_expenses ADD COLUMN IF NOT EXISTS recurrence VARCHAR(20) NOT NULL DEFAULT 'none'`,
    `ALTER TABLE spending_expenses ADD COLUMN IF NOT EXISTS entry_date DATE`,
    `ALTER TABLE spending_expenses ADD COLUMN IF NOT EXISTS recurrence_end DATE`,
    // Backfill: entry_date aus created_at fuer alte Eintraege
    `UPDATE spending_expenses SET entry_date = created_at::DATE WHERE entry_date IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_spending_expenses_group ON spending_expenses(spending_group_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_spending_expenses_user ON spending_expenses(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_spending_expenses_kind ON spending_expenses(spending_group_id, kind)`,
    `CREATE INDEX IF NOT EXISTS idx_spending_expenses_recurrence ON spending_expenses(spending_group_id, recurrence)`,
    // Pro-Monat Overrides fuer recurring Eintraege: skip, custom amount
    `CREATE TABLE IF NOT EXISTS spending_overrides (
      id SERIAL PRIMARY KEY,
      entry_id INTEGER NOT NULL REFERENCES spending_expenses(id) ON DELETE CASCADE,
      override_month CHAR(7) NOT NULL,
      kind VARCHAR(20) NOT NULL DEFAULT 'skip' CHECK (kind IN ('skip', 'amount')),
      amount NUMERIC(10,2),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(entry_id, override_month)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_spending_overrides_entry ON spending_overrides(entry_id, override_month)`,

    // Custom Categories pro Gruppe (zusaetzlich zu den Preset-Kategorien)
    `CREATE TABLE IF NOT EXISTS spending_custom_categories (
      id SERIAL PRIMARY KEY,
      spending_group_id INTEGER NOT NULL REFERENCES spending_groups(id) ON DELETE CASCADE,
      kind VARCHAR(10) NOT NULL CHECK (kind IN ('income', 'expense')),
      label VARCHAR(80) NOT NULL,
      color VARCHAR(20) NOT NULL DEFAULT '#94A3B8',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_spending_custom_categories_group ON spending_custom_categories(spending_group_id, kind)`,

    // Splits: optionale Aufteilung einer Buchung auf mehrere Mitglieder.
    // NULL/leer = nur payer (user_id) traegt den gesamten Betrag.
    // JSONB-Array: [{ user_id: 1, amount: 12.50 }, ...]  — summiert sich zu amount.
    `ALTER TABLE spending_expenses ADD COLUMN IF NOT EXISTS split_amounts JSONB`,

    // Ensure required preference keys exist on older rows
    `UPDATE users
     SET notification_prefs = COALESCE(notification_prefs, '{}'::jsonb)
                             || '{"reminder":true,"daily_tasks":true,"engagement":true,"team_task":true,"group_message":true}'::jsonb
     WHERE notification_prefs IS NULL
        OR NOT (notification_prefs ? 'reminder')
        OR NOT (notification_prefs ? 'daily_tasks')
        OR NOT (notification_prefs ? 'engagement')
        OR NOT (notification_prefs ? 'team_task')
        OR NOT (notification_prefs ? 'group_message')`,
  ];

  for (const sql of statements) {
    try {
      await rawQuery(sql);
    } catch (err) {
      // Keep boot resilient: continue with best-effort schema healing.
      console.warn('[db] schema init statement failed:', err.message);
    }
  }
}

// Kritische Tabellen/Spalten, die für Push/Benachrichtigungen IMMER existieren
// müssen — auch in Produktion, wo die volle runSchemaInit() aus Performance-
// Gründen abgeschaltet ist. Alle Statements sind idempotent (IF NOT EXISTS) und
// laufen einmalig pro Function-Instance, bevor irgendeine Query ausgeführt wird.
const CRITICAL_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL,
      keys_p256dh TEXT NOT NULL,
      keys_auth TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, endpoint)
    )`,
  `CREATE TABLE IF NOT EXISTS mobile_push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      token TEXT NOT NULL,
      device_info TEXT DEFAULT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, platform, token)
    )`,
  `CREATE TABLE IF NOT EXISTS notification_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      sent_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS idx_push_sub_user ON push_subscriptions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_mobile_push_user ON mobile_push_subscriptions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notif_log_user_type ON notification_log(user_id, type, sent_at)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT NOW()`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{"reminder":true,"daily_tasks":true,"engagement":true,"team_task":true,"group_message":true}'::jsonb`,
];

async function ensureCriticalSchema(rawQuery) {
  for (const sql of CRITICAL_SCHEMA_STATEMENTS) {
    try {
      await rawQuery(sql);
    } catch (err) {
      console.warn('[db] critical schema statement failed:', err.message);
    }
  }
}

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    // In serverless, many function instances can run in parallel.
    // Keep per-instance pool small to avoid hitting global DB connection limits.
    const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    const defaultMax = isServerless ? 1 : 5;
    const poolMax = parsePositiveInt(process.env.DB_POOL_MAX, defaultMax);
    // Aggressives Idle-Timeout in serverless: Verbindung sofort freigeben,
    // damit gleichzeitige Lambda-Instanzen das Supabase pool_size=15 Limit
    // des Session-Poolers nicht sprengen.
    const defaultIdle = isServerless ? 250 : 10000;
    const poolIdleTimeoutMs = parsePositiveInt(process.env.DB_POOL_IDLE_TIMEOUT_MS, defaultIdle);
    const poolConnTimeoutMs = parsePositiveInt(process.env.DB_POOL_CONN_TIMEOUT_MS, 10000);

    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: poolMax,
      idleTimeoutMillis: poolIdleTimeoutMs,
      connectionTimeoutMillis: poolConnTimeoutMs,
      allowExitOnIdle: true,
    });

    pool.on('error', (err) => {
      console.warn('[db] pool error:', err.message);
    });

    // One-shot lightweight migrations that must always run, even when
    // DB_SCHEMA_INIT_ON_START is disabled (e.g. production). Idempotent.
    // Per-ENV abschaltbar (DB_AUTO_MIGRATIONS=0), damit produktive Cold-Starts
    // keine zusaetzliche DB-Connection verbrauchen.
    if (String(process.env.DB_AUTO_MIGRATIONS ?? '1') !== '0') {
      pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS location TEXT")
        .catch((err) => console.warn('[db] auto-migration (tasks.location) failed:', err.message));
    }

    const originalQuery = pool.query.bind(pool);

    // Kritisches Notif-/Push-Schema läuft IMMER (auch Prod), die volle
    // runSchemaInit nur außerhalb der Produktion. pool.query wartet unten auf
    // schemaInitPromise, sodass die Push-Tabellen vor jeder Query existieren.
    if (!schemaInitPromise) {
      schemaInitPromise = (async () => {
        await ensureCriticalSchema(originalQuery);
        if (shouldRunSchemaInit()) {
          await runSchemaInit(originalQuery);
        }
      })().catch((err) => {
        console.warn('[db] schema initialization failed:', err.message);
      });
    }

    pool.query = async (...args) => {
      if (schemaInitPromise) await schemaInitPromise;
      // Retry-Layer: bei Supabase-Pool-Engpass (EMAXCONNSESSION) und
      // transienten Netzfehlern kurz mit Jitter warten und erneut versuchen.
      // Verhindert, dass Cold-Start-Bursts Endpoints reihenweise auf 500 setzen.
      const MAX_ATTEMPTS = 4;
      let attempt = 0;
      while (true) {
        try {
          return await originalQuery(...args);
        } catch (err) {
          const code = err && (err.code || '');
          const msg = String((err && err.message) || '');
          const isPoolExhausted =
            code === 'EMAXCONNSESSION' ||
            /max clients reached/i.test(msg) ||
            /too many connections/i.test(msg) ||
            code === 'ECONNRESET' ||
            code === 'ETIMEDOUT';
          attempt += 1;
          if (!isPoolExhausted || attempt >= MAX_ATTEMPTS) throw err;
          // 60 → 180 → 540 ms + Jitter
          const base = 60 * Math.pow(3, attempt - 1);
          const wait = base + Math.floor(Math.random() * 80);
          await new Promise((r) => setTimeout(r, wait));
        }
      }
    };
  }
  return pool;
}

module.exports = { getPool };
