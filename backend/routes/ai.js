import { Router } from 'express';
import pool from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { parseTaskWithAI } from '../services/mistral.js';

const router = Router();
router.use(authenticate);

// Parse natural language input
router.post('/parse', async (req, res) => {
  try {
    const { input } = req.body;

    if (!input || typeof input !== 'string' || input.trim().length === 0) {
      return res.status(400).json({ error: 'Eingabe ist erforderlich' });
    }

    if (input.length > 500) {
      return res.status(400).json({ error: 'Eingabe zu lang (max 500 Zeichen)' });
    }

    const parsed = await parseTaskWithAI(input.trim());

    // If category was detected, try to find matching category ID
    if (parsed.category) {
      const catResult = await pool.query(
        'SELECT id FROM categories WHERE user_id = $1 AND LOWER(name) = LOWER($2)',
        [req.user.id, parsed.category]
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
});

// Parse and immediately create task
router.post('/parse-and-create', async (req, res) => {
  try {
    const { input } = req.body;

    if (!input || typeof input !== 'string' || input.trim().length === 0) {
      return res.status(400).json({ error: 'Eingabe ist erforderlich' });
    }

    if (input.length > 500) {
      return res.status(400).json({ error: 'Eingabe zu lang (max 500 Zeichen)' });
    }

    const parsed = await parseTaskWithAI(input.trim());

    // Find category ID
    let categoryId = null;
    if (parsed.category) {
      const catResult = await pool.query(
        'SELECT id FROM categories WHERE user_id = $1 AND LOWER(name) = LOWER($2)',
        [req.user.id, parsed.category]
      );
      if (catResult.rows.length > 0) {
        categoryId = catResult.rows[0].id;
      }
    }

    // Calculate reminder time (30 min before if time is set)
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
      [req.user.id, parsed.title, parsed.date, parsed.time, categoryId, parsed.priority, reminderAt]
    );

    const task = await pool.query(
      `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
       FROM tasks t LEFT JOIN categories c ON t.category_id = c.id WHERE t.id = $1`,
      [result.rows[0].id]
    );

    res.status(201).json({
      task: task.rows[0],
      parsed,
    });
  } catch (err) {
    console.error('AI parse-and-create error:', err);
    res.status(500).json({ error: 'KI-Aufgabe konnte nicht erstellt werden: ' + err.message });
  }
});

export default router;
