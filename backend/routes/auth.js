import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { generateToken } from '../middleware/auth.js';

const router = Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Alle Felder sind erforderlich' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen lang sein' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'E-Mail bereits registriert' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, created_at',
      [name, email, hashedPassword]
    );

    const user = result.rows[0];

    // Create default categories for new user
    const defaultCategories = [
      { name: 'Arbeit', color: '#007AFF', icon: 'briefcase' },
      { name: 'Persönlich', color: '#FF9500', icon: 'user' },
      { name: 'Gesundheit', color: '#34C759', icon: 'heart' },
      { name: 'Finanzen', color: '#5856D6', icon: 'wallet' },
      { name: 'Einkaufen', color: '#FF2D55', icon: 'shopping-cart' },
      { name: 'Haushalt', color: '#AF52DE', icon: 'home' },
      { name: 'Bildung', color: '#00C7BE', icon: 'book-open' },
      { name: 'Soziales', color: '#FF6482', icon: 'users' },
    ];

    for (const cat of defaultCategories) {
      await pool.query(
        'INSERT INTO categories (user_id, name, color, icon) VALUES ($1, $2, $3, $4)',
        [user.id, cat.name, cat.color, cat.icon]
      );
    }

    const token = generateToken(user);
    res.status(201).json({ user, token });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registrierung fehlgeschlagen' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'E-Mail und Passwort sind erforderlich' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }

    const { password: _, ...userWithoutPassword } = user;
    const token = generateToken(userWithoutPassword);
    res.json({ user: userWithoutPassword, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Anmeldung fehlgeschlagen' });
  }
});

// Get current user
router.get('/me', async (req, res) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Nicht autorisiert' });
  }

  try {
    const jwt = await import('jsonwebtoken');
    const token = header.split(' ')[1];
    const decoded = jwt.default.verify(token, process.env.JWT_SECRET || 'fallback-dev-secret');
    const result = await pool.query(
      'SELECT id, name, email, created_at FROM users WHERE id = $1',
      [decoded.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    res.json({ user: result.rows[0] });
  } catch {
    return res.status(401).json({ error: 'Token ungültig' });
  }
});

export default router;
