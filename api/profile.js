const bcrypt = require('bcryptjs');
const { getPool } = require('./_lib/db');
const { verifyToken, generateToken, cors } = require('./_lib/auth');
const { sendPasswordChangedMail } = require('./_lib/mailer');
const { getUserPlan, canUseFeature } = require('./_lib/plans');
const storage = require('./_lib/storage');

// Erweiterte Produktivitaets-Statistiken (Pro/Team). Bewusst nur fuer
// berechtigte Plaene berechnet, damit der Free-Profil-Load leicht bleibt.
async function computeAdvancedStats(pool, userId) {
  const [daily, weekday, priority, best, months, ontime, types, busiest] = await Promise.all([
    // Erledigte Aufgaben pro Tag (letzte 30 Tage)
    pool.query(
      `SELECT to_char(DATE(updated_at), 'YYYY-MM-DD') AS d, COUNT(*)::int AS c
         FROM tasks
        WHERE user_id = $1 AND completed = true
          AND updated_at >= (NOW() - INTERVAL '29 days')
        GROUP BY DATE(updated_at) ORDER BY d`, [userId]),
    // Erledigt nach Wochentag (0=So .. 6=Sa)
    pool.query(
      `SELECT EXTRACT(DOW FROM updated_at)::int AS dow, COUNT(*)::int AS c
         FROM tasks WHERE user_id = $1 AND completed = true GROUP BY dow`, [userId]),
    // Verteilung nach Prioritaet (alle Aufgaben)
    pool.query(
      `SELECT priority, COUNT(*)::int AS c FROM tasks WHERE user_id = $1 GROUP BY priority`, [userId]),
    // Laengste jemals erreichte Serie (aufeinanderfolgende Tage mit Erledigung)
    pool.query(
      `WITH d AS (
         SELECT DISTINCT DATE(updated_at) AS day FROM tasks WHERE user_id = $1 AND completed = true
       ), g AS (
         SELECT day, day - (ROW_NUMBER() OVER (ORDER BY day))::int * INTERVAL '1 day' AS grp FROM d
       )
       SELECT COALESCE(MAX(cnt), 0)::int AS best FROM (SELECT COUNT(*)::int AS cnt FROM g GROUP BY grp) z`, [userId]),
    // Diesen Monat vs. letzten Monat erledigt
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE updated_at >= date_trunc('month', NOW()))::int AS this_month,
         COUNT(*) FILTER (WHERE updated_at >= date_trunc('month', NOW()) - INTERVAL '1 month'
                            AND updated_at <  date_trunc('month', NOW()))::int AS last_month
         FROM tasks WHERE user_id = $1 AND completed = true`, [userId]),
    // Puenktlichkeit: erledigt am/vor Faelligkeitsdatum
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE date IS NOT NULL)::int AS with_due,
         COUNT(*) FILTER (WHERE date IS NOT NULL AND DATE(updated_at) <= date)::int AS on_time
         FROM tasks WHERE user_id = $1 AND completed = true`, [userId]),
    // Aufgaben vs. Termine
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE type = 'event')::int AS events,
         COUNT(*) FILTER (WHERE type IS DISTINCT FROM 'event')::int AS tasks
         FROM tasks WHERE user_id = $1`, [userId]),
    // Produktivste Tageszeit (Stunde mit den meisten Erledigungen)
    pool.query(
      `SELECT EXTRACT(HOUR FROM updated_at)::int AS hour, COUNT(*)::int AS c
         FROM tasks WHERE user_id = $1 AND completed = true
        GROUP BY hour ORDER BY c DESC LIMIT 1`, [userId]),
  ]);
  return {
    daily: daily.rows,
    weekday: weekday.rows,
    priority: priority.rows,
    best_streak: best.rows[0]?.best || 0,
    this_month: months.rows[0]?.this_month || 0,
    last_month: months.rows[0]?.last_month || 0,
    on_time: ontime.rows[0]?.on_time || 0,
    with_due: ontime.rows[0]?.with_due || 0,
    events: types.rows[0]?.events || 0,
    tasks: types.rows[0]?.tasks || 0,
    peak_hour: busiest.rows[0]?.hour ?? null,
  };
}

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
                  profile_visibility, twofa_enabled, calendar_holiday_color
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
        // Manually add twofa_enabled if column doesn't exist yet
        if (userResult.rows[0]) {
          const secretResult = await pool.query('SELECT twofa_secret FROM users WHERE id = $1', [user.id]);
          userResult.rows[0].twofa_enabled = !!secretResult.rows[0]?.twofa_secret;
          try {
            const holidayColorResult = await pool.query(
              'SELECT calendar_holiday_color FROM users WHERE id = $1',
              [user.id]
            );
            userResult.rows[0].calendar_holiday_color = holidayColorResult.rows[0]?.calendar_holiday_color || '#D92C2C';
          } catch {
            userResult.rows[0].calendar_holiday_color = '#D92C2C';
          }
        }
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

      // Erweiterte Statistiken nur fuer Plaene mit statistics-Feature (Pro/Team).
      let advanced = null;
      try {
        const planId = await getUserPlan(pool, user.id);
        if (canUseFeature(planId, 'statistics')) {
          advanced = await computeAdvancedStats(pool, user.id);
        }
      } catch (advErr) {
        console.error('Advanced stats error:', advErr.message);
        advanced = null;
      }

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
          advanced,
        },
      });
    } catch (err) {
      console.error('Profile get error:', err);
      return res.status(500).json({ error: 'Profil konnte nicht geladen werden' });
    }
  }

  // PUT /api/profile — Update name, bio, avatar_color, theme, calendar_holiday_color
  if (!action && req.method === 'PUT') {
    try {
      const { name, bio, avatar_color, theme, calendar_holiday_color } = req.body;

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
      if (calendar_holiday_color !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(calendar_holiday_color)) {
        return res.status(400).json({ error: 'Ungültige Feiertagsfarbe' });
      }
      if (theme !== undefined && !['light', 'dark', 'auto'].includes(theme)) {
        return res.status(400).json({ error: 'Ungültiges Theme' });
      }

      const result = calendar_holiday_color !== undefined
        ? await pool.query(
          `UPDATE users SET
             name = COALESCE($2, name),
             bio = COALESCE($3, bio),
             avatar_color = COALESCE($4, avatar_color),
             theme = COALESCE($5, theme),
             calendar_holiday_color = COALESCE($6, calendar_holiday_color)
           WHERE id = $1
           RETURNING id, name, email, avatar_url, avatar_color, bio, theme, created_at, twofa_enabled, calendar_holiday_color`,
          [user.id, name || null, bio !== undefined ? bio : null, avatar_color || null, theme || null, calendar_holiday_color || null]
        )
        : await pool.query(
          `UPDATE users SET
             name = COALESCE($2, name),
             bio = COALESCE($3, bio),
             avatar_color = COALESCE($4, avatar_color),
             theme = COALESCE($5, theme)
           WHERE id = $1
           RETURNING id, name, email, avatar_url, avatar_color, bio, theme, created_at, twofa_enabled`,
          [user.id, name || null, bio !== undefined ? bio : null, avatar_color || null, theme || null]
        );

      const updatedUser = {
        ...result.rows[0],
        calendar_holiday_color: result.rows[0]?.calendar_holiday_color || calendar_holiday_color || '#D92C2C',
      };
      const token = generateToken(updatedUser);
      return res.json({ user: updatedUser, twofa_enabled: updatedUser.twofa_enabled, token });
    } catch (err) {
      console.error('Profile update error:', err);
      return res.status(500).json({ error: 'Profil konnte nicht aktualisiert werden' });
    }
  }

  // PUT /api/profile/avatar — Upload avatar image (base64 → Supabase Storage)
  if (action === 'avatar' && req.method === 'PUT') {
    try {
      const { avatar_url } = req.body;

      // Avatar entfernen
      if (!avatar_url) {
        try { await storage.deleteAvatar(user.id); } catch { /* ignore */ }
        await pool.query('UPDATE users SET avatar_url = NULL WHERE id = $1', [user.id]);
        return res.json({ avatar_url: null });
      }

      // Falls bereits eine HTTPS-URL geschickt wird (z.B. Re-Save ohne Aenderung),
      // nicht erneut hochladen, nur persistieren.
      if (/^https?:\/\//i.test(avatar_url)) {
        await pool.query('UPDATE users SET avatar_url = $2 WHERE id = $1', [user.id, avatar_url]);
        return res.json({ avatar_url });
      }

      if (!avatar_url.startsWith('data:image/')) {
        return res.status(400).json({ error: 'Ungueltiges Bildformat' });
      }
      if (avatar_url.length > 2800000) {
        return res.status(400).json({ error: 'Bild zu gross (max. 2MB)' });
      }

      if (!storage.isConfigured()) {
        return res.status(503).json({
          error: 'Avatar-Upload nicht verfuegbar (Storage nicht konfiguriert)',
        });
      }

      let publicUrl;
      try {
        publicUrl = await storage.uploadAvatarFromDataUri(user.id, avatar_url);
      } catch (e) {
        console.error('Avatar upload to Storage failed:', e?.message || e);
        return res.status(500).json({ error: 'Avatar konnte nicht hochgeladen werden' });
      }

      await pool.query('UPDATE users SET avatar_url = $2 WHERE id = $1', [user.id, publicUrl]);
      return res.json({ avatar_url: publicUrl });
    } catch (err) {
      console.error('Avatar upload error:', err);
      return res.status(500).json({ error: 'Avatar konnte nicht hochgeladen werden' });
    }
  }


  // PUT /api/profile/password — Passwort direkt ändern (kein Bestätigungsmail nötig)
  if (action === 'password' && req.method === 'PUT') {
    try {
      const { current_password, new_password } = req.body;
      if (!current_password || !new_password)
        return res.status(400).json({ error: 'Aktuelles und neues Passwort erforderlich' });
      if (new_password.length < 6)
        return res.status(400).json({ error: 'Neues Passwort muss mindestens 6 Zeichen haben' });

      const userResult = await pool.query(
        'SELECT password, email, name FROM users WHERE id = $1', [user.id]
      );
      if (userResult.rows.length === 0)
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });

      const valid = await bcrypt.compare(current_password, userResult.rows[0].password);
      if (!valid)
        return res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });

      const hash = await bcrypt.hash(new_password, 12);
      await pool.query('UPDATE users SET password = $2 WHERE id = $1', [user.id, hash]);

      // Benachrichtigung senden (non-blocking)
      try {
        const { sendPasswordChangedMail } = require('./_lib/mailer');
        await sendPasswordChangedMail({ to: userResult.rows[0].email, name: userResult.rows[0].name });
      } catch (mailErr) {
        console.error('Passwort-Mail Fehler:', mailErr.message);
      }

      return res.json({ success: true, message: 'Passwort erfolgreich geändert' });
    } catch (err) {
      console.error('Password change error:', err);
      return res.status(500).json({ error: 'Passwort konnte nicht geändert werden' });
    }
  }

  // DEPRECATED: GET /api/profile/password/confirm — altes 2-Schritt-Flow, leitet auf Login weiter
  if (action === 'password' && segments[1] === 'confirm' && req.method === 'GET') {
    return res.redirect(303, `${process.env.FRONTEND_URL || 'https://beequ.de'}/login?pwreset=1`);
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

  // DELETE /api/profile — Delete account (hard delete, atomar)
  if (!action && req.method === 'DELETE') {
    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ error: 'Passwort zur Bestätigung erforderlich' });
    }

    const userResult = await pool.query('SELECT password FROM users WHERE id = $1', [user.id]);
    if (!userResult.rows[0]) {
      return res.status(404).json({ error: 'Konto nicht gefunden' });
    }
    const valid = await bcrypt.compare(password, userResult.rows[0].password);
    if (!valid) {
      return res.status(401).json({ error: 'Passwort ist falsch' });
    }

    // Avatar im externen Storage best-effort entfernen (nicht Teil der DB-Transaktion).
    try { await storage.deleteAvatar(user.id); } catch { /* ignore */ }

    // Gesamte Löschung in EINER Transaktion: entweder vollständig oder gar nichts.
    // Verhindert den bisherigen halb-gelöschten Zustand (tasks/categories weg,
    // User-Datensatz bleibt, Login weiter möglich).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const tableExists = async (name) =>
        (await client.query('SELECT to_regclass($1) AS t', [name])).rows[0].t !== null;

      // group_messages.pinned_by hat KEIN ON DELETE CASCADE und blockiert sonst
      // das Löschen des Users (z. B. wenn er irgendwo eine Nachricht angepinnt hat).
      // Referenz vorher auflösen.
      if (await tableExists('public.group_messages')) {
        await client.query(
          'UPDATE group_messages SET pinned_by = NULL, is_pinned = FALSE, pinned_at = NULL WHERE pinned_by = $1',
          [user.id]
        );
      }

      // Tabellen ohne FK-CASCADE explizit räumen (nur falls vorhanden).
      if (await tableExists('public.friends')) {
        await client.query('DELETE FROM friends WHERE user_id = $1 OR friend_id = $1', [user.id]);
      }
      if (await tableExists('public.task_permissions')) {
        await client.query('DELETE FROM task_permissions WHERE user_id = $1', [user.id]);
      }

      // Alles Übrige hängt per ON DELETE CASCADE am User-Datensatz
      // (tasks, categories, notes, spending, group_members, eigene group_messages …).
      await client.query('DELETE FROM users WHERE id = $1', [user.id]);

      await client.query('COMMIT');
      return res.json({ success: true, message: 'Account gelöscht' });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      console.error('Delete account error:', err);
      return res.status(500).json({ error: 'Account konnte nicht gelöscht werden' });
    } finally {
      client.release();
    }
  }

  return res.status(404).json({ error: 'Route nicht gefunden' });
};
