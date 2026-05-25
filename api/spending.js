const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

const ALLOWED_CATEGORIES = new Set(['food', 'home', 'travel', 'free']);

async function ensureTables(pool) {
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
            u.name AS owner_name, u.email AS owner_email, u.avatar_color AS owner_avatar_color
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

  const expensesRes = await pool.query(
    `SELECT e.id, e.user_id, e.category, e.amount, e.description, e.created_at,
            u.name AS user_name, u.avatar_color AS user_avatar_color
     FROM spending_expenses e
     JOIN users u ON u.id = e.user_id
     WHERE e.spending_group_id = $1
     ORDER BY e.created_at DESC`,
    [groupId]
  );

  return {
    ...group,
    is_owner: group.owner_id === userId,
    members: membersRes.rows,
    expenses: expensesRes.rows.map((row) => ({
      ...row,
      amount: Number(row.amount),
    })),
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
                COALESCE(member_counts.member_count, 0) AS member_count,
                COALESCE(expense_sums.total_amount, 0)::float AS total_amount,
                u.name AS owner_name, u.avatar_color AS owner_avatar_color
         FROM spending_groups g
         LEFT JOIN spending_members m ON m.spending_group_id = g.id AND m.user_id = $1
         LEFT JOIN (
           SELECT spending_group_id, COUNT(*) + 1 AS member_count
           FROM spending_members WHERE status = 'accepted' GROUP BY spending_group_id
         ) member_counts ON member_counts.spending_group_id = g.id
         LEFT JOIN (
           SELECT spending_group_id, SUM(amount) AS total_amount
           FROM spending_expenses GROUP BY spending_group_id
         ) expense_sums ON expense_sums.spending_group_id = g.id
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
      // Pending-Member duerfen die Detail-Sicht auch sehen, damit sie die
      // Einladung im Dashboard sehen koennen.
      if (!allowed) {
        const pending = await pool.query(
          `SELECT 1 FROM spending_members WHERE spending_group_id = $1 AND user_id = $2`,
          [groupId, user.id]
        );
        if (pending.rows.length === 0) return res.status(403).json({ error: 'Kein Zugriff' });
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
      if (r.rows.length === 0) return res.status(404).json({ error: 'Einladung nicht gefunden' });
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

    // POST /api/spending/:id/expenses — Ausgabe hinzufuegen
    if (segments.length === 2 && segments[1] === 'expenses' && req.method === 'POST') {
      const groupId = Number(segments[0]);
      const { category, amount, description } = req.body || {};
      if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Ungueltige ID' });
      if (!ALLOWED_CATEGORIES.has(String(category))) {
        return res.status(400).json({ error: 'Kategorie ungueltig' });
      }
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt < 0 || amt > 1_000_000) {
        return res.status(400).json({ error: 'Betrag ungueltig' });
      }

      const allowed = await isAcceptedMemberOrOwner(pool, groupId, user.id);
      if (!allowed) return res.status(403).json({ error: 'Kein Zugriff' });

      const result = await pool.query(
        `INSERT INTO spending_expenses (spending_group_id, user_id, category, amount, description)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, category, amount, description, created_at`,
        [groupId, user.id, category, amt, String(description || '').slice(0, 500)]
      );
      const row = result.rows[0];
      return res.status(201).json({
        expense: { ...row, amount: Number(row.amount) },
      });
    }

    // DELETE /api/spending/:id/expenses/:expenseId — Ausgabe loeschen (eigene oder als Owner)
    if (segments.length === 3 && segments[1] === 'expenses' && req.method === 'DELETE') {
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

    return res.status(404).json({ error: 'Route nicht gefunden' });
  } catch (err) {
    console.error('Spending API error:', err);
    return res.status(500).json({ error: 'Serverfehler' });
  }
};
