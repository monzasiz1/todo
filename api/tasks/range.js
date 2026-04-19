const { getPool } = require('../_lib/db');
const { verifyToken, cors } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const pool = getPool();
  const { start, end } = req.query;

  if (!start || !end) {
    return res.status(400).json({ error: 'Start- und Enddatum erforderlich' });
  }

  try {
    const result = await pool.query(
      `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
       FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.user_id = $1 AND t.date >= $2 AND t.date <= $3
       ORDER BY t.date ASC, t.time ASC NULLS LAST`,
      [user.id, start, end]
    );
    res.json({ tasks: result.rows });
  } catch (err) {
    console.error('Tasks range error:', err);
    res.status(500).json({ error: 'Aufgaben konnten nicht geladen werden' });
  }
};
