const { getPool } = require('../_lib/db');
const { verifyToken, cors } = require('../_lib/auth');
const { parseTaskWithAI } = require('../_lib/mistral');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const pathSegments = req.query.path || [];
  const action = pathSegments[0];

  const { input } = req.body;
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return res.status(400).json({ error: 'Eingabe ist erforderlich' });
  }
  if (input.length > 500) {
    return res.status(400).json({ error: 'Eingabe zu lang (max 500 Zeichen)' });
  }

  const pool = getPool();

  // POST /api/ai/parse
  if (action === 'parse') {
    try {
      const parsed = await parseTaskWithAI(input.trim());

      if (parsed.category) {
        const catResult = await pool.query(
          'SELECT id FROM categories WHERE user_id = $1 AND LOWER(name) = LOWER($2)',
          [user.id, parsed.category]
        );
        if (catResult.rows.length > 0) {
          parsed.category_id = catResult.rows[0].id;
        }
      }

      return res.json({ parsed });
    } catch (err) {
      console.error('AI parse error:', err);
      return res.status(500).json({ error: 'KI-Analyse fehlgeschlagen: ' + err.message });
    }
  }

  // POST /api/ai/parse-and-create
  if (action === 'parse-and-create') {
    try {
      const parsed = await parseTaskWithAI(input.trim());

      let categoryId = null;
      if (parsed.category) {
        const catResult = await pool.query(
          'SELECT id FROM categories WHERE user_id = $1 AND LOWER(name) = LOWER($2)',
          [user.id, parsed.category]
        );
        if (catResult.rows.length > 0) {
          categoryId = catResult.rows[0].id;
        }
      }

      let reminderAt = null;
      if (parsed.hasReminder && parsed.date && parsed.time) {
        const reminderDate = new Date(`${parsed.date}T${parsed.time}:00`);
        reminderDate.setMinutes(reminderDate.getMinutes() - 30);
        reminderAt = reminderDate.toISOString();
      } else if (parsed.hasReminder && parsed.date) {
        reminderAt = new Date(`${parsed.date}T09:00:00`).toISOString();
      }

      const result = await pool.query(
        `INSERT INTO tasks (user_id, title, date, time, category_id, priority, reminder_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [user.id, parsed.title, parsed.date, parsed.time, categoryId, parsed.priority, reminderAt]
      );

      const task = await pool.query(
        `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
         FROM tasks t LEFT JOIN categories c ON t.category_id = c.id WHERE t.id = $1`,
        [result.rows[0].id]
      );

      return res.status(201).json({ task: task.rows[0], parsed });
    } catch (err) {
      console.error('AI parse-and-create error:', err);
      return res.status(500).json({ error: 'KI-Aufgabe konnte nicht erstellt werden: ' + err.message });
    }
  }

  return res.status(404).json({ error: 'Route nicht gefunden' });
};
