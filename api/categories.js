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

  // GET /api/categories
  if (segments.length === 0 && req.method === 'GET') {
    try {
      const result = await pool.query(
        'SELECT * FROM categories WHERE user_id = $1 ORDER BY name ASC',
        [user.id]
      );
      return res.json(result.rows);
    } catch (err) {
      console.error('Categories list error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden der Kategorien' });
    }
  }

  // POST /api/categories
  if (segments.length === 0 && req.method === 'POST') {
    try {
      const { name, color, icon } = req.body;
      if (!name) {
        return res.status(400).json({ error: 'Name ist erforderlich' });
      }
      const result = await pool.query(
        'INSERT INTO categories (user_id, name, color, icon) VALUES ($1, $2, $3, $4) RETURNING *',
        [user.id, name, color || '#007AFF', icon || 'folder']
      );
      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('Create category error:', err);
      return res.status(500).json({ error: 'Fehler beim Erstellen der Kategorie' });
    }
  }

  // DELETE /api/categories/:id
  if (segments.length === 1 && req.method === 'DELETE') {
    try {
      const catId = segments[0];
      await pool.query(
        'UPDATE tasks SET category_id = NULL WHERE category_id = $1 AND user_id = $2',
        [catId, user.id]
      );
      const result = await pool.query(
        'DELETE FROM categories WHERE id = $1 AND user_id = $2 RETURNING id',
        [catId, user.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Kategorie nicht gefunden' });
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('Delete category error:', err);
      return res.status(500).json({ error: 'Fehler beim Löschen der Kategorie' });
    }
  }

  return res.status(404).json({ error: 'Route nicht gefunden' });
};
