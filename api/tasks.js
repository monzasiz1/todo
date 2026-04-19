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

  // GET /api/tasks/range?start=...&end=...
  if (segments[0] === 'range' && req.method === 'GET') {
    try {
      const { start, end } = req.query || {};
      if (!start || !end) {
        return res.status(400).json({ error: 'Start- und Enddatum erforderlich' });
      }
      const result = await pool.query(
        `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
         FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.user_id = $1 AND t.date >= $2 AND t.date <= $3
         ORDER BY t.date ASC, t.sort_order ASC`,
        [user.id, start, end]
      );
      return res.json({ tasks: result.rows });
    } catch (err) {
      console.error('Tasks range error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden der Aufgaben' });
    }
  }

  // PATCH /api/tasks/reorder
  if (segments[0] === 'reorder' && req.method === 'PATCH') {
    try {
      const { taskIds } = req.body;
      if (!Array.isArray(taskIds)) {
        return res.status(400).json({ error: 'taskIds Array erforderlich' });
      }
      for (let i = 0; i < taskIds.length; i++) {
        await pool.query(
          'UPDATE tasks SET sort_order = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
          [i, taskIds[i], user.id]
        );
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('Reorder error:', err);
      return res.status(500).json({ error: 'Fehler beim Sortieren' });
    }
  }

  // GET /api/tasks/reminders/due
  if (segments[0] === 'reminders' && segments[1] === 'due' && req.method === 'GET') {
    try {
      const result = await pool.query(
        `SELECT t.*, c.name as category_name, c.color as category_color
         FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.user_id = $1 AND t.completed = false
         AND t.reminder_at IS NOT NULL AND t.reminder_at <= NOW()
         ORDER BY t.reminder_at ASC`,
        [user.id]
      );
      return res.json({ tasks: result.rows });
    } catch (err) {
      console.error('Reminders error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden der Erinnerungen' });
    }
  }

  // PATCH /api/tasks/:id/toggle
  if (segments.length === 2 && segments[1] === 'toggle' && req.method === 'PATCH') {
    try {
      const taskId = segments[0];
      const result = await pool.query(
        `UPDATE tasks SET completed = NOT completed, updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [taskId, user.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
      }
      return res.json({ task: result.rows[0] });
    } catch (err) {
      console.error('Toggle error:', err);
      return res.status(500).json({ error: 'Fehler beim Umschalten' });
    }
  }

  // PUT /api/tasks/:id
  if (segments.length === 1 && segments[0] !== 'range' && segments[0] !== 'reorder' && req.method === 'PUT') {
    try {
      const taskId = segments[0];
      const { title, description, date, time, time_end, priority, category_id, reminder_at } = req.body;
      const result = await pool.query(
        `UPDATE tasks SET title = COALESCE($1, title), description = COALESCE($2, description),
         date = COALESCE($3, date), time = COALESCE($4, time), time_end = $5,
         priority = COALESCE($6, priority), category_id = $7,
         reminder_at = $8, updated_at = NOW()
         WHERE id = $9 AND user_id = $10
         RETURNING *`,
        [title, description, date, time, time_end || null, priority, category_id, reminder_at, taskId, user.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
      }
      return res.json({ task: result.rows[0] });
    } catch (err) {
      console.error('Update error:', err);
      return res.status(500).json({ error: 'Fehler beim Aktualisieren' });
    }
  }

  // DELETE /api/tasks/:id
  if (segments.length === 1 && req.method === 'DELETE') {
    try {
      const taskId = segments[0];
      const result = await pool.query(
        'DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id',
        [taskId, user.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('Delete error:', err);
      return res.status(500).json({ error: 'Fehler beim Löschen' });
    }
  }

  // GET /api/tasks
  if (segments.length === 0 && req.method === 'GET') {
    try {
      const result = await pool.query(
        `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
         FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.user_id = $1
         ORDER BY t.sort_order ASC, t.created_at DESC`,
        [user.id]
      );
      return res.json({ tasks: result.rows });
    } catch (err) {
      console.error('Tasks list error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden der Aufgaben' });
    }
  }

  // POST /api/tasks
  if (segments.length === 0 && req.method === 'POST') {
    try {
      const { title, description, date, time, time_end, priority, category_id, reminder_at } = req.body;
      if (!title) {
        return res.status(400).json({ error: 'Titel ist erforderlich' });
      }

      const maxOrder = await pool.query(
        'SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM tasks WHERE user_id = $1',
        [user.id]
      );

      const result = await pool.query(
        `INSERT INTO tasks (user_id, title, description, date, time, time_end, priority, category_id, reminder_at, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [user.id, title, description || null, date || null, time || null, time_end || null,
         priority || 'medium', category_id || null, reminder_at || null,
         maxOrder.rows[0].next_order]
      );
      return res.status(201).json({ task: result.rows[0] });
    } catch (err) {
      console.error('Create task error:', err);
      return res.status(500).json({ error: 'Fehler beim Erstellen der Aufgabe' });
    }
  }

  return res.status(404).json({ error: 'Route nicht gefunden' });
};
