const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

const EXPENSE_CATEGORIES = new Set(['food', 'home', 'travel', 'free']);
const INCOME_CATEGORIES = new Set(['salary', 'gift', 'side', 'other']);
const ALLOWED_KINDS = new Set(['income', 'expense']);
const ALLOWED_RECURRENCES = new Set(['none', 'monthly', 'quarterly', 'yearly']);

// Hex-Color in #RRGGBB normalisieren; bei Ungueltigkeit faellt auf Fallback zurueck.
function normalizeHexColor(input, fallback) {
  const raw = String(input || '').trim();
  if (/^#([0-9a-fA-F]{6})$/.test(raw)) return raw.toLowerCase();
  if (/^#([0-9a-fA-F]{3})$/.test(raw)) {
    const c = raw.slice(1);
    return ('#' + c[0] + c[0] + c[1] + c[1] + c[2] + c[2]).toLowerCase();
  }
  return fallback;
}

// Category-ID-Format:
//   Preset: 'food' | 'home' | 'travel' | 'free' (Expense) bzw. 'salary' | 'gift' | 'side' | 'other' (Income)
//   Custom: 'custom:NUMBER' wobei NUMBER = spending_custom_categories.id
async function validateCategoryForKind(pool, groupId, kind, category) {
  const cat = String(category || '');
  if (cat.startsWith('custom:')) {
    const id = Number(cat.slice(7));
    if (!Number.isFinite(id)) return false;
    const r = await pool.query(
      `SELECT 1 FROM spending_custom_categories
       WHERE id = $1 AND spending_group_id = $2 AND kind = $3`,
      [id, groupId, kind]
    );
    return r.rows.length > 0;
  }
  if (kind === 'income') return INCOME_CATEGORIES.has(cat);
  return EXPENSE_CATEGORIES.has(cat);
}

// Splits: Array von { user_id, amount } — Summe muss zu amount passen (+/- 0.02€ Toleranz).
// Alle user_ids muessen Mitglieder der Gruppe sein. NULL/leeres Array = nur der Payer ist beteiligt.
async function validateSplit(pool, groupId, amount, splitAmounts, payerUserId) {
  if (splitAmounts == null) return { ok: true, value: null };
  if (!Array.isArray(splitAmounts)) return { ok: false, error: 'split_amounts muss Array sein' };
  if (splitAmounts.length === 0) return { ok: true, value: null };

  const clean = [];
  let sum = 0;
  const seenIds = new Set();
  for (const s of splitAmounts) {
    const uid = Number(s?.user_id);
    const amt = Number(s?.amount);
    if (!Number.isFinite(uid)) return { ok: false, error: 'split: user_id ungueltig' };
    if (!Number.isFinite(amt) || amt < 0) return { ok: false, error: 'split: amount ungueltig' };
    if (seenIds.has(uid)) return { ok: false, error: 'split: doppelte user_id' };
    seenIds.add(uid);
    clean.push({ user_id: uid, amount: Math.round(amt * 100) / 100 });
    sum += amt;
  }

  // Alle Mitglieder muessen valide Group-Member sein
  const ids = clean.map((s) => s.user_id);
  const memCheck = await pool.query(
    `SELECT user_id FROM spending_members
     WHERE spending_group_id = $1 AND user_id = ANY($2) AND status = 'accepted'
     UNION
     SELECT owner_id AS user_id FROM spending_groups WHERE id = $1 AND owner_id = ANY($2)`,
    [groupId, ids]
  );
  if (memCheck.rows.length !== ids.length) {
    return { ok: false, error: 'split: nicht alle Mitglieder sind Teil der Gruppe' };
  }

  // Summe muss zur Gesamtsumme passen (kleine Rundungs-Toleranz)
  if (Math.abs(sum - amount) > 0.05) {
    return { ok: false, error: `split: Summe (${sum.toFixed(2)}) passt nicht zu Betrag (${amount.toFixed(2)})` };
  }

  return { ok: true, value: clean };
}

async function isGroupMember(pool, groupId, userId) {
  const r = await pool.query(
    `SELECT 1 FROM spending_groups WHERE id = $1 AND owner_id = $2
     UNION
     SELECT 1 FROM spending_members WHERE spending_group_id = $1 AND user_id = $2 AND status = 'accepted'`,
    [groupId, userId]
  );
  return r.rows.length > 0;
}

function sanitizeDate(value) {
  if (!value) return null;
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// Pro warmer Lambda-Instanz nur EINMAL ausfuehren. Ohne diesen Guard liefe
// das komplette DDL-Set (CREATE/ALTER/UPDATE/INDEX) bei jedem Request — beim
// Oeffnen der Ausgaben-Seite feuern aber gleich mehrere GETs, was die Ladezeit
// unnoetig vervielfacht. Schema-Aenderungen bleiben idempotent.
let tablesReady = false;

async function ensureTables(pool) {
  if (tablesReady) return;
  // Idempotent guard fuer produktive Cold-Starts mit deaktiviertem
  // schemaInit (DB_SCHEMA_INIT_ON_START=0). Verhindert 500-Errors fuer
  // den allerersten Aufruf.
  await pool.query(`CREATE TABLE IF NOT EXISTS spending_groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS spending_members (
    id SERIAL PRIMARY KEY,
    spending_group_id INTEGER NOT NULL REFERENCES spending_groups(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
    invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(spending_group_id, user_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS spending_expenses (
    id SERIAL PRIMARY KEY,
    spending_group_id INTEGER NOT NULL REFERENCES spending_groups(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(40) NOT NULL,
    amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
    description TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`ALTER TABLE spending_expenses ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'expense'`);
  await pool.query(`ALTER TABLE spending_expenses ADD COLUMN IF NOT EXISTS recurrence VARCHAR(20) NOT NULL DEFAULT 'none'`);
  await pool.query(`ALTER TABLE spending_expenses ADD COLUMN IF NOT EXISTS entry_date DATE`);
  await pool.query(`ALTER TABLE spending_expenses ADD COLUMN IF NOT EXISTS recurrence_end DATE`);
  await pool.query(`UPDATE spending_expenses SET entry_date = created_at::DATE WHERE entry_date IS NULL`);
  await pool.query(`CREATE TABLE IF NOT EXISTS spending_overrides (
    id SERIAL PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES spending_expenses(id) ON DELETE CASCADE,
    override_month CHAR(7) NOT NULL,
    kind VARCHAR(20) NOT NULL DEFAULT 'skip' CHECK (kind IN ('skip', 'amount')),
    amount NUMERIC(10,2),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(entry_id, override_month)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS spending_custom_categories (
    id SERIAL PRIMARY KEY,
    spending_group_id INTEGER NOT NULL REFERENCES spending_groups(id) ON DELETE CASCADE,
    kind VARCHAR(10) NOT NULL CHECK (kind IN ('income', 'expense')),
    label VARCHAR(80) NOT NULL,
    color VARCHAR(20) NOT NULL DEFAULT '#94A3B8',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_spending_custom_categories_group ON spending_custom_categories(spending_group_id, kind)`);
  await pool.query(`ALTER TABLE spending_expenses ADD COLUMN IF NOT EXISTS split_amounts JSONB`);
  tablesReady = true;
}

function sanitizeMonth(value) {
  if (!value) return null;
  const s = String(value).slice(0, 7);
  return /^\d{4}-\d{2}$/.test(s) ? s : null;
}

async function isOwner(pool, groupId, userId) {
  const r = await pool.query(
    'SELECT 1 FROM spending_groups WHERE id = $1 AND owner_id = $2',
    [groupId, userId]
  );
  return r.rows.length > 0;
}

async function isAcceptedMemberOrOwner(pool, groupId, userId) {
  const r = await pool.query(
    `SELECT 1 FROM spending_groups WHERE id = $1 AND owner_id = $2
     UNION
     SELECT 1 FROM spending_members WHERE spending_group_id = $1 AND user_id = $2 AND status = 'accepted'`,
    [groupId, userId]
  );
  return r.rows.length > 0;
}

async function areFriends(pool, userA, userB) {
  const r = await pool.query(
    `SELECT 1 FROM friends
     WHERE status = 'accepted'
       AND ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))`,
    [userA, userB]
  );
  return r.rows.length > 0;
}

async function loadGroupDetail(pool, groupId, userId) {
  const groupRes = await pool.query(
    `SELECT g.id, g.name, g.owner_id, g.created_at,
            u.name AS owner_name, u.email AS owner_email, u.avatar_color AS owner_avatar_color, u.avatar_url AS owner_avatar_url
     FROM spending_groups g
     JOIN users u ON u.id = g.owner_id
     WHERE g.id = $1`,
    [groupId]
  );
  if (groupRes.rows.length === 0) return null;
  const group = groupRes.rows[0];

  const membersRes = await pool.query(
    `SELECT m.id, m.user_id, m.status, m.invited_by, m.joined_at,
            u.name, u.email, u.avatar_color, u.avatar_url
     FROM spending_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.spending_group_id = $1
     ORDER BY m.joined_at ASC`,
    [groupId]
  );

  const entriesRes = await pool.query(
    `SELECT e.id, e.user_id, e.kind, e.category, e.amount, e.description, e.created_at,
            e.recurrence, e.entry_date, e.recurrence_end, e.split_amounts,
            u.name AS user_name, u.avatar_color AS user_avatar_color
     FROM spending_expenses e
     JOIN users u ON u.id = e.user_id
     WHERE e.spending_group_id = $1
     ORDER BY COALESCE(e.entry_date, e.created_at::DATE) DESC, e.created_at DESC`,
    [groupId]
  );

  const all = entriesRes.rows.map((row) => ({
    ...row,
    amount: Number(row.amount),
    split_amounts: row.split_amounts || null,
  }));

  // Custom Categories der Gruppe laden
  const catRes = await pool.query(
    `SELECT id, kind, label, color, created_by, created_at
     FROM spending_custom_categories
     WHERE spending_group_id = $1
     ORDER BY created_at ASC`,
    [groupId]
  );

  // Overrides fuer alle Eintraege dieser Gruppe laden
  const entryIds = all.map((e) => e.id);
  let overrides = [];
  if (entryIds.length > 0) {
    const ovRes = await pool.query(
      `SELECT id, entry_id, override_month, kind, amount, created_by, created_at
       FROM spending_overrides
       WHERE entry_id = ANY($1)`,
      [entryIds]
    );
    overrides = ovRes.rows.map((row) => ({
      ...row,
      amount: row.amount != null ? Number(row.amount) : null,
    }));
  }

  return {
    ...group,
    is_owner: group.owner_id === userId,
    members: membersRes.rows,
    expenses: all.filter((e) => (e.kind || 'expense') === 'expense'),
    incomes: all.filter((e) => e.kind === 'income'),
    overrides,
    custom_categories: catRes.rows,
  };
}

async function loadPendingGroupInfo(pool, groupId, userId) {
  const groupRes = await pool.query(
    `SELECT g.id, g.name, g.owner_id, g.created_at,
            u.name AS owner_name, u.email AS owner_email, u.avatar_color AS owner_avatar_color, u.avatar_url AS owner_avatar_url
     FROM spending_groups g
     JOIN users u ON u.id = g.owner_id
     WHERE g.id = $1`,
    [groupId]
  );
  if (groupRes.rows.length === 0) return null;

  return {
    ...groupRes.rows[0],
    my_status: 'pending',
    is_owner: false,
    members: [],
    expenses: [],
    incomes: [],
    overrides: [],
    custom_categories: [],
  };
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const subPath = req.query.__path || '';
  const segments = subPath.split('/').filter(Boolean);
  const pool = getPool();

  try {
    await ensureTables(pool);
  } catch (err) {
    console.warn('[spending] ensureTables warn:', err.message);
  }

  try {
    // GET /api/spending — liste alle Gruppen des Users (eigene + akzeptierte + offene Einladungen)
    if (segments.length === 0 && req.method === 'GET') {
      const result = await pool.query(
        `SELECT g.id, g.name, g.owner_id, g.created_at,
                CASE
                  WHEN g.owner_id = $1 THEN 'accepted'
                  ELSE m.status
                END AS my_status,
                CASE
                  WHEN g.owner_id = $1 OR m.status = 'accepted' THEN COALESCE(member_counts.member_count, 0)
                  ELSE NULL
                END AS member_count,
                CASE
                  WHEN g.owner_id = $1 OR m.status = 'accepted' THEN COALESCE(sums.total_expense, 0)::float
                  ELSE NULL
                END AS total_amount,
                CASE
                  WHEN g.owner_id = $1 OR m.status = 'accepted' THEN COALESCE(sums.total_income, 0)::float
                  ELSE NULL
                END AS total_income,
                u.name AS owner_name, u.avatar_color AS owner_avatar_color, u.avatar_url AS owner_avatar_url
         FROM spending_groups g
         LEFT JOIN spending_members m ON m.spending_group_id = g.id AND m.user_id = $1
         LEFT JOIN (
           SELECT spending_group_id, COUNT(*) + 1 AS member_count
           FROM spending_members WHERE status = 'accepted' GROUP BY spending_group_id
         ) member_counts ON member_counts.spending_group_id = g.id
         LEFT JOIN (
           SELECT spending_group_id,
                  SUM(CASE WHEN COALESCE(kind, 'expense') = 'expense' THEN amount ELSE 0 END) AS total_expense,
                  SUM(CASE WHEN kind = 'income' THEN amount ELSE 0 END) AS total_income
           FROM spending_expenses GROUP BY spending_group_id
         ) sums ON sums.spending_group_id = g.id
         JOIN users u ON u.id = g.owner_id
         WHERE g.owner_id = $1
            OR EXISTS (SELECT 1 FROM spending_members WHERE spending_group_id = g.id AND user_id = $1)
         ORDER BY g.created_at DESC`,
        [user.id]
      );
      return res.json({ groups: result.rows });
    }

    // POST /api/spending — neue Gruppe anlegen
    if (segments.length === 0 && req.method === 'POST') {
      const { name } = req.body || {};
      const cleanName = String(name || '').trim().slice(0, 120);
      if (!cleanName) return res.status(400).json({ error: 'Name erforderlich' });

      const result = await pool.query(
        `INSERT INTO spending_groups (name, owner_id) VALUES ($1, $2) RETURNING *`,
        [cleanName, user.id]
      );
      return res.status(201).json({ group: result.rows[0] });
    }

    // GET /api/spending/:id — Detail
    if (segments.length === 1 && req.method === 'GET') {
      const groupId = Number(segments[0]);
      if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Ungueltige ID' });
      const allowed = await isAcceptedMemberOrOwner(pool, groupId, user.id);
      if (!allowed) {
        const pending = await pool.query(
          `SELECT 1 FROM spending_members WHERE spending_group_id = $1 AND user_id = $2 AND status = 'pending'`,
          [groupId, user.id]
        );
        if (pending.rows.length === 0) return res.status(403).json({ error: 'Kein Zugriff' });

        const detail = await loadPendingGroupInfo(pool, groupId, user.id);
        if (!detail) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
        return res.json({ group: detail });
      }
      const detail = await loadGroupDetail(pool, groupId, user.id);
      if (!detail) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
      return res.json({ group: detail });
    }

    // DELETE /api/spending/:id — Owner loescht Gruppe
    if (segments.length === 1 && req.method === 'DELETE') {
      const groupId = Number(segments[0]);
      if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Ungueltige ID' });
      const owner = await isOwner(pool, groupId, user.id);
      if (!owner) return res.status(403).json({ error: 'Nur der Owner darf loeschen' });
      await pool.query('DELETE FROM spending_groups WHERE id = $1', [groupId]);
      return res.json({ success: true });
    }

    // POST /api/spending/:id/invite — Freund per E-Mail einladen
    if (segments.length === 2 && segments[1] === 'invite' && req.method === 'POST') {
      const groupId = Number(segments[0]);
      const { email, user_id: targetUserId } = req.body || {};
      if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Ungueltige ID' });

      const owner = await isOwner(pool, groupId, user.id);
      const memberOk = owner || await isAcceptedMemberOrOwner(pool, groupId, user.id);
      if (!memberOk) return res.status(403).json({ error: 'Kein Zugriff' });

      let friend;
      if (targetUserId) {
        const r = await pool.query(
          'SELECT id, name, email, avatar_color, avatar_url FROM users WHERE id = $1',
          [targetUserId]
        );
        friend = r.rows[0];
      } else if (email) {
        const r = await pool.query(
          'SELECT id, name, email, avatar_color, avatar_url FROM users WHERE LOWER(email) = LOWER($1)',
          [String(email).trim()]
        );
        friend = r.rows[0];
      } else {
        return res.status(400).json({ error: 'E-Mail oder user_id erforderlich' });
      }

      if (!friend) return res.status(404).json({ error: 'Kein Nutzer mit dieser E-Mail gefunden' });
      if (friend.id === user.id) return res.status(400).json({ error: 'Du bist bereits dabei' });

      const friendsOk = await areFriends(pool, user.id, friend.id);
      if (!friendsOk) {
        return res.status(400).json({ error: 'Ihr seid noch nicht befreundet — sende erst eine Freundschaftsanfrage' });
      }

      const existing = await pool.query(
        'SELECT id, status FROM spending_members WHERE spending_group_id = $1 AND user_id = $2',
        [groupId, friend.id]
      );
      if (existing.rows.length > 0) {
        const s = existing.rows[0].status;
        if (s === 'accepted') return res.status(400).json({ error: 'Person ist bereits Mitglied' });
        if (s === 'pending') return res.status(400).json({ error: 'Einladung bereits gesendet' });
        // declined → erneut anbieten
        await pool.query(
          `UPDATE spending_members
             SET status = 'pending', invited_by = $1, joined_at = NOW()
             WHERE id = $2`,
          [user.id, existing.rows[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO spending_members (spending_group_id, user_id, status, invited_by)
           VALUES ($1, $2, 'pending', $3)`,
          [groupId, friend.id, user.id]
        );
      }

      return res.status(201).json({
        invited: {
          id: friend.id,
          name: friend.name,
          email: friend.email,
          avatar_color: friend.avatar_color,
        },
      });
    }

    // PATCH /api/spending/:id/accept — Einladung annehmen
    if (segments.length === 2 && segments[1] === 'accept' && req.method === 'PATCH') {
      const groupId = Number(segments[0]);
      const r = await pool.query(
        `UPDATE spending_members SET status = 'accepted'
         WHERE spending_group_id = $1 AND user_id = $2 AND status = 'pending'
         RETURNING *`,
        [groupId, user.id]
      );
      if (r.rows.length === 0) {
        const existing = await pool.query(
          'SELECT status FROM spending_members WHERE spending_group_id = $1 AND user_id = $2',
          [groupId, user.id]
        );
        if (existing.rows.length > 0) {
          const status = existing.rows[0].status;
          if (status === 'accepted') return res.status(400).json({ error: 'Einladung bereits angenommen' });
          if (status === 'declined') return res.status(400).json({ error: 'Einladung wurde abgelehnt' });
        }
        return res.status(404).json({ error: 'Einladung nicht gefunden' });
      }
      return res.json({ success: true });
    }

    // PATCH /api/spending/:id/decline — Einladung ablehnen
    if (segments.length === 2 && segments[1] === 'decline' && req.method === 'PATCH') {
      const groupId = Number(segments[0]);
      const r = await pool.query(
        `UPDATE spending_members SET status = 'declined'
         WHERE spending_group_id = $1 AND user_id = $2 AND status = 'pending'
         RETURNING *`,
        [groupId, user.id]
      );
      if (r.rows.length === 0) return res.status(404).json({ error: 'Einladung nicht gefunden' });
      return res.json({ success: true });
    }

    // DELETE /api/spending/:id/leave — Gruppe verlassen
    if (segments.length === 2 && segments[1] === 'leave' && req.method === 'DELETE') {
      const groupId = Number(segments[0]);
      const owner = await isOwner(pool, groupId, user.id);
      if (owner) return res.status(400).json({ error: 'Owner muss die Gruppe loeschen, nicht verlassen' });
      await pool.query(
        'DELETE FROM spending_members WHERE spending_group_id = $1 AND user_id = $2',
        [groupId, user.id]
      );
      return res.json({ success: true });
    }

    // DELETE /api/spending/:id/members/:userId — Mitglied entfernen (nur Owner)
    if (segments.length === 3 && segments[1] === 'members' && req.method === 'DELETE') {
      const groupId = Number(segments[0]);
      const targetUserId = Number(segments[2]);
      const owner = await isOwner(pool, groupId, user.id);
      if (!owner) return res.status(403).json({ error: 'Nur der Owner darf entfernen' });
      if (targetUserId === user.id) return res.status(400).json({ error: 'Du kannst dich nicht selbst entfernen' });
      await pool.query(
        'DELETE FROM spending_members WHERE spending_group_id = $1 AND user_id = $2',
        [groupId, targetUserId]
      );
      return res.json({ success: true });
    }

    // POST /api/spending/:id/entries — Eintrag hinzufuegen (income | expense)
    // (Alias /expenses bleibt fuer Rueckwaertskompatibilitaet erhalten.)
    if (segments.length === 2 && (segments[1] === 'entries' || segments[1] === 'expenses') && req.method === 'POST') {
      const groupId = Number(segments[0]);
      const {
        kind = 'expense', category, amount, description,
        recurrence = 'none', entry_date, recurrence_end,
        payer_user_id, split_amounts,
      } = req.body || {};
      if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Ungueltige ID' });
      if (!ALLOWED_KINDS.has(String(kind))) return res.status(400).json({ error: 'Art ungueltig' });
      const catOk = await validateCategoryForKind(pool, groupId, kind, category);
      if (!catOk) return res.status(400).json({ error: 'Kategorie ungueltig' });
      if (!ALLOWED_RECURRENCES.has(String(recurrence))) {
        return res.status(400).json({ error: 'Wiederholung ungueltig' });
      }
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt < 0 || amt > 10_000_000) {
        return res.status(400).json({ error: 'Betrag ungueltig' });
      }

      const allowed = await isAcceptedMemberOrOwner(pool, groupId, user.id);
      if (!allowed) return res.status(403).json({ error: 'Kein Zugriff' });

      // Payer: optional, default = caller. Muss Group-Member sein.
      let payerId = user.id;
      if (payer_user_id != null) {
        const pid = Number(payer_user_id);
        if (!Number.isFinite(pid)) return res.status(400).json({ error: 'payer_user_id ungueltig' });
        const memOk = await isGroupMember(pool, groupId, pid);
        if (!memOk) return res.status(400).json({ error: 'Payer ist kein Group-Member' });
        payerId = pid;
      }

      // Split validieren (nur bei Ausgaben sinnvoll, bei Einnahmen ignoriert)
      let splitVal = null;
      if (kind === 'expense' && split_amounts) {
        const sv = await validateSplit(pool, groupId, amt, split_amounts, payerId);
        if (!sv.ok) return res.status(400).json({ error: sv.error });
        splitVal = sv.value;
      }

      const entryDate = sanitizeDate(entry_date) || new Date().toISOString().slice(0, 10);
      const recEnd = sanitizeDate(recurrence_end);

      const result = await pool.query(
        `INSERT INTO spending_expenses
           (spending_group_id, user_id, kind, category, amount, description,
            recurrence, entry_date, recurrence_end, split_amounts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, user_id, kind, category, amount, description,
                   recurrence, entry_date, recurrence_end, split_amounts, created_at`,
        [
          groupId, payerId, kind, category, amt,
          String(description || '').slice(0, 500),
          recurrence, entryDate, recEnd,
          splitVal ? JSON.stringify(splitVal) : null,
        ]
      );
      const row = result.rows[0];
      return res.status(201).json({
        entry: { ...row, amount: Number(row.amount), split_amounts: row.split_amounts || null },
      });
    }

    // PUT /api/spending/:id/entries/:id — Eintrag bearbeiten
    if (segments.length === 3 && (segments[1] === 'entries' || segments[1] === 'expenses') && req.method === 'PUT') {
      const groupId = Number(segments[0]);
      const entryId = Number(segments[2]);
      const {
        kind, category, amount, description,
        recurrence, entry_date, recurrence_end,
        payer_user_id, split_amounts,
      } = req.body || {};

      // Berechtigung: eigener Eintrag oder Owner
      const owner = await isOwner(pool, groupId, user.id);
      const ownCheck = await pool.query(
        `SELECT user_id FROM spending_expenses WHERE id = $1 AND spending_group_id = $2`,
        [entryId, groupId]
      );
      if (ownCheck.rows.length === 0) return res.status(404).json({ error: 'Eintrag nicht gefunden' });
      if (!owner && ownCheck.rows[0].user_id !== user.id) {
        return res.status(403).json({ error: 'Kein Zugriff' });
      }

      // Validierung
      if (!ALLOWED_KINDS.has(String(kind))) return res.status(400).json({ error: 'Art ungueltig' });
      const catOk = await validateCategoryForKind(pool, groupId, kind, category);
      if (!catOk) return res.status(400).json({ error: 'Kategorie ungueltig' });
      if (!ALLOWED_RECURRENCES.has(String(recurrence))) return res.status(400).json({ error: 'Wiederholung ungueltig' });
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt < 0 || amt > 10_000_000) return res.status(400).json({ error: 'Betrag ungueltig' });

      // Payer (optional ueberschreiben)
      let payerId = ownCheck.rows[0].user_id;
      if (payer_user_id != null) {
        const pid = Number(payer_user_id);
        if (!Number.isFinite(pid)) return res.status(400).json({ error: 'payer_user_id ungueltig' });
        const memOk = await isGroupMember(pool, groupId, pid);
        if (!memOk) return res.status(400).json({ error: 'Payer ist kein Group-Member' });
        payerId = pid;
      }

      // Split validieren
      let splitVal = null;
      if (kind === 'expense' && split_amounts) {
        const sv = await validateSplit(pool, groupId, amt, split_amounts, payerId);
        if (!sv.ok) return res.status(400).json({ error: sv.error });
        splitVal = sv.value;
      }

      const entryDate = sanitizeDate(entry_date) || new Date().toISOString().slice(0, 10);
      const recEnd = sanitizeDate(recurrence_end);

      const result = await pool.query(
        `UPDATE spending_expenses
            SET kind = $1, category = $2, amount = $3, description = $4,
                recurrence = $5, entry_date = $6, recurrence_end = $7,
                user_id = $8, split_amounts = $9
          WHERE id = $10 AND spending_group_id = $11
       RETURNING id, user_id, kind, category, amount, description,
                 recurrence, entry_date, recurrence_end, split_amounts, created_at`,
        [
          kind, category, amt, String(description || '').slice(0, 500),
          recurrence, entryDate, recEnd,
          payerId, splitVal ? JSON.stringify(splitVal) : null,
          entryId, groupId,
        ]
      );
      const row = result.rows[0];
      return res.json({
        entry: { ...row, amount: Number(row.amount), split_amounts: row.split_amounts || null },
      });
    }

    // DELETE /api/spending/:id/entries/:id (Alias: /expenses/:id)
    if (segments.length === 3 && (segments[1] === 'entries' || segments[1] === 'expenses') && req.method === 'DELETE') {
      const groupId = Number(segments[0]);
      const expenseId = Number(segments[2]);
      const owner = await isOwner(pool, groupId, user.id);
      const where = owner
        ? 'id = $1 AND spending_group_id = $2'
        : 'id = $1 AND spending_group_id = $2 AND user_id = $3';
      const params = owner ? [expenseId, groupId] : [expenseId, groupId, user.id];
      const r = await pool.query(`DELETE FROM spending_expenses WHERE ${where} RETURNING id`, params);
      if (r.rows.length === 0) return res.status(404).json({ error: 'Ausgabe nicht gefunden' });
      return res.json({ success: true });
    }

    // POST /api/spending/:id/entries/:id/override — Skip oder Custom-Amount fuer einen Monat
    if (segments.length === 4 && (segments[1] === 'entries' || segments[1] === 'expenses') && segments[3] === 'override' && req.method === 'POST') {
      const groupId = Number(segments[0]);
      const entryId = Number(segments[2]);
      const { month, kind = 'skip', amount } = req.body || {};

      const monthStr = sanitizeMonth(month);
      if (!monthStr) return res.status(400).json({ error: 'Monat ungueltig (Format YYYY-MM)' });
      if (!['skip', 'amount'].includes(kind)) return res.status(400).json({ error: 'Override-Art ungueltig' });

      // Eintrag muss zur Gruppe gehoeren + User Berechtigung
      const owner = await isOwner(pool, groupId, user.id);
      const ownCheck = await pool.query(
        `SELECT user_id, recurrence FROM spending_expenses WHERE id = $1 AND spending_group_id = $2`,
        [entryId, groupId]
      );
      if (ownCheck.rows.length === 0) return res.status(404).json({ error: 'Eintrag nicht gefunden' });
      if (!owner && ownCheck.rows[0].user_id !== user.id) return res.status(403).json({ error: 'Kein Zugriff' });
      if (ownCheck.rows[0].recurrence === 'none') {
        return res.status(400).json({ error: 'Overrides nur fuer wiederkehrende Eintraege' });
      }

      let amt = null;
      if (kind === 'amount') {
        amt = Number(amount);
        if (!Number.isFinite(amt) || amt < 0 || amt > 10_000_000) {
          return res.status(400).json({ error: 'Betrag ungueltig' });
        }
      }

      const result = await pool.query(
        `INSERT INTO spending_overrides (entry_id, override_month, kind, amount, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (entry_id, override_month) DO UPDATE
           SET kind = EXCLUDED.kind, amount = EXCLUDED.amount, created_by = EXCLUDED.created_by, created_at = NOW()
         RETURNING id, entry_id, override_month, kind, amount, created_at`,
        [entryId, monthStr, kind, amt, user.id]
      );
      const row = result.rows[0];
      return res.json({ override: { ...row, amount: row.amount != null ? Number(row.amount) : null } });
    }

    // DELETE /api/spending/:id/entries/:id/override?month=YYYY-MM — Override aufheben
    if (segments.length === 4 && (segments[1] === 'entries' || segments[1] === 'expenses') && segments[3] === 'override' && req.method === 'DELETE') {
      const groupId = Number(segments[0]);
      const entryId = Number(segments[2]);
      const monthStr = sanitizeMonth(req.query.month);
      if (!monthStr) return res.status(400).json({ error: 'Monat ungueltig' });

      const owner = await isOwner(pool, groupId, user.id);
      const ownCheck = await pool.query(
        `SELECT user_id FROM spending_expenses WHERE id = $1 AND spending_group_id = $2`,
        [entryId, groupId]
      );
      if (ownCheck.rows.length === 0) return res.status(404).json({ error: 'Eintrag nicht gefunden' });
      if (!owner && ownCheck.rows[0].user_id !== user.id) return res.status(403).json({ error: 'Kein Zugriff' });

      await pool.query(
        `DELETE FROM spending_overrides WHERE entry_id = $1 AND override_month = $2`,
        [entryId, monthStr]
      );
      return res.json({ success: true });
    }

    // POST /api/spending/:id/categories — Benutzerdefinierte Kategorie hinzufuegen
    if (segments.length === 2 && segments[1] === 'categories' && req.method === 'POST') {
      const groupId = Number(segments[0]);
      const { kind, label, color } = req.body || {};
      if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Ungueltige ID' });
      if (!['income', 'expense'].includes(String(kind))) return res.status(400).json({ error: 'Kind ungueltig' });
      const cleanLabel = String(label || '').trim().slice(0, 80);
      if (!cleanLabel) return res.status(400).json({ error: 'Label erforderlich' });
      const cleanColor = normalizeHexColor(color, '#94A3B8');

      const allowed = await isAcceptedMemberOrOwner(pool, groupId, user.id);
      if (!allowed) return res.status(403).json({ error: 'Kein Zugriff' });

      const result = await pool.query(
        `INSERT INTO spending_custom_categories
           (spending_group_id, kind, label, color, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, kind, label, color, created_by, created_at`,
        [groupId, kind, cleanLabel, cleanColor, user.id]
      );
      const row = result.rows[0];
      return res.status(201).json({ category: row });
    }

    // PATCH /api/spending/:id/categories/:id — Benutzerdefinierte Kategorie aktualisieren
    if (segments.length === 3 && segments[1] === 'categories' && req.method === 'PATCH') {
      const groupId = Number(segments[0]);
      const categoryId = Number(segments[2]);
      if (!Number.isFinite(groupId) || !Number.isFinite(categoryId)) {
        return res.status(400).json({ error: 'Ungueltige ID' });
      }
      const { label, color } = req.body || {};
      const cleanLabel = String(label || '').trim().slice(0, 80);
      if (!cleanLabel) return res.status(400).json({ error: 'Label erforderlich' });
      const cleanColor = normalizeHexColor(color, '#94A3B8');

      const allowed = await isAcceptedMemberOrOwner(pool, groupId, user.id);
      if (!allowed) return res.status(403).json({ error: 'Kein Zugriff' });

      const r = await pool.query(
        `UPDATE spending_custom_categories
            SET label = $1, color = $2
          WHERE id = $3 AND spending_group_id = $4
       RETURNING id, kind, label, color, created_by, created_at`,
        [cleanLabel, cleanColor, categoryId, groupId]
      );
      if (r.rows.length === 0) return res.status(404).json({ error: 'Kategorie nicht gefunden' });
      return res.json({ category: r.rows[0] });
    }

    // DELETE /api/spending/:id/categories/:id — Benutzerdefinierte Kategorie loeschen
    if (segments.length === 3 && segments[1] === 'categories' && req.method === 'DELETE') {
      const groupId = Number(segments[0]);
      const categoryId = Number(segments[2]);
      if (!Number.isFinite(groupId) || !Number.isFinite(categoryId)) {
        return res.status(400).json({ error: 'Ungueltige ID' });
      }

      const allowed = await isAcceptedMemberOrOwner(pool, groupId, user.id);
      if (!allowed) return res.status(403).json({ error: 'Kein Zugriff' });

      const r = await pool.query(
        `DELETE FROM spending_custom_categories
         WHERE id = $1 AND spending_group_id = $2
         RETURNING id`,
        [categoryId, groupId]
      );
      if (r.rows.length === 0) return res.status(404).json({ error: 'Kategorie nicht gefunden' });
      return res.json({ success: true });
    }

    return res.status(404).json({ error: 'Route nicht gefunden' });
  } catch (err) {
    console.error('Spending API error:', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
};
