const crypto = require('crypto');
const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

function generateInviteCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const pool = getPool();
  const subPath = req.query.__path || '';
  const segments = subPath.split('/').filter(Boolean);

  if (segments.length === 0 && req.method === 'GET') {
    try {
      const result = await pool.query(
        `SELECT o.id, o.name, o.color, o.invite_code, om.role,
                COUNT(DISTINCT om2.user_id)::int AS member_count,
                COUNT(DISTINCT t.id)::int AS task_count
         FROM organizations o
         JOIN organization_members om ON om.organization_id = o.id AND om.user_id = $1
         LEFT JOIN organization_members om2 ON om2.organization_id = o.id
         LEFT JOIN tasks t ON t.source_organization_id = o.id
         GROUP BY o.id, om.role
         ORDER BY o.created_at DESC`,
        [user.id]
      );
      return res.json({ organizations: result.rows });
    } catch (err) {
      console.error('Get organizations error:', err);
      return res.status(500).json({ error: 'Organisationen konnten nicht geladen werden' });
    }
  }

  if (segments.length === 0 && req.method === 'POST') {
    try {
      const { name, color } = req.body || {};
      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'Name ist erforderlich' });
      }

      const inviteCode = generateInviteCode();
      const organizationResult = await pool.query(
        `INSERT INTO organizations (name, color, invite_code, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, color, invite_code`,
        [String(name).trim(), color || '#FF9500', inviteCode, user.id]
      );
      const organization = organizationResult.rows[0];

      await pool.query(
        `INSERT INTO organization_members (organization_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [organization.id, user.id]
      );

      return res.status(201).json({
        organization: {
          ...organization,
          role: 'owner',
          member_count: 1,
          task_count: 0,
        },
      });
    } catch (err) {
      console.error('Create organization error:', err);
      return res.status(500).json({ error: 'Organisation konnte nicht erstellt werden' });
    }
  }

  if (segments.length === 1 && segments[0] === 'join' && req.method === 'POST') {
    try {
      const code = String(req.body?.code || '').trim().toUpperCase();
      if (!code) return res.status(400).json({ error: 'Code ist erforderlich' });

      const orgResult = await pool.query(
        `SELECT id, name, color, invite_code FROM organizations WHERE invite_code = $1 LIMIT 1`,
        [code]
      );
      const organization = orgResult.rows[0];
      if (!organization) return res.status(404).json({ error: 'Organisation nicht gefunden' });

      await pool.query(
        `INSERT INTO organization_members (organization_id, user_id, role)
         VALUES ($1, $2, 'member')
         ON CONFLICT (organization_id, user_id) DO NOTHING`,
        [organization.id, user.id]
      );

      const statsResult = await pool.query(
        `SELECT COUNT(DISTINCT om.user_id)::int AS member_count,
                COUNT(DISTINCT t.id)::int AS task_count
         FROM organization_members om
         LEFT JOIN tasks t ON t.source_organization_id = $1
         WHERE om.organization_id = $1`,
        [organization.id]
      );

      return res.status(201).json({
        organization: {
          ...organization,
          role: 'member',
          member_count: statsResult.rows[0]?.member_count || 0,
          task_count: statsResult.rows[0]?.task_count || 0,
        },
      });
    } catch (err) {
      console.error('Join organization error:', err);
      return res.status(500).json({ error: 'Beitritt fehlgeschlagen' });
    }
  }

  if (segments.length === 1 && req.method === 'GET') {
    try {
      const organizationId = segments[0];
      const membership = await pool.query(
        `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2 LIMIT 1`,
        [organizationId, user.id]
      );
      if (membership.rows.length === 0) {
        return res.status(403).json({ error: 'Kein Zugriff auf diese Organisation' });
      }

      const organizationResult = await pool.query(
        `SELECT o.id, o.name, o.color, o.invite_code, om.role,
                COUNT(DISTINCT om2.user_id)::int AS member_count,
                COUNT(DISTINCT t.id)::int AS task_count
         FROM organizations o
         JOIN organization_members om ON om.organization_id = o.id AND om.user_id = $2
         LEFT JOIN organization_members om2 ON om2.organization_id = o.id
         LEFT JOIN tasks t ON t.source_organization_id = o.id
         WHERE o.id = $1
         GROUP BY o.id, om.role
         LIMIT 1`,
        [organizationId, user.id]
      );

      const membersResult = await pool.query(
        `SELECT om.user_id, om.role, u.name, u.avatar_color, u.avatar_url
         FROM organization_members om
         JOIN users u ON u.id = om.user_id
         WHERE om.organization_id = $1
         ORDER BY CASE WHEN om.role = 'owner' THEN 0 ELSE 1 END, u.name ASC`,
        [organizationId]
      );

      return res.json({
        organization: organizationResult.rows[0] || null,
        members: membersResult.rows,
      });
    } catch (err) {
      console.error('Get organization error:', err);
      return res.status(500).json({ error: 'Organisation konnte nicht geladen werden' });
    }
  }

  return res.status(405).json({ error: 'Methode nicht erlaubt' });
};