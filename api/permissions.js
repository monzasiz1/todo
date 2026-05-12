const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');
const { cacheManager } = require('./_lib/cache');

function parseVirtualId(id) {
  if (typeof id !== 'string' || !id.startsWith('v_')) return null;
  const parts = id.split('_');
  if (parts.length < 3) return null;
  const date = parts[parts.length - 1];
  const parentId = parts.slice(1, -1).join('_');
  if (!parentId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { parentId, date };
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const subPath = req.query.__path || '';
  const segments = subPath.split('/').filter(Boolean);
  const pool = getPool();

  // GET /api/permissions/:taskId — get permissions for a task
  if (segments.length === 1 && req.method === 'GET') {
    try {
      const virtual = parseVirtualId(segments[0]);
      const taskId = virtual ? virtual.parentId : segments[0];

      // Verify task access (owner OR delegated editor)
      const task = await pool.query(
        `SELECT t.user_id, t.visibility, gt.group_id, gm.role as my_group_role
         FROM tasks t
         LEFT JOIN group_tasks gt ON gt.task_id = t.id
         LEFT JOIN group_members gm ON gm.group_id = gt.group_id AND gm.user_id = $2
         WHERE t.id = $1
         LIMIT 1`,
        [taskId, user.id]
      );
      if (task.rows.length === 0) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
      const isOwner = task.rows[0].user_id === user.id;
      const isGroupTask = task.rows[0].group_id != null;
      const isGroupAdmin = task.rows[0].my_group_role === 'owner' || task.rows[0].my_group_role === 'admin';
      if (isGroupTask && !isGroupAdmin) {
        return res.status(403).json({ error: 'Nur Gruppen-Owner/Admin duerfen Freigaben verwalten' });
      }
      if (!isOwner && !isGroupTask) {
        const canEdit = await pool.query(
          'SELECT 1 FROM task_permissions WHERE task_id = $1 AND user_id = $2 AND can_edit = true LIMIT 1',
          [taskId, user.id]
        );
        if (canEdit.rows.length === 0) return res.status(403).json({ error: 'Keine Berechtigung' });
      }

      const result = await pool.query(
        `SELECT tp.*, u.name as user_name, u.email as user_email, u.avatar_color, u.avatar_url
         FROM task_permissions tp
         JOIN users u ON u.id = tp.user_id
         WHERE tp.task_id = $1
         ORDER BY u.name ASC`,
        [taskId]
      );

      return res.json({
        visibility: task.rows[0].visibility,
        permissions: result.rows,
      });
    } catch (err) {
      console.error('Get permissions error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden der Berechtigungen' });
    }
  }

  // PUT /api/permissions/:taskId — set visibility + permissions for a task
  if (segments.length === 1 && req.method === 'PUT') {
    try {
      const virtual = parseVirtualId(segments[0]);
      const taskId = virtual ? virtual.parentId : segments[0];
      const { visibility, permissions } = req.body;

      // Verify task access (owner OR delegated editor)
      const task = await pool.query(
        `SELECT t.user_id, t.recurrence_rule, t.recurrence_parent_id, gt.group_id, gm.role as my_group_role
         FROM tasks t
         LEFT JOIN group_tasks gt ON gt.task_id = t.id
         LEFT JOIN group_members gm ON gm.group_id = gt.group_id AND gm.user_id = $2
         WHERE t.id = $1
         LIMIT 1`,
        [taskId, user.id]
      );
      if (task.rows.length === 0) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
      const isOwner = task.rows[0].user_id === user.id;
      const isGroupTask = task.rows[0].group_id != null;
      const isGroupAdmin = task.rows[0].my_group_role === 'owner' || task.rows[0].my_group_role === 'admin';
      if (isGroupTask && !isGroupAdmin) {
        return res.status(403).json({ error: 'Nur Gruppen-Owner/Admin duerfen Freigaben verwalten' });
      }
      if (!isOwner && !isGroupTask) {
        const canEdit = await pool.query(
          'SELECT 1 FROM task_permissions WHERE task_id = $1 AND user_id = $2 AND can_edit = true LIMIT 1',
          [taskId, user.id]
        );
        if (canEdit.rows.length === 0) return res.status(403).json({ error: 'Keine Berechtigung' });
      }

      // Determine all task IDs to update
      // Owner: recurring series = parent + all children
      // Delegated editor: only this task (no series-wide escalation)
      const row = task.rows[0];
      const ownerUserId = Number(row.user_id);
      const isRecurring = row.recurrence_rule || row.recurrence_parent_id;
      let allTaskIds = [parseInt(taskId, 10)];

      if (isOwner && isRecurring) {
        const parentId = row.recurrence_parent_id || parseInt(taskId);
        const seriesTasks = await pool.query(
          'SELECT id FROM tasks WHERE (id = $1 OR recurrence_parent_id = $1) AND user_id = $2',
          [parentId, user.id]
        );
        allTaskIds = seriesTasks.rows.map((r) => r.id);
      }

      const sanitizedPermissions = Array.isArray(permissions)
        ? permissions.filter((perm) => {
            const targetId = Number(perm?.user_id);
            if (!Number.isFinite(targetId)) return false;
            if (targetId === ownerUserId) return false;
            return true;
          })
        : [];

      // Delegated editor must keep own access after forwarding,
      // otherwise saving would remove their permission and the task disappears for them.
      let effectivePermissions = sanitizedPermissions;
      if (!isOwner && !isGroupTask) {
        const alreadyIncluded = sanitizedPermissions.some((perm) => Number(perm.user_id) === Number(user.id));
        if (!alreadyIncluded) {
          effectivePermissions = [
            ...sanitizedPermissions,
            {
              user_id: Number(user.id),
              can_view: true,
              can_edit: true,
            },
          ];
        }
      }

      const previousPermissionUsers = await pool.query(
        'SELECT DISTINCT user_id FROM task_permissions WHERE task_id = ANY($1::int[])',
        [allTaskIds]
      );

      // Delegated editors can only keep selected-user sharing.
      const requestedVisibility = isOwner ? visibility : 'selected_users';

      // Update visibility for all selected task IDs
      if (visibility) {
        await pool.query(
          `UPDATE tasks SET visibility = $1, updated_at = NOW() WHERE id = ANY($2::int[])`,
          [requestedVisibility, allTaskIds]
        );
      }

      // Update permissions for all tasks in the series
      if (permissions && Array.isArray(permissions)) {
        // Clear existing for all tasks in series
        await pool.query(
          'DELETE FROM task_permissions WHERE task_id = ANY($1::int[])',
          [allTaskIds]
        );

        // Insert new for each task in series
        for (const currentTaskId of allTaskIds) {
          for (const perm of effectivePermissions) {
            if (!perm.user_id) continue;
            await pool.query(
              `INSERT INTO task_permissions (task_id, user_id, can_view, can_edit)
               VALUES ($1, $2, $3, $4)`,
              [currentTaskId, perm.user_id, perm.can_view !== false, perm.can_edit === true]
            );
          }
        }

        // Track who last managed sharing so recipients can see the real forwarding sender.
        await pool.query(
          `UPDATE tasks
           SET last_edited_by = $1, updated_at = NOW()
           WHERE id = ANY($2::int[])`,
          [user.id, allTaskIds]
        );
      }

      // Return updated permissions for the requested task
      const result = await pool.query(
        `SELECT tp.*, u.name as user_name, u.email as user_email, u.avatar_color, u.avatar_url
         FROM task_permissions tp
         JOIN users u ON u.id = tp.user_id
         WHERE tp.task_id = $1`,
        [taskId]
      );

      // Invalidate dashboard caches for owner + all users touched by this permission change.
      const invalidateUserIds = new Set([String(ownerUserId)]);
      for (const prev of previousPermissionUsers.rows || []) {
        if (prev?.user_id != null) invalidateUserIds.add(String(prev.user_id));
      }
      for (const next of effectivePermissions) {
        if (next?.user_id != null) invalidateUserIds.add(String(next.user_id));
      }
      await Promise.all(
        Array.from(invalidateUserIds).map((uid) => cacheManager.invalidateByEvent(uid, 'task_updated'))
      ).catch(() => null);

      return res.json({
        visibility: requestedVisibility || 'private',
        permissions: result.rows,
        updated_series_count: allTaskIds.length,
      });
    } catch (err) {
      console.error('Set permissions error:', err);
      return res.status(500).json({ error: 'Fehler beim Setzen der Berechtigungen' });
    }
  }

  return res.status(404).json({ error: 'Route nicht gefunden' });
};
