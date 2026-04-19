const { getPool } = require('../../_lib/db');
const { verifyToken, cors } = require('../../_lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  try {
    const pool = getPool();
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

    res.json({ reminders: result.rows });
  } catch (err) {
    console.error('Reminders error:', err);
    res.status(500).json({ error: 'Erinnerungen konnten nicht geladen werden' });
  }
};
