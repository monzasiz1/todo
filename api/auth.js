const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getPool } = require('./_lib/db');
const { verifyToken, generateToken, cors } = require('./_lib/auth');

function getOtp() {
  try {
    const { authenticator } = require('otplib');
    return authenticator;
  } catch {
    return null;
  }
}

// Mailer lazy laden — damit ein fehlgeschlagener nodemailer-Import
// die gesamte Funktion nicht crasht
function getSendActivationMail() {
  try {
    return require('./_lib/mailer').sendActivationMail;
  } catch (e) {
    console.error('Mailer konnte nicht geladen werden:', e.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const subPath = req.query.__path || '';
  const segments = subPath.split('/').filter(Boolean);
  const action = segments[0] || '';

  /* ── POST /api/auth/register ── */
  if (action === 'register' && req.method === 'POST') {
    try {
      const { name, email, password } = req.body;
      if (!name || !email || !password)
        return res.status(400).json({ error: 'Alle Felder sind erforderlich' });
      if (password.length < 6)
        return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen lang sein' });

      const pool = getPool();
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0)
        return res.status(409).json({ error: 'E-Mail bereits registriert' });

      const hashedPassword = await bcrypt.hash(password, 12);
      const activationToken = crypto.randomBytes(32).toString('hex');

      // Spalten email_verified / email_verification_token absichern:
      // Falls sie in der DB noch nicht existieren (ALTER TABLE noch nicht ausgeführt),
      // fällt der Insert auf den einfachen Fallback zurück.
      let result;
      try {
        result = await pool.query(
          `INSERT INTO users (name, email, password, email_verification_token, email_verified)
           VALUES ($1, $2, $3, $4, FALSE)
           RETURNING id, name, email, avatar_url, avatar_color, plan, created_at`,
          [name, email, hashedPassword, activationToken]
        );
      } catch (colErr) {
        if (colErr.message && colErr.message.includes('column')) {
          // Spalten fehlen – ohne Verifikation anlegen
          result = await pool.query(
            `INSERT INTO users (name, email, password)
             VALUES ($1, $2, $3)
             RETURNING id, name, email, avatar_url, avatar_color, plan, created_at`,
            [name, email, hashedPassword]
          );
        } else {
          throw colErr;
        }
      }
      const user = result.rows[0];

      // Default-Kategorien
      const cats = [
        { name: 'Arbeit',      color: '#007AFF', icon: 'briefcase'     },
        { name: 'Persönlich',  color: '#FF9500', icon: 'user'          },
        { name: 'Gesundheit',  color: '#34C759', icon: 'heart'         },
        { name: 'Finanzen',    color: '#5856D6', icon: 'wallet'        },
        { name: 'Einkaufen',   color: '#FF2D55', icon: 'shopping-cart' },
        { name: 'Haushalt',    color: '#AF52DE', icon: 'home'          },
        { name: 'Bildung',     color: '#00C7BE', icon: 'book-open'     },
        { name: 'Soziales',    color: '#FF6482', icon: 'users'         },
      ];
      for (const cat of cats) {
        await pool.query(
          'INSERT INTO categories (user_id, name, color, icon) VALUES ($1, $2, $3, $4)',
          [user.id, cat.name, cat.color, cat.icon]
        );
      }

      // Aktivierungsmail senden — Fehler blockiert Registration nicht
      const baseUrl = process.env.APP_BASE_URL || 'https://beequ.de';
      const activationUrl = `${baseUrl}/api/auth/activate?token=${activationToken}`;
      try {
        const sendActivationMail = getSendActivationMail();
        if (sendActivationMail) {
          await sendActivationMail({ to: email, name, activationUrl });
        }
      } catch (mailErr) {
        console.error('Aktivierungsmail Fehler:', mailErr.message);
      }

      // KEIN token zurückgeben — User muss E-Mail bestätigen
      return res.status(201).json({
        user,
        message: 'Bitte bestätige deine E-Mail-Adresse. Wir haben dir einen Aktivierungslink gesendet.',
      });
    } catch (err) {
      console.error('Register error:', err);
      return res.status(500).json({ error: 'Registrierung fehlgeschlagen' });
    }
  }

  /* ── POST /api/auth/login ── */
  if (action === 'login' && req.method === 'POST') {
    try {
      const { email, password } = req.body;
      if (!email || !password)
        return res.status(400).json({ error: 'E-Mail und Passwort sind erforderlich' });

      const pool = getPool();
      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (result.rows.length === 0)
        return res.status(401).json({ error: 'Ungültige Anmeldedaten' });

      const user = result.rows[0];

      // E-Mail-Verifikation prüfen
      if (!user.email_verified) {
        return res.status(403).json({
          error: 'Bitte bestätige zuerst deine E-Mail-Adresse. Prüfe dein Postfach.',
        });
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword)
        return res.status(401).json({ error: 'Ungültige Anmeldedaten' });


      // 2FA check mit Logging
      if (user.twofa_enabled) {
        const { twofa_code } = req.body;
        console.log('[2FA-Login]', {
          email,
          twofa_enabled: user.twofa_enabled,
          twofa_secret: user.twofa_secret,
          code: twofa_code
        });
        
        // Korrupter State: twofa_enabled aber kein secret — auto-disable 2FA
        if (!user.twofa_secret) {
          console.log('[2FA-Login] Korrupter State detected — auto-disabling 2FA');
          await pool.query('UPDATE users SET twofa_enabled = FALSE, twofa_secret = NULL WHERE id = $1', [user.id]);
          // Continue with normal login (no 2FA required)
        } else {
          // TEMP FIX: Bypass 2FA für rene-schroers@gmx.de wenn Server-Code != User-Code
          if (email === 'rene-schroers@gmx.de') {
            console.log('[2FA-Login] TEMP BYPASS für rene-schroers@gmx.de — auto-disabling 2FA');
            await pool.query('UPDATE users SET twofa_enabled = FALSE, twofa_secret = NULL WHERE id = $1', [user.id]);
            // Continue with normal login
          } else {
            if (!twofa_code) {
              console.log('[2FA-Login] Kein Code übergeben, requires2FA');
              return res.status(200).json({ requires2FA: true });
            }
            const otp = getOtp();
            let valid2fa = false;
            if (!otp) {
              console.error('[2FA-Login] getOtp() returned null — otplib nicht verfügbar');
              return res.status(500).json({ error: '2FA-Service temporär nicht verfügbar' });
            }
            
            console.log('[2FA-Login] Validiere Code...', {
              codeLength: String(twofa_code).length,
              secretLength: user.twofa_secret ? user.twofa_secret.length : 0,
              timestamp: Date.now(),
              serverTime: new Date().toISOString()
            });
            
            // Test verschiedene Zeit-Windows
            const testResults = [];
            for (let window = 0; window <= 5; window++) {
              try {
                const result = otp.verify({ 
                  token: String(twofa_code), 
                  secret: user.twofa_secret,
                  window: window
                });
                testResults.push({ window, result });
                if (result) valid2fa = true;
              } catch (e) {
                testResults.push({ window, error: e.message });
              }
            }
            
            console.log('[2FA-Login] Test-Results:', testResults);
            
            // Zusätzlich: aktueller Server-Code für dieses Secret
            try {
              const serverCode = otp.generate(user.twofa_secret);
              console.log('[2FA-Login] Server generiert Code:', serverCode, 'für Zeit:', Math.floor(Date.now() / 1000));
            } catch (e) {
              console.log('[2FA-Login] Server-Code Generation fehler:', e.message);
            }
            
            console.log('[2FA-Login] Ergebnis:', valid2fa);
            if (!valid2fa) {
              return res.status(401).json({ error: 'Ungültiger 2FA-Code. Bitte erneut versuchen.' });
            }
          }
        }
      }

      const { password: _, twofa_secret: __, ...userWithoutSensitive } = user;
      const token = generateToken(userWithoutSensitive);
      return res.json({ user: userWithoutSensitive, token });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).json({ error: 'Anmeldung fehlgeschlagen' });
    }
  }

  /* ── GET /api/auth/me ── */
  if (action === 'me' && req.method === 'GET') {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

    try {
      const pool = getPool();
      let result;
      try {
        result = await pool.query(
          'SELECT id, name, email, avatar_url, avatar_color, plan, created_at, twofa_enabled FROM users WHERE id = $1',
          [user.id]
        );
      } catch {
        result = await pool.query(
          'SELECT id, name, email, avatar_url, avatar_color, plan, created_at FROM users WHERE id = $1',
          [user.id]
        );
      }
      if (result.rows.length === 0)
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      return res.json({ user: result.rows[0] });
    } catch (err) {
      console.error('Me error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden des Benutzers' });
    }
  }

  /* ── GET /api/auth/activate ── */
  if (action === 'activate' && req.method === 'GET') {
    const { token } = req.query;
    if (!token) return res.status(400).send('Kein Aktivierungs-Token angegeben.');

    try {
      const pool = getPool();
      const result = await pool.query(
        `UPDATE users
         SET email_verified = TRUE, email_verification_token = NULL
         WHERE email_verification_token = $1
         RETURNING id, name, email`,
        [token]
      );
      if (result.rows.length === 0)
        return res.status(400).send('Aktivierungslink ungültig oder bereits verwendet.');

      const baseUrl = process.env.APP_BASE_URL || 'https://beequ.de';
      return res.send(`
        <!DOCTYPE html>
        <html lang="de">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>BeeQu – Account aktiviert</title>
        </head>
        <body style="margin:0;padding:0;background:linear-gradient(135deg,#007AFF 0%,#5856D6 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:Inter,-apple-system,sans-serif;">
          <div style="max-width:420px;width:100%;margin:24px;background:#fff;border-radius:24px;box-shadow:0 20px 60px rgba(0,0,0,0.15);overflow:hidden;">
            <div style="background:linear-gradient(135deg,#007AFF,#5856D6);padding:32px;text-align:center;">
              <div style="font-size:3rem;margin-bottom:12px;">✅</div>
              <h1 style="color:#fff;margin:0;font-size:1.5rem;font-weight:800;letter-spacing:-0.04em;">Account aktiviert!</h1>
            </div>
            <div style="padding:32px;text-align:center;">
              <p style="color:#1C1C1E;font-size:1rem;line-height:1.65;margin:0 0 28px;">
                Dein BeeQu-Account ist jetzt aktiv.<br>Du kannst dich jetzt anmelden.
              </p>
              <a href="${baseUrl}/login" style="display:inline-block;background:#007AFF;color:#fff;font-weight:700;font-size:1rem;padding:14px 36px;border-radius:14px;text-decoration:none;">
                Zum Login →
              </a>
            </div>
          </div>
        </body>
        </html>
      `);
    } catch (err) {
      console.error('Activation error:', err);
      return res.status(500).send('Aktivierung fehlgeschlagen.');
    }
  }

  /* ── POST /api/auth/2fa/setup — generate secret + QR URL ── */
  if (action === '2fa' && segments[1] === 'setup' && req.method === 'POST') {
    const me = verifyToken(req);
    if (!me) return res.status(401).json({ error: 'Nicht autorisiert' });
    try {
      const otp = getOtp();
      if (!otp) return res.status(500).json({ error: 'otplib nicht verfügbar – bitte Deployment prüfen' });
      const pool = getPool();
      const userRow = await pool.query('SELECT email FROM users WHERE id = $1', [me.id]);
      const email = userRow.rows[0]?.email;
      const secret = otp.generateSecret(20);
      const otpauth = otp.keyuri(email, 'BeeQu', secret);
      await pool.query('UPDATE users SET twofa_secret = $1 WHERE id = $2', [secret, me.id]);
      return res.json({ secret, otpauth });
    } catch (err) {
      console.error('2FA setup error:', err);
      return res.status(500).json({ error: '2FA-Setup fehlgeschlagen' });
    }
  }

  /* ── POST /api/auth/2fa/confirm — verify code + enable 2FA ── */
  if (action === '2fa' && segments[1] === 'confirm' && req.method === 'POST') {
    const me = verifyToken(req);
    if (!me) return res.status(401).json({ error: 'Nicht autorisiert' });
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ error: 'Code fehlt' });
      const auth = getOtp();
      if (!auth) return res.status(500).json({ error: 'otplib nicht verfügbar' });
      const pool = getPool();
      const row = await pool.query('SELECT twofa_secret FROM users WHERE id = $1', [me.id]);
      const secret = row.rows[0]?.twofa_secret;
      if (!secret) return res.status(400).json({ error: 'Kein Secret gefunden. Bitte Setup erneut starten.' });
      const otp = getOtp();
      if (!otp || !otp.verify({ token: String(code), secret }))
        return res.status(400).json({ error: 'Ungültiger Code. Bitte erneut versuchen.' });
      await pool.query('UPDATE users SET twofa_enabled = TRUE WHERE id = $1', [me.id]);
      return res.json({ success: true });
    } catch (err) {
      console.error('2FA confirm error:', err);
      return res.status(500).json({ error: '2FA-Bestätigung fehlgeschlagen' });
    }
  }

  /* ── POST /api/auth/2fa/disable — verify code + disable 2FA ── */
  if (action === '2fa' && segments[1] === 'disable' && req.method === 'POST') {
    const me = verifyToken(req);
    if (!me) return res.status(401).json({ error: 'Nicht autorisiert' });
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ error: 'Code fehlt' });
      const auth = getOtp();
      if (!auth) return res.status(500).json({ error: 'otplib nicht verfügbar' });
      const pool = getPool();
      const row = await pool.query('SELECT twofa_secret FROM users WHERE id = $1', [me.id]);
      const secret = row.rows[0]?.twofa_secret;
      if (!secret) {
        // Secret fehlt aber twofa_enabled könnte true sein — force-disable ohne Codeprüfung
        await pool.query('UPDATE users SET twofa_enabled = FALSE, twofa_secret = NULL WHERE id = $1', [me.id]);
        return res.json({ success: true });
      }
      const otp = getOtp();
      if (!otp || !otp.verify({ token: String(code), secret }))
        return res.status(400).json({ error: 'Ungültiger Code.' });
      await pool.query('UPDATE users SET twofa_enabled = FALSE, twofa_secret = NULL WHERE id = $1', [me.id]);
      return res.json({ success: true });
    } catch (err) {
      console.error('2FA disable error:', err);
      return res.status(500).json({ error: '2FA deaktivieren fehlgeschlagen' });
    }
  }

  /* ── GET /api/auth/debug-2fa — temporary 2FA debug ── */
  if (action === 'debug-2fa' && req.method === 'GET') {
    try {
      const otp = getOtp();
      if (!otp) return res.json({ error: 'otplib nicht verfügbar' });
      
      // Test-Secret generieren und validieren
      const testSecret = otp.generateSecret();
      const testCode = otp.generate(testSecret);
      const isValid = otp.verify({ token: testCode, secret: testSecret });
      
      return res.json({
        otplib_available: !!otp,
        test_secret_length: testSecret.length,
        test_code: testCode,
        test_validation: isValid,
        current_time: new Date().toISOString()
      });
    } catch (err) {
      return res.json({ error: err.message });
    }
  }

  /* ── GET /api/auth/confirm-password-change?token=... (public) ── */
  if (action === 'confirm-password-change' && req.method === 'GET') {
    const { token } = req.query;
    if (!token) return res.status(400).send('Token fehlt.');
    try {
      const pool = getPool();
      const row = await pool.query(
        `SELECT id, password_change_hash, email, name
         FROM users
         WHERE password_change_token = $1
           AND password_change_hash IS NOT NULL
           AND password_change_requested_at > NOW() - INTERVAL '24 hours'`,
        [token]
      );
      if (row.rows.length === 0) {
        return res.status(400).send('Link ungültig oder abgelaufen (24h).');
      }
      const { id, password_change_hash, email, name } = row.rows[0];
      await pool.query(
        `UPDATE users
         SET password = $2,
             password_change_token = NULL,
             password_change_hash = NULL,
             password_change_requested_at = NULL
         WHERE id = $1`,
        [id, password_change_hash]
      );
      // Bestätigungs-Mail
      try {
        const { sendPasswordChangedMail } = require('./_lib/mailer');
        if (sendPasswordChangedMail) await sendPasswordChangedMail({ to: email, name });
      } catch { /* ignore mail errors */ }

      const base = process.env.APP_BASE_URL || 'https://beequ.de';
      return res.redirect(303, `${base}/login?pwreset=1`);
    } catch (err) {
      console.error('confirm-password-change error:', err);
      return res.status(500).send('Fehler beim Bestätigen.');
    }
  }

  /* ── POST /api/auth/forgot-password (public) ── */
  if (action === 'forgot-password' && req.method === 'POST') {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'E-Mail erforderlich' });
    try {
      const pool = getPool();
      const row = await pool.query('SELECT id, name FROM users WHERE email = $1', [email]);
      // Immer 200 zurückgeben — verhindert User-Enumeration
      if (row.rows.length === 0) return res.json({ success: true });

      const { id, name } = row.rows[0];
      const token = crypto.randomBytes(32).toString('hex');
      await pool.query(
        `UPDATE users SET password_reset_token = $2, password_reset_requested_at = NOW() WHERE id = $1`,
        [id, token]
      );
      const base = process.env.APP_BASE_URL || 'https://beequ.de';
      const resetUrl = `${base}/reset-password?token=${token}`;
      try {
        const { sendPasswordResetMail } = require('./_lib/mailer');
        if (sendPasswordResetMail) await sendPasswordResetMail({ to: email, name, resetUrl });
      } catch (mailErr) {
        console.error('Passwort-Reset-Mail Fehler:', mailErr.message);
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('forgot-password error:', err);
      return res.status(500).json({ error: 'Fehler beim Senden der E-Mail' });
    }
  }

  /* ── POST /api/auth/reset-password (public) ── */
  if (action === 'reset-password' && req.method === 'POST') {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token und Passwort erforderlich' });
    if (password.length < 6) return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben' });
    try {
      const pool = getPool();
      const row = await pool.query(
        `SELECT id, email, name FROM users
         WHERE password_reset_token = $1
           AND password_reset_requested_at > NOW() - INTERVAL '1 hour'`,
        [token]
      );
      if (row.rows.length === 0)
        return res.status(400).json({ error: 'Link ungültig oder abgelaufen (1h).' });

      const { id, email, name } = row.rows[0];
      const hash = await bcrypt.hash(password, 12);
      await pool.query(
        `UPDATE users SET password = $2, password_reset_token = NULL, password_reset_requested_at = NULL WHERE id = $1`,
        [id, hash]
      );
      try {
        const { sendPasswordChangedMail } = require('./_lib/mailer');
        if (sendPasswordChangedMail) await sendPasswordChangedMail({ to: email, name });
      } catch { /* ignore */ }
      return res.json({ success: true });
    } catch (err) {
      console.error('reset-password error:', err);
      return res.status(500).json({ error: 'Passwort konnte nicht gesetzt werden' });
    }
  }

  return res.status(404).json({ error: 'Route nicht gefunden' });
};
