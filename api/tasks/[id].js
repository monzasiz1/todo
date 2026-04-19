const { getPool } = require('../_lib/db');
const { verifyToken, cors } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const { id } = req.query;
  const pool = getPool();

  // PUT /api/tasks/:id — update task
  if (req.method === 'PUT') {
    try {
      const existing = await pool.query('SELECT * FROM tasks WHERE id = $1 AND user_id = $2', [id, user.id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
      }

      const current = existing.rows[0];
      const { title, description, date, time, category_id, priority, completed, reminder_at, sort_order } = req.body;

      const result = await pool.query(
        `UPDATE tasks SET
          title = $1, description = $2, date = $3, time = $4, category_id = $5,
          priority = $6, completed = $7, reminder_at = $8, sort_order = $9, updated_at = NOW()
        WHERE id = $10 AND user_id = $11 RETURNING *`,
        [
          title ?? current.title,
          description ?? current.description,
          date !== undefined ? date : current.date,
          time !== undefined ? time : current.time,
          category_id !== undefined ? category_id : current.category_id,
          priority ?? current.priority,
          completed !== undefined ? completed : current.completed,
          reminder_at !== undefined ? reminder_at : current.reminder_at,
          sort_order !== undefined ? sort_order : current.sort_order,
          id,
          user.id,
        ]
      );

      const task = await pool.query(
        `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
         FROM tasks t LEFT JOIN categories c ON t.category_id = c.id WHERE t.id = $1`,
        [result.rows[0].id]
      );

      return res.json({ task: task.rows[0] });
    } catch (err) {
      console.error('Update task error:', err);
      return res.status(500).json({ error: 'Aufgabe konnte nicht aktualisiert werden' });
    }
  }

  // DELETE /api/tasks/:id
  if (req.method === 'DELETE') {
    try {
      const result = await pool.query(
        'DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, user.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
      }
      return res.json({ deleted: true, id: parseInt(id) });
    } catch (err) {
      console.error('Delete task error:', err);
      return res.status(500).json({ error: 'Aufgabe konnte nicht gelöscht werden' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
