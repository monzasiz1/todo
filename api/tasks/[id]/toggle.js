const { getPool } = require('../../_lib/db');
const { verifyToken, cors } = require('../../_lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const { id } = req.query;

  try {
    const pool = getPool();
    const result = await pool.query(
      `UPDATE tasks SET completed = NOT completed, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
    }

    const task = await pool.query(
      `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
       FROM tasks t LEFT JOIN categories c ON t.category_id = c.id WHERE t.id = $1`,
      [result.rows[0].id]
    );

    res.json({ task: task.rows[0] });
  } catch (err) {
    console.error('Toggle task error:', err);
    res.status(500).json({ error: 'Status konnte nicht geändert werden' });
  }
};
