import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { generateToken } from '../middleware/auth.js';
import { sendMail } from '../services/mailer.js';
import { otpMail } from '../services/mailTemplates.js';

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
    const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
    const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    let result;
    try {
      result = await pool.query(
        `INSERT INTO users (name, email, password, email_verification_code, email_verification_code_expires_at, email_verified)
         VALUES ($1, $2, $3, $4, $5, FALSE)
         RETURNING id, name, email, created_at`,
        [name, email, hashedPassword, verificationCode, codeExpiresAt]
      );
    } catch (colErr) {
      if (colErr.message && colErr.message.includes('column')) {
        result = await pool.query(
          `INSERT INTO users (name, email, password, email_verification_token, email_verified)
           VALUES ($1, $2, $3, $4, FALSE)
           RETURNING id, name, email, created_at`,
          [name, email, hashedPassword, verificationCode]
        );
      } else {
        throw colErr;
      }
    }
    const user = result.rows[0];
    // Default-Kategorien
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
    // Code-Mail senden — Fehler dürfen die Registration nicht blockieren
    try {
      await sendMail({
        to: email,
        subject: 'Dein BeeQu Verifizierungscode',
        html: otpMail({ name, otp: verificationCode }),
      });
    } catch (mailErr) {
      console.error('Verifikationsmail konnte nicht gesendet werden:', mailErr.message);
    }
    res.status(201).json({ user, message: 'Bitte gib den Code ein, den wir an deine E-Mail-Adresse gesendet haben.' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registrierung fehlgeschlagen' });
  }
});

// Verify code
router.post('/verify-code', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: 'E-Mail und Code sind erforderlich' });
    }

    let result;
    try {
      result = await pool.query(
        'SELECT * FROM users WHERE email = $1',
        [email]
      );
    } catch {
      return res.status(500).json({ error: 'Verifizierung fehlgeschlagen' });
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Konto nicht gefunden' });
    }

    const user = result.rows[0];
    if (user.email_verified) {
      return res.status(409).json({ error: 'Konto bereits verifiziert' });
    }

    const storedCode = user.email_verification_code || user.email_verification_token;
    const expiresAt = user.email_verification_code_expires_at || null;

    if (!storedCode || String(storedCode).trim() !== String(code).trim()) {
      return res.status(400).json({ error: 'Ungültiger Code. Bitte prüfe deine E-Mail.' });
    }

    if (expiresAt && new Date(expiresAt) < new Date()) {
      return res.status(400).json({ error: 'Der Code ist abgelaufen. Bitte registriere dich erneut.' });
    }

    try {
      await pool.query(
        `UPDATE users
         SET email_verified = TRUE,
             email_verification_code = NULL,
             email_verification_code_expires_at = NULL,
             email_verification_token = NULL
         WHERE id = $1`,
        [user.id]
      );
    } catch (colErr) {
      if (colErr.message && colErr.message.includes('column')) {
        await pool.query(
          `UPDATE users
           SET email_verified = TRUE,
               email_verification_token = NULL
           WHERE id = $1`,
          [user.id]
        );
      } else {
        throw colErr;
      }
    }

    const { password: _, twofa_secret: __, ...safeUser } = user;
    safeUser.email_verified = true;
    safeUser.email_verification_code = null;
    safeUser.email_verification_code_expires_at = null;
    safeUser.email_verification_token = null;

    const token = generateToken(safeUser);
    return res.json({ user: safeUser, token });
  } catch (err) {
    console.error('verify-code error:', err);
    return res.status(500).json({ error: 'Verifizierung fehlgeschlagen' });
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
    if (!user.email_verified) {
      return res.status(403).json({ error: 'Bitte bestätige zuerst deine E-Mail-Adresse mit dem 6-stelligen Code.' });
    }
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

// E-Mail-Aktivierung (Legacy)
router.get('/activate', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Kein Aktivierungs-Token angegeben.');
  try {
    const result = await pool.query(
      'UPDATE users SET email_verified = TRUE, email_verification_token = NULL WHERE email_verification_token = $1 RETURNING id, name, email',
      [token]
    );
    if (result.rows.length === 0) {
      return res.status(400).send('Aktivierungslink ungültig oder bereits verwendet.');
    }
    // Schöne HTML-Bestätigung
    return res.send(`
      <html><head><title>BeeQu aktiviert</title></head>
      <body style="font-family:Inter,Arial,sans-serif;background:linear-gradient(135deg,#8ED0FF 0%,#0A84FF 100%);margin:0;padding:0;">
        <div style="max-width:420px;margin:60px auto;background:#fff;border-radius:18px;box-shadow:0 4px 32px #0a84ff22;padding:32px 28px 24px 28px;">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
            <img src='https://beequ.de/logo-mail.png' alt='BeeQu' style='height:38px;width:38px;border-radius:10px;box-shadow:0 2px 8px #0a84ff33;'>
            <span style='font-size:1.5rem;font-weight:800;color:#0A84FF;'>BeeQu</span>
          </div>
          <h2 style='font-size:1.2rem;font-weight:700;margin:0 0 18px 0;color:#0A84FF;'>Dein Account ist jetzt aktiviert!</h2>
          <div style='font-size:1.05rem;line-height:1.7;color:#222;'>Du kannst dich jetzt in der App anmelden.<br><br><a href='https://beequ.de/login' style='display:inline-block;padding:12px 28px;background:#0A84FF;color:#fff;font-weight:700;border-radius:8px;text-decoration:none;font-size:1.1rem;'>Zum Login</a></div>
        </div>
      </body></html>
    `);
  } catch (err) {
    console.error('Activation error:', err);
    return res.status(500).send('Aktivierung fehlgeschlagen.');
  }
});

export default router;
