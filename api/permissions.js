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
        `SELECT tp.*, u.name as user_name, u.email as user_email, u.avatar_color
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
      const task = await pool.query('SELECT user_id FROM tasks WHERE id = $1', [taskId]);
      if (task.rows.length === 0) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
      if (task.rows[0].user_id !== user.id) return res.status(403).json({ error: 'Keine Berechtigung' });

      // Update task visibility
      if (visibility) {
        await pool.query(
          'UPDATE tasks SET visibility = $1, updated_at = NOW() WHERE id = $2',
          [visibility, taskId]
        );
      }

      // Update permissions
      if (permissions && Array.isArray(permissions)) {
        // Clear existing
        await pool.query('DELETE FROM task_permissions WHERE task_id = $1', [taskId]);

        // Insert new
        for (const perm of permissions) {
          if (!perm.user_id) continue;
          await pool.query(
            `INSERT INTO task_permissions (task_id, user_id, can_view, can_edit)
             VALUES ($1, $2, $3, $4)`,
            [taskId, perm.user_id, perm.can_view !== false, perm.can_edit === true]
          );
        }
      }

      // Return updated permissions
      const result = await pool.query(
        `SELECT tp.*, u.name as user_name, u.email as user_email, u.avatar_color
         FROM task_permissions tp
         JOIN users u ON u.id = tp.user_id
         WHERE tp.task_id = $1`,
        [taskId]
      );

      return res.json({
        visibility: visibility || 'private',
        permissions: result.rows,
      });
    } catch (err) {
      console.error('Set permissions error:', err);
      return res.status(500).json({ error: 'Fehler beim Setzen der Berechtigungen' });
    }
  }

  return res.status(404).json({ error: 'Route nicht gefunden' });
};
