const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');
const { parseTaskWithAI } = require('./_lib/mistral');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Methode nicht erlaubt' });
  }

  const subPath = req.query.__path || '';
  const segments = subPath.split('/').filter(Boolean);
  const action = segments[0] || '';
  const pool = getPool();

  // POST /api/ai/parse
  if (action === 'parse') {
    try {
      const { input } = req.body;
      if (!input) {
        return res.status(400).json({ error: 'Eingabe ist erforderlich' });
      }

      const parsed = await parseTaskWithAI(input);
      return res.json({ parsed });
    } catch (err) {
      console.error('AI parse error:', err);
      return res.status(500).json({ error: 'KI-Analyse fehlgeschlagen' });
    }
  }

  // POST /api/ai/parse-and-create
  if (action === 'parse-and-create') {
    try {
      const { input } = req.body;
      if (!input) {
        return res.status(400).json({ error: 'Eingabe ist erforderlich' });
      }

      const categories = await pool.query(
        'SELECT id, name FROM categories WHERE user_id = $1',
        [user.id]
      );

      const parsed = await parseTaskWithAI(input);
      if (!parsed || !parsed.title) {
        return res.status(400).json({ error: 'Aufgabe konnte nicht erkannt werden' });
      }

      // Map AI category name to category_id
      let categoryId = null;
      if (parsed.category) {
        const match = categories.rows.find(
          (c) => c.name.toLowerCase() === parsed.category.toLowerCase()
        );
        if (match) categoryId = match.id;
      }

      const maxOrder = await pool.query(
        'SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM tasks WHERE user_id = $1',
        [user.id]
      );

      // Single task (with optional date_end for multi-day events)
      const result = await pool.query(
        `INSERT INTO tasks (user_id, title, description, date, date_end, time, time_end, priority, category_id, reminder_at, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [user.id, parsed.title, parsed.description || null, parsed.date || null,
         parsed.date_end || null, parsed.time || null, parsed.time_end || null,
         parsed.priority || 'medium', categoryId,
         null, maxOrder.rows[0].next_order]
      );

      return res.status(201).json({ task: result.rows[0], parsed });
    } catch (err) {
      console.error('AI parse-and-create error:', err);
      return res.status(500).json({ error: 'KI-Erstellung fehlgeschlagen' });
    }
  }

  return res.status(404).json({ error: 'Route nicht gefunden' });
};
