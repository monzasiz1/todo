const { getPool } = require('../_lib/db');
const { verifyToken, cors } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const pool = getPool();

  // GET /api/categories
  if (req.method === 'GET') {
    try {
      const result = await pool.query(
        'SELECT * FROM categories WHERE user_id = $1 ORDER BY name ASC',
        [user.id]
      );
      return res.json({ categories: result.rows });
    } catch (err) {
      console.error('Get categories error:', err);
      return res.status(500).json({ error: 'Kategorien konnten nicht geladen werden' });
    }
  }

  // POST /api/categories
  if (req.method === 'POST') {
    try {
      const { name, color, icon } = req.body;
      if (!name) return res.status(400).json({ error: 'Name ist erforderlich' });

      const result = await pool.query(
        'INSERT INTO categories (user_id, name, color, icon) VALUES ($1, $2, $3, $4) RETURNING *',
        [user.id, name, color || '#007AFF', icon || 'folder']
      );
      return res.status(201).json({ category: result.rows[0] });
    } catch (err) {
      console.error('Create category error:', err);
      return res.status(500).json({ error: 'Kategorie konnte nicht erstellt werden' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
