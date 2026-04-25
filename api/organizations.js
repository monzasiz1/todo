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

  async function getOrgMembership(organizationId) {
    const result = await pool.query(
      `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2 LIMIT 1`,
      [organizationId, user.id]
    );
    return result.rows[0] || null;
  }

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

  if (segments.length === 2 && segments[1] === 'groups' && req.method === 'GET') {
    try {
      const organizationId = segments[0];
      const membership = await getOrgMembership(organizationId);
      if (!membership) return res.status(403).json({ error: 'Kein Zugriff auf diese Organisation' });

      const groupsResult = await pool.query(
        `SELECT g.*, gm.role,
                o.name as organization_name, o.color as organization_color,
                (SELECT COUNT(*) FROM group_members WHERE group_id = g.id)::int as member_count,
                (SELECT COUNT(*) FROM group_tasks WHERE group_id = g.id)::int as task_count
         FROM groups g
         JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $2
         LEFT JOIN organizations o ON o.id = g.organization_id
         WHERE g.organization_id = $1
         ORDER BY g.updated_at DESC`,
        [organizationId, user.id]
      );

      return res.json({ groups: groupsResult.rows });
    } catch (err) {
      console.error('Get organization groups error:', err);
      return res.status(500).json({ error: 'Gruppen konnten nicht geladen werden' });
    }
  }

  if (segments.length === 3 && segments[1] === 'groups' && req.method === 'PUT') {
    try {
      const organizationId = segments[0];
      const groupId = segments[2];

      const membership = await getOrgMembership(organizationId);
      if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
        return res.status(403).json({ error: 'Nur Owner oder Admins koennen Gruppen zuordnen' });
      }

      const groupMembership = await pool.query(
        `SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
        [groupId, user.id]
      );
      const myGroupRole = groupMembership.rows[0]?.role || null;
      if (!myGroupRole || (myGroupRole !== 'owner' && myGroupRole !== 'admin')) {
        return res.status(403).json({ error: 'Du brauchst Admin- oder Owner-Rechte in der Gruppe' });
      }

      const updated = await pool.query(
        `UPDATE groups SET organization_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [organizationId, groupId]
      );
      if (updated.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });

      return res.json({ group: updated.rows[0] });
    } catch (err) {
      console.error('Assign group to organization error:', err);
      return res.status(500).json({ error: 'Gruppe konnte nicht zugeordnet werden' });
    }
  }

  if (segments.length === 3 && segments[1] === 'groups' && req.method === 'DELETE') {
    try {
      const organizationId = segments[0];
      const groupId = segments[2];

      const membership = await getOrgMembership(organizationId);
      if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
        return res.status(403).json({ error: 'Nur Owner oder Admins koennen Gruppen entfernen' });
      }

      const updated = await pool.query(
        `UPDATE groups
         SET organization_id = NULL, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [groupId, organizationId]
      );
      if (updated.rows.length === 0) {
        return res.status(404).json({ error: 'Zuordnung nicht gefunden' });
      }

      return res.json({ group: updated.rows[0] });
    } catch (err) {
      console.error('Remove group from organization error:', err);
      return res.status(500).json({ error: 'Gruppe konnte nicht entfernt werden' });
    }
  }

  return res.status(405).json({ error: 'Methode nicht erlaubt' });
};