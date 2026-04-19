const bcrypt = require('bcryptjs');
const { getPool } = require('../_lib/db');
const { verifyToken, generateToken, cors } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const pathSegments = req.query.path || [];
  const action = pathSegments[0];

  // POST /api/auth/login
  if (action === 'login' && req.method === 'POST') {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'E-Mail und Passwort sind erforderlich' });
      }

      const pool = getPool();
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
      return res.json({ user: userWithoutPassword, token });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).json({ error: 'Anmeldung fehlgeschlagen' });
    }
  }

  // POST /api/auth/register
  if (action === 'register' && req.method === 'POST') {
    try {
      const { name, email, password } = req.body;
      if (!name || !email || !password) {
        return res.status(400).json({ error: 'Alle Felder sind erforderlich' });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen lang sein' });
      }

      const pool = getPool();
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
      return res.status(201).json({ user, token });
    } catch (err) {
      console.error('Register error:', err);
      return res.status(500).json({ error: 'Registrierung fehlgeschlagen' });
    }
  }

  // GET /api/auth/me
  if (action === 'me' && req.method === 'GET') {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

    try {
      const pool = getPool();
      const result = await pool.query(
        'SELECT id, name, email, created_at FROM users WHERE id = $1',
        [user.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }
      return res.json({ user: result.rows[0] });
    } catch (err) {
      console.error('Me error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden des Benutzers' });
    }
  }

  return res.status(404).json({ error: 'Route nicht gefunden' });
};
