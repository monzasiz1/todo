const { getPool } = require('../_lib/db');
const { verifyToken, cors } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const pool = getPool();
  const pathSegments = req.query.path || [];

  // GET /api/tasks — list all tasks
  if (pathSegments.length === 0 && req.method === 'GET') {
    try {
      const { date, category, priority, completed, search } = req.query;
      let query = 'SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon FROM tasks t LEFT JOIN categories c ON t.category_id = c.id WHERE t.user_id = $1';
      const params = [user.id];
      let idx = 2;

      if (date) { query += ` AND t.date = $${idx++}`; params.push(date); }
      if (category) { query += ` AND t.category_id = $${idx++}`; params.push(category); }
      if (priority) { query += ` AND t.priority = $${idx++}`; params.push(priority); }
      if (completed !== undefined) { query += ` AND t.completed = $${idx++}`; params.push(completed === 'true'); }
      if (search) { query += ` AND t.title ILIKE $${idx++}`; params.push(`%${search}%`); }

      query += ' ORDER BY t.date ASC NULLS LAST, t.time ASC NULLS LAST, t.created_at DESC';
      const result = await pool.query(query, params);
      return res.json({ tasks: result.rows });
    } catch (err) {
      console.error('Get tasks error:', err);
      return res.status(500).json({ error: 'Aufgaben konnten nicht geladen werden' });
    }
  }

  // POST /api/tasks — create task
  if (pathSegments.length === 0 && req.method === 'POST') {
    try {
      const { title, description, date, time, category_id, priority, reminder_at } = req.body;
      if (!title) return res.status(400).json({ error: 'Titel ist erforderlich' });

      const result = await pool.query(
        `INSERT INTO tasks (user_id, title, description, date, time, category_id, priority, reminder_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [user.id, title, description || null, date || null, time || null, category_id || null, priority || 'medium', reminder_at || null]
      );

      const task = await pool.query(
        `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
         FROM tasks t LEFT JOIN categories c ON t.category_id = c.id WHERE t.id = $1`,
        [result.rows[0].id]
      );
      return res.status(201).json({ task: task.rows[0] });
    } catch (err) {
      console.error('Create task error:', err);
      return res.status(500).json({ error: 'Aufgabe konnte nicht erstellt werden' });
    }
  }

  // GET /api/tasks/range?start=&end=
  if (pathSegments[0] === 'range' && req.method === 'GET') {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Start- und Enddatum erforderlich' });

    try {
      const result = await pool.query(
        `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
         FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.user_id = $1 AND t.date >= $2 AND t.date <= $3
         ORDER BY t.date ASC, t.time ASC NULLS LAST`,
        [user.id, start, end]
      );
      return res.json({ tasks: result.rows });
    } catch (err) {
      console.error('Tasks range error:', err);
      return res.status(500).json({ error: 'Aufgaben konnten nicht geladen werden' });
    }
  }

  // PATCH /api/tasks/reorder
  if (pathSegments[0] === 'reorder' && req.method === 'PATCH') {
    try {
      const { taskIds } = req.body;
      if (!Array.isArray(taskIds)) return res.status(400).json({ error: 'taskIds Array erforderlich' });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let i = 0; i < taskIds.length; i++) {
          await client.query(
            'UPDATE tasks SET sort_order = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
            [i, taskIds[i], user.id]
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('Reorder error:', err);
      return res.status(500).json({ error: 'Reihenfolge konnte nicht geändert werden' });
    }
  }

  // GET /api/tasks/reminders/due
  if (pathSegments[0] === 'reminders' && pathSegments[1] === 'due' && req.method === 'GET') {
    try {
      const result = await pool.query(
        `SELECT t.*, c.name as category_name, c.color as category_color
         FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.user_id = $1 AND t.reminder_at <= NOW() AND t.reminder_sent = false AND t.completed = false
         ORDER BY t.reminder_at ASC`,
        [user.id]
      );

      if (result.rows.length > 0) {
        const ids = result.rows.map((r) => r.id);
        await pool.query('UPDATE tasks SET reminder_sent = true WHERE id = ANY($1)', [ids]);
      }

      return res.json({ reminders: result.rows });
    } catch (err) {
      console.error('Reminders error:', err);
      return res.status(500).json({ error: 'Erinnerungen konnten nicht geladen werden' });
    }
  }

  // PATCH /api/tasks/:id/toggle
  if (pathSegments.length === 2 && pathSegments[1] === 'toggle' && req.method === 'PATCH') {
    const id = pathSegments[0];
    try {
      const result = await pool.query(
        `UPDATE tasks SET completed = NOT completed, updated_at = NOW()
         WHERE id = $1 AND user_id = $2 RETURNING *`,
        [id, user.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });

      const task = await pool.query(
        `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
         FROM tasks t LEFT JOIN categories c ON t.category_id = c.id WHERE t.id = $1`,
        [result.rows[0].id]
      );
      return res.json({ task: task.rows[0] });
    } catch (err) {
      console.error('Toggle task error:', err);
      return res.status(500).json({ error: 'Status konnte nicht geändert werden' });
    }
  }

  // PUT /api/tasks/:id — update task
  if (pathSegments.length === 1 && req.method === 'PUT') {
    const id = pathSegments[0];
    try {
      const existing = await pool.query('SELECT * FROM tasks WHERE id = $1 AND user_id = $2', [id, user.id]);
      if (existing.rows.length === 0) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });

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
  if (pathSegments.length === 1 && req.method === 'DELETE') {
    const id = pathSegments[0];
    try {
      const result = await pool.query(
        'DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, user.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
      return res.json({ deleted: true, id: parseInt(id) });
    } catch (err) {
      console.error('Delete task error:', err);
      return res.status(500).json({ error: 'Aufgabe konnte nicht gelöscht werden' });
    }
  }

  return res.status(404).json({ error: 'Route nicht gefunden' });
};
