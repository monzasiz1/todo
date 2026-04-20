const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

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
      const taskId = segments[0];

      // Verify task ownership
      const task = await pool.query('SELECT user_id, visibility FROM tasks WHERE id = $1', [taskId]);
      if (task.rows.length === 0) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
      if (task.rows[0].user_id !== user.id) return res.status(403).json({ error: 'Keine Berechtigung' });

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
      const taskId = segments[0];
      const { visibility, permissions } = req.body;

      // Verify task ownership
      const task = await pool.query(
        'SELECT user_id, recurrence_rule, recurrence_parent_id FROM tasks WHERE id = $1',
        [taskId]
      );
      if (task.rows.length === 0) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
      if (task.rows[0].user_id !== user.id) return res.status(403).json({ error: 'Keine Berechtigung' });

      // Determine all task IDs to update (recurring series = parent + all children)
      const row = task.rows[0];
      const isRecurring = row.recurrence_rule || row.recurrence_parent_id;
      let allTaskIds = [parseInt(taskId)];

      if (isRecurring) {
        const parentId = row.recurrence_parent_id || parseInt(taskId);
        const seriesTasks = await pool.query(
          'SELECT id FROM tasks WHERE (id = $1 OR recurrence_parent_id = $1) AND user_id = $2',
          [parentId, user.id]
        );
        allTaskIds = seriesTasks.rows.map((r) => r.id);
      }

      // Update visibility for all tasks in the series
      if (visibility) {
        await pool.query(
          `UPDATE tasks SET visibility = $1, updated_at = NOW() WHERE id = ANY($2::int[])`,
          [visibility, allTaskIds]
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
          for (const perm of permissions) {
            if (!perm.user_id) continue;
            await pool.query(
              `INSERT INTO task_permissions (task_id, user_id, can_view, can_edit)
               VALUES ($1, $2, $3, $4)`,
              [currentTaskId, perm.user_id, perm.can_view !== false, perm.can_edit === true]
            );
          }
        }
      }

      // Return updated permissions for the requested task
      const result = await pool.query(
        `SELECT tp.*, u.name as user_name, u.email as user_email, u.avatar_color, u.avatar_url
         FROM task_permissions tp
         JOIN users u ON u.id = tp.user_id
         WHERE tp.task_id = $1`,
        [taskId]
      );

      return res.json({
        visibility: visibility || 'private',
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
