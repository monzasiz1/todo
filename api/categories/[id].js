const { getPool } = require('../_lib/db');
const { verifyToken, cors } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const { id } = req.query;

  try {
    const pool = getPool();
    const result = await pool.query(
      'DELETE FROM categories WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Kategorie nicht gefunden' });
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete category error:', err);
    res.status(500).json({ error: 'Kategorie konnte nicht gelöscht werden' });
  }
};
