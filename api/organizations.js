const crypto = require('crypto');
const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

function generateInviteCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function hasOrganizationsSchema(pool) {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'organizations'
     ) as exists`
  );
  return result.rows[0]?.exists === true;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const pool = getPool();
  const subPath = req.query.__path || '';
  const segments = subPath.split('/').filter(Boolean);

  try {
    const schemaReady = await hasOrganizationsSchema(pool);
    if (!schemaReady) {
      return res.status(503).json({
        error: 'Organizations-Schema fehlt. Bitte zuerst supabase-organizations.sql ausführen.',
      });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Schema-Prüfung fehlgeschlagen' });
  }

  // GET /api/organizations
  if (segments.length === 0 && req.method === 'GET') {
    try {
      const result = await pool.query(
        `SELECT o.*, om.role,
                (SELECT COUNT(*) FROM organization_members oom WHERE oom.organization_id = o.id) as member_count,
                (SELECT COUNT(*) FROM groups g WHERE g.organization_id = o.id) as group_count
         FROM organizations o
         JOIN organization_members om ON om.organization_id = o.id
         WHERE om.user_id = $1
         ORDER BY o.updated_at DESC`,
        [user.id]
      );
      return res.json({ organizations: result.rows });
    } catch (err) {
      console.error('List organizations error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden der Organisationen' });
    }
  }

  // POST /api/organizations
  if (segments.length === 0 && req.method === 'POST') {
    try {
      const { name, description, color } = req.body || {};
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Organisationsname erforderlich' });
      }

      const inviteCode = generateInviteCode();
      const created = await pool.query(
        `INSERT INTO organizations (name, description, color, invite_code, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [name.trim(), description || '', color || '#0A84FF', inviteCode, user.id]
      );

      const organization = created.rows[0];

      await pool.query(
        `INSERT INTO organization_members (organization_id, user_id, role)
         VALUES ($1, $2, 'admin')`,
        [organization.id, user.id]
      );

      return res.status(201).json({ organization: { ...organization, role: 'admin', member_count: 1, group_count: 0 } });
    } catch (err) {
      console.error('Create organization error:', err);
      return res.status(500).json({ error: 'Fehler beim Erstellen der Organisation' });
    }
  }

  // POST /api/organizations/join
  if (segments[0] === 'join' && req.method === 'POST') {
    try {
      const { code } = req.body || {};
      if (!code) return res.status(400).json({ error: 'Einladungscode erforderlich' });

      const orgRes = await pool.query(
        `SELECT * FROM organizations WHERE invite_code = $1 LIMIT 1`,
        [String(code).trim().toUpperCase()]
      );
      if (orgRes.rows.length === 0) return res.status(404).json({ error: 'Ungültiger Einladungscode' });
      const org = orgRes.rows[0];

      const existing = await pool.query(
        `SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2 LIMIT 1`,
        [org.id, user.id]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'Du bist bereits Mitglied dieser Organisation' });
      }

      await pool.query(
        `INSERT INTO organization_members (organization_id, user_id, role)
         VALUES ($1, $2, 'employee')`,
        [org.id, user.id]
      );

      return res.json({ success: true, organization: org });
    } catch (err) {
      console.error('Join organization error:', err);
      return res.status(500).json({ error: 'Beitritt fehlgeschlagen' });
    }
  }

  // GET /api/organizations/:id
  if (segments.length === 1 && req.method === 'GET') {
    const organizationId = segments[0];
    try {
      const membership = await pool.query(
        `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2 LIMIT 1`,
        [organizationId, user.id]
      );
      if (membership.rows.length === 0) {
        return res.status(403).json({ error: 'Kein Zugriff auf diese Organisation' });
      }

      const orgRes = await pool.query(
        `SELECT o.*,
                (SELECT COUNT(*) FROM organization_members m WHERE m.organization_id = o.id) as member_count,
                (SELECT COUNT(*) FROM groups g WHERE g.organization_id = o.id) as group_count
         FROM organizations o
         WHERE o.id = $1
         LIMIT 1`,
        [organizationId]
      );
      if (orgRes.rows.length === 0) return res.status(404).json({ error: 'Organisation nicht gefunden' });

      const membersRes = await pool.query(
        `SELECT om.user_id, om.role, om.joined_at, u.name, u.email, u.avatar_color, u.avatar_url
         FROM organization_members om
         JOIN users u ON u.id = om.user_id
         WHERE om.organization_id = $1
         ORDER BY CASE om.role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.name ASC`,
        [organizationId]
      );

      return res.json({ organization: { ...orgRes.rows[0], role: membership.rows[0].role }, members: membersRes.rows });
    } catch (err) {
      console.error('Get organization error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden der Organisation' });
    }
  }

  return res.status(404).json({ error: 'Nicht gefunden' });
};
