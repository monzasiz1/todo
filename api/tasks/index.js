const { getPool } = require('../_lib/db');
const { verifyToken, cors } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const pool = getPool();

  // GET /api/tasks — list tasks
  if (req.method === 'GET') {
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
  if (req.method === 'POST') {
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

  return res.status(405).json({ error: 'Method not allowed' });
};
