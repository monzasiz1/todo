const bcrypt = require('bcryptjs');
const { getPool } = require('./_lib/db');
const { verifyToken, generateToken, cors } = require('./_lib/auth');
const { sendPasswordChangedMail } = require('./_lib/mailer');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const subPath = req.query.__path || '';
  const segments = subPath.split('/').filter(Boolean);
  const action = segments[0] || '';
  const pool = getPool();

  // GET /api/profile — Full profile with stats
  if (!action && req.method === 'GET') {
    try {
      let userResult;
      try {
        userResult = await pool.query(
          `SELECT id, name, email, avatar_url, avatar_color, bio, theme, created_at,
                  profile_visibility, twofa_enabled
           FROM users WHERE id = $1`,
          [user.id]
        );
      } catch {
        // Fallback ohne optionale Spalten
        userResult = await pool.query(
          `SELECT id, name, email, avatar_url, avatar_color, bio, theme, created_at
           FROM users WHERE id = $1`,
          [user.id]
        );
      }
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }

      // Task statistics
      const stats = await pool.query(
        `SELECT
           COUNT(*) as total_tasks,
           COUNT(*) FILTER (WHERE completed = true) as completed_tasks,
           COUNT(*) FILTER (WHERE completed = false) as open_tasks,
           COUNT(*) FILTER (WHERE priority = 'urgent') as urgent_tasks,
           COUNT(*) FILTER (WHERE priority = 'high') as high_tasks,
           COUNT(DISTINCT category_id) as categories_used,
           COUNT(DISTINCT date) as active_days,
           MIN(created_at) as first_task_at
         FROM tasks WHERE user_id = $1`,
        [user.id]
      );

      // Streak calculation: consecutive days with completed tasks (up to today)
      const streakResult = await pool.query(
        `WITH completed_dates AS (
           SELECT DISTINCT DATE(updated_at) as d
           FROM tasks
           WHERE user_id = $1 AND completed = true
           ORDER BY d DESC
         ),
         numbered AS (
           SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d DESC))::int * INTERVAL '1 day' as grp
           FROM completed_dates
         )
         SELECT COUNT(*) as streak
         FROM numbered
         WHERE grp = (SELECT grp FROM numbered LIMIT 1)`,
        [user.id]
      );

      // Tasks completed this week
      const weekResult = await pool.query(
        `SELECT COUNT(*) as week_completed
         FROM tasks
         WHERE user_id = $1 AND completed = true
         AND updated_at >= NOW() - INTERVAL '7 days'`,
        [user.id]
      );

      // Category breakdown
      const categoryStats = await pool.query(
        `SELECT c.name, c.color, COUNT(*) as count,
           COUNT(*) FILTER (WHERE t.completed = true) as done
         FROM tasks t JOIN categories c ON t.category_id = c.id
         WHERE t.user_id = $1
         GROUP BY c.name, c.color
         ORDER BY count DESC
         LIMIT 5`,
        [user.id]
      );

      const s = stats.rows[0];
      const completionRate = s.total_tasks > 0
        ? Math.round((s.completed_tasks / s.total_tasks) * 100)
        : 0;

      return res.json({
        user: userResult.rows[0],
        twofa_enabled: userResult.rows[0].twofa_enabled,
        stats: {
          total_tasks: parseInt(s.total_tasks),
          completed_tasks: parseInt(s.completed_tasks),
          open_tasks: parseInt(s.open_tasks),
          urgent_tasks: parseInt(s.urgent_tasks),
          high_tasks: parseInt(s.high_tasks),
          categories_used: parseInt(s.categories_used),
          active_days: parseInt(s.active_days),
          completion_rate: completionRate,
          streak: parseInt(streakResult.rows[0]?.streak || 0),
          week_completed: parseInt(weekResult.rows[0]?.week_completed || 0),
          first_task_at: s.first_task_at,
          category_breakdown: categoryStats.rows,
        },
      });
    } catch (err) {
      console.error('Profile get error:', err);
      return res.status(500).json({ error: 'Profil konnte nicht geladen werden' });
    }
  }

  // PUT /api/profile — Update name, bio, avatar_color, theme
  if (!action && req.method === 'PUT') {
    try {
      const { name, bio, avatar_color, theme } = req.body;

      if (name !== undefined && (!name || name.trim().length < 1)) {
        return res.status(400).json({ error: 'Name darf nicht leer sein' });
      }
      if (name !== undefined && name.length > 50) {
        return res.status(400).json({ error: 'Name darf maximal 50 Zeichen lang sein' });
      }
      if (bio !== undefined && bio.length > 200) {
        return res.status(400).json({ error: 'Bio darf maximal 200 Zeichen lang sein' });
      }
      if (avatar_color !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(avatar_color)) {
        return res.status(400).json({ error: 'Ungültige Farbe' });
      }
      if (theme !== undefined && !['light', 'dark', 'auto'].includes(theme)) {
        return res.status(400).json({ error: 'Ungültiges Theme' });
      }

      const result = await pool.query(
        `UPDATE users SET
           name = COALESCE($2, name),
           bio = COALESCE($3, bio),
           avatar_color = COALESCE($4, avatar_color),
           theme = COALESCE($5, theme)
         WHERE id = $1
         RETURNING id, name, email, avatar_url, avatar_color, bio, theme, created_at, twofa_enabled`,
        [user.id, name || null, bio !== undefined ? bio : null, avatar_color || null, theme || null]
      );

      const updatedUser = result.rows[0];
      const token = generateToken(updatedUser);
      return res.json({ user: updatedUser, twofa_enabled: updatedUser.twofa_enabled, token });
    } catch (err) {
      console.error('Profile update error:', err);
      return res.status(500).json({ error: 'Profil konnte nicht aktualisiert werden' });
    }
  }

  // PUT /api/profile/avatar — Upload avatar image (base64)
  if (action === 'avatar' && req.method === 'PUT') {
    try {
      const { avatar_url } = req.body;

      if (!avatar_url) {
        // Remove avatar
        await pool.query('UPDATE users SET avatar_url = NULL WHERE id = $1', [user.id]);
        return res.json({ avatar_url: null });
      }

      // Validate base64 data URI
      if (!avatar_url.startsWith('data:image/')) {
        return res.status(400).json({ error: 'Ungültiges Bildformat' });
      }

      // Max ~2MB base64
      if (avatar_url.length > 2800000) {
        return res.status(400).json({ error: 'Bild zu groß (max. 2MB)' });
      }

      await pool.query(
        'UPDATE users SET avatar_url = $2 WHERE id = $1',
        [user.id, avatar_url]
      );

      return res.json({ avatar_url });
    } catch (err) {
      console.error('Avatar upload error:', err);
      return res.status(500).json({ error: 'Avatar konnte nicht hochgeladen werden' });
    }
  }


  // PUT /api/profile/password — Request password change (send confirmation mail)
  if (action === 'password' && req.method === 'PUT') {
    try {
      const { current_password, new_password } = req.body;
      if (!current_password || !new_password) {
        return res.status(400).json({ error: 'Aktuelles und neues Passwort erforderlich' });
      }
      if (new_password.length < 6) {
        return res.status(400).json({ error: 'Neues Passwort muss mindestens 6 Zeichen haben' });
      }
      // Prüfe, ob E-Mail verifiziert ist
      const userResult = await pool.query('SELECT password, email_verified, email, name FROM users WHERE id = $1', [user.id]);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }
      if (!userResult.rows[0].email_verified) {
        return res.status(403).json({ error: 'Passwort-Änderung nur nach E-Mail-Bestätigung möglich.' });
      }
      const valid = await bcrypt.compare(current_password, userResult.rows[0].password);
      if (!valid) {
        return res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });
      }
      // Token und Hash generieren
      const crypto = require('crypto');
      const token = crypto.randomBytes(32).toString('hex');
      const hash = await bcrypt.hash(new_password, 12);
      await pool.query(
        'UPDATE users SET password_change_token = $2, password_change_hash = $3, password_change_requested_at = NOW() WHERE id = $1',
        [user.id, token, hash]
      );
      // Bestätigungslink senden
      const { email, name } = userResult.rows[0];
      const confirmUrl = `${process.env.FRONTEND_URL || 'https://beequ.de'}/confirm-password-change?token=${token}`;
      const { sendPasswordChangeConfirmMail } = require('./_lib/mailer');
      await sendPasswordChangeConfirmMail({ to: email, name, confirmUrl });
      return res.json({ success: true, message: 'Bitte bestätige die Änderung per Link in deiner E-Mail.' });
    } catch (err) {
      console.error('Password change request error:', err);
      return res.status(500).json({ error: 'Passwort-Änderung konnte nicht gestartet werden' });
    }
  }

  // GET /api/profile/password/confirm?token=... — Confirm password change
  if (action === 'password' && segments[1] === 'confirm' && req.method === 'GET') {
    try {
      const { token } = req.query;
      if (!token) return res.status(400).json({ error: 'Token fehlt' });
      // Finde User mit passendem Token
      const userResult = await pool.query(
        'SELECT id, password_change_hash, email, name FROM users WHERE password_change_token = $1 AND password_change_hash IS NOT NULL',
        [token]
      );
      if (userResult.rows.length === 0) {
        return res.status(400).json({ error: 'Ungültiger oder abgelaufener Token' });
      }
      const { id, password_change_hash, email, name } = userResult.rows[0];
      // Setze neues Passwort und lösche Token/Hash
      await pool.query(
        'UPDATE users SET password = $2, password_change_token = NULL, password_change_hash = NULL, password_change_requested_at = NULL WHERE id = $1',
        [id, password_change_hash]
      );
      // Benachrichtigungs-E-Mail
      try {
        const { sendPasswordChangedMail } = require('./_lib/mailer');
        await sendPasswordChangedMail({ to: email, name });
      } catch (mailErr) {
        console.error('Passwort-Änderungs-Mail Fehler:', mailErr.message);
      }
      // Wenn der Request aus dem Browser kommt (kein fetch/XHR), redirect auf Bestätigungsseite
      const accept = req.headers['accept'] || '';
      if (accept.includes('text/html')) {
        return res.redirect(303, '/confirm-password-change');
      }
      return res.json({ success: true, message: 'Passwort erfolgreich geändert.' });
    } catch (err) {
      console.error('Password change confirm error:', err);
      return res.status(500).json({ error: 'Passwort konnte nicht bestätigt werden' });
    }
  }

  // GET /api/profile/export — Export all user data
  if (action === 'export' && req.method === 'GET') {
    try {
      const userData = await pool.query(
        'SELECT id, name, email, created_at FROM users WHERE id = $1',
        [user.id]
      );
      const tasksData = await pool.query(
        `SELECT t.title, t.description, t.date, t.date_end, t.time, t.time_end,
           t.priority, t.completed, t.created_at, c.name as category
         FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.user_id = $1 ORDER BY t.created_at DESC`,
        [user.id]
      );
      const categoriesData = await pool.query(
        'SELECT name, color, icon FROM categories WHERE user_id = $1',
        [user.id]
      );

      return res.json({
        exported_at: new Date().toISOString(),
        user: userData.rows[0],
        tasks: tasksData.rows,
        categories: categoriesData.rows,
      });
    } catch (err) {
      console.error('Export error:', err);
      return res.status(500).json({ error: 'Export fehlgeschlagen' });
    }
  }

  // PATCH /api/profile/visibility — Update profile_visibility setting
  if (action === 'visibility' && req.method === 'PATCH') {
    try {
      const { profile_visibility } = req.body;
      const allowed = ['everyone', 'nobody'];
      if (!allowed.includes(profile_visibility)) {
        return res.status(400).json({ error: 'Ungültiger Wert. Erlaubt: everyone, nobody' });
      }
      await pool.query(
        'UPDATE users SET profile_visibility = $2 WHERE id = $1',
        [user.id, profile_visibility]
      );
      return res.json({ success: true, profile_visibility });
    } catch (err) {
      console.error('Visibility update error:', err);
      return res.status(500).json({ error: 'Einstellung konnte nicht gespeichert werden' });
    }
  }

  // GET /api/profile/user/:id — View another user's profile (friends only, respects visibility)
  if (action === 'user' && segments[1] && req.method === 'GET') {
    try {
      const targetId = parseInt(segments[1]);
      if (isNaN(targetId)) return res.status(400).json({ error: 'Ungültige ID' });
      if (targetId === user.id) return res.status(400).json({ error: 'Eigenes Profil über /api/profile abrufen' });

      // Check friendship
      const friendship = await pool.query(
        `SELECT id FROM friends
         WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
         AND status = 'accepted'`,
        [user.id, targetId]
      );
      if (friendship.rows.length === 0) {
        return res.status(403).json({ error: 'Nur Freunde können Profile einsehen' });
      }

      // Check target user's visibility setting
      const targetUser = await pool.query(
        `SELECT id, name, email, avatar_url, avatar_color, bio, profile_visibility, created_at
         FROM users WHERE id = $1`,
        [targetId]
      );
      if (targetUser.rows.length === 0) return res.status(404).json({ error: 'Nutzer nicht gefunden' });

      const t = targetUser.rows[0];
      if (t.profile_visibility === 'nobody') {
        return res.status(403).json({ error: 'Dieser Nutzer hat sein Profil auf privat gestellt' });
      }

      // Full stats (same as own profile)
      const stats = await pool.query(
        `SELECT
           COUNT(*) as total_tasks,
           COUNT(*) FILTER (WHERE completed = true) as completed_tasks,
           COUNT(DISTINCT date) as active_days
         FROM tasks WHERE user_id = $1`,
        [targetId]
      );

      const streakResult = await pool.query(
        `WITH completed_dates AS (
           SELECT DISTINCT DATE(updated_at) as d
           FROM tasks
           WHERE user_id = $1 AND completed = true
           ORDER BY d DESC
         ),
         numbered AS (
           SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d DESC))::int * INTERVAL '1 day' as grp
           FROM completed_dates
         )
         SELECT COUNT(*) as streak
         FROM numbered
         WHERE grp = (SELECT grp FROM numbered LIMIT 1)`,
        [targetId]
      );

      const weekResult = await pool.query(
        `SELECT COUNT(*) as week_completed
         FROM tasks
         WHERE user_id = $1 AND completed = true
         AND updated_at >= NOW() - INTERVAL '7 days'`,
        [targetId]
      );

      const categoryStats = await pool.query(
        `SELECT c.name, c.color, COUNT(*) as count,
           COUNT(*) FILTER (WHERE t.completed = true) as done
         FROM tasks t JOIN categories c ON t.category_id = c.id
         WHERE t.user_id = $1
         GROUP BY c.name, c.color
         ORDER BY count DESC
         LIMIT 5`,
        [targetId]
      );

      const s = stats.rows[0];
      const completionRate = s.total_tasks > 0
        ? Math.round((s.completed_tasks / s.total_tasks) * 100)
        : 0;

      return res.json({
        user: {
          id: t.id,
          name: t.name,
          avatar_url: t.avatar_url,
          avatar_color: t.avatar_color,
          bio: t.bio,
          member_since: t.created_at,
        },
        stats: {
          total_tasks: parseInt(s.total_tasks),
          completed_tasks: parseInt(s.completed_tasks),
          active_days: parseInt(s.active_days),
          completion_rate: completionRate,
          streak: parseInt(streakResult.rows[0]?.streak || 0),
          week_completed: parseInt(weekResult.rows[0]?.week_completed || 0),
          category_breakdown: categoryStats.rows,
        },
      });
    } catch (err) {
      console.error('Friend profile error:', err);
      return res.status(500).json({ error: 'Profil konnte nicht geladen werden' });
    }
  }

  // DELETE /api/profile — Delete account
  if (!action && req.method === 'DELETE') {
    try {
      const { password } = req.body;
      if (!password) {
        return res.status(400).json({ error: 'Passwort zur Bestätigung erforderlich' });
      }

      const userResult = await pool.query('SELECT password FROM users WHERE id = $1', [user.id]);
      const valid = await bcrypt.compare(password, userResult.rows[0].password);
      if (!valid) {
        return res.status(401).json({ error: 'Passwort ist falsch' });
      }

      // Delete all user data
      await pool.query('DELETE FROM tasks WHERE user_id = $1', [user.id]);
      await pool.query('DELETE FROM categories WHERE user_id = $1', [user.id]);
      try {
        await pool.query('DELETE FROM friends WHERE user_id = $1 OR friend_id = $1', [user.id]);
        await pool.query('DELETE FROM task_permissions WHERE user_id = $1', [user.id]);
      } catch (e) { /* tables may not exist */ }
      await pool.query('DELETE FROM users WHERE id = $1', [user.id]);

      return res.json({ success: true, message: 'Account gelöscht' });
    } catch (err) {
      console.error('Delete account error:', err);
      return res.status(500).json({ error: 'Account konnte nicht gelöscht werden' });
    }
  }

  return res.status(404).json({ error: 'Route nicht gefunden' });
};
