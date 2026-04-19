const { getPool } = require('../_lib/db');
const { verifyToken, cors } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const pool = getPool();
  const pathSegments = req.query.path || [];

  // GET /api/categories
  if (pathSegments.length === 0 && req.method === 'GET') {
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
  if (pathSegments.length === 0 && req.method === 'POST') {
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

  // DELETE /api/categories/:id
  if (pathSegments.length === 1 && req.method === 'DELETE') {
    const id = pathSegments[0];
    try {
      const result = await pool.query(
        'DELETE FROM categories WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, user.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Kategorie nicht gefunden' });
      return res.json({ deleted: true });
    } catch (err) {
      console.error('Delete category error:', err);
      return res.status(500).json({ error: 'Kategorie konnte nicht gelöscht werden' });
    }
  }

  return res.status(404).json({ error: 'Route nicht gefunden' });
};
