import { Router } from 'express';
import pool from '../config/db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// Get all categories for user
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM categories WHERE user_id = $1 ORDER BY name ASC',
      [req.user.id]
    );
    res.json({ categories: result.rows });
  } catch (err) {
    console.error('Get categories error:', err);
    res.status(500).json({ error: 'Kategorien konnten nicht geladen werden' });
  }
});

// Create category
router.post('/', async (req, res) => {
  try {
    const { name, color, icon } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name ist erforderlich' });
    }

    const result = await pool.query(
      'INSERT INTO categories (user_id, name, color, icon) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, name, color || '#007AFF', icon || 'folder']
    );
    res.status(201).json({ category: result.rows[0] });
  } catch (err) {
    console.error('Create category error:', err);
    res.status(500).json({ error: 'Kategorie konnte nicht erstellt werden' });
  }
});

// Delete category
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM categories WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Kategorie nicht gefunden' });
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete category error:', err);
    res.status(500).json({ error: 'Kategorie konnte nicht gelöscht werden' });
  }
});

export default router;
