const bcrypt = require('bcryptjs');
const { getPool } = require('../_lib/db');
const { generateToken, cors } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
    res.status(201).json({ user, token });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registrierung fehlgeschlagen' });
  }
};
