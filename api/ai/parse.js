const { getPool } = require('../_lib/db');
const { verifyToken, cors } = require('../_lib/auth');
const { parseTaskWithAI } = require('../_lib/mistral');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  try {
    const { input } = req.body;
    if (!input || typeof input !== 'string' || input.trim().length === 0) {
      return res.status(400).json({ error: 'Eingabe ist erforderlich' });
    }
    if (input.length > 500) {
      return res.status(400).json({ error: 'Eingabe zu lang (max 500 Zeichen)' });
    }

    const parsed = await parseTaskWithAI(input.trim());

    if (parsed.category) {
      const pool = getPool();
      const catResult = await pool.query(
        'SELECT id FROM categories WHERE user_id = $1 AND LOWER(name) = LOWER($2)',
        [user.id, parsed.category]
      );
      if (catResult.rows.length > 0) {
        parsed.category_id = catResult.rows[0].id;
      }
    }

    res.json({ parsed });
  } catch (err) {
    console.error('AI parse error:', err);
    res.status(500).json({ error: 'KI-Analyse fehlgeschlagen: ' + err.message });
  }
};
