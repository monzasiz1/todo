const { getPool } = require('../_lib/db');
const { sendPushToUser, wasSentToday, wasTaskReminderSent, wasTaskTypeSent } = require('../_lib/pushService');

/**
 * Cron endpoint – called by Vercel Cron every 5 minutes.
 * Handles:
 * 1. Termin-Erinnerungen (reminder_at fällig)
 * 2. Tägliche Aufgaben-Zusammenfassung (18 Uhr Nutzer-Timezone, Fallback UTC)
 * 3. Engagement-Notifications (inaktiv > 3 Tage)
 * 4. Team-Aufgaben-Benachrichtigungen
 */
module.exports = async function handler(req, res) {
  // Verify cron secret (Vercel sends Authorization header)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const pool = getPool();
  const results = { reminders: 0, dailySummary: 0, engagement: 0, team: 0 };

  // Helper: check if user has a notification type enabled
  async function isTypeEnabled(userId, type) {
    const { rows } = await pool.query('SELECT notification_prefs FROM users WHERE id = $1', [userId]);
    const prefs = rows[0]?.notification_prefs || { reminder: true, daily_tasks: true, engagement: true, team_task: true };
    return prefs[type] !== false;
  }

  try {
    // ─── 1. Termin-Erinnerungen (reminder_at <= NOW und noch nicht gesendet) ───
    const { rows: dueReminders } = await pool.query(
      `SELECT t.id, t.title, t.time, t.user_id, t.reminder_at,
              c.name as category_name, c.color as category_color
       FROM tasks t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.completed = false
         AND t.reminder_at IS NOT NULL
         AND t.reminder_at <= NOW()
         AND t.reminder_at > NOW() - INTERVAL '24 hours'`
    );

    for (const task of dueReminders) {
      if (!(await isTypeEnabled(task.user_id, 'reminder'))) continue;
      const alreadySent = await wasTaskReminderSent(task.user_id, task.id);
      if (alreadySent) continue;

      // Always attempt to send (push service will log even if no subscriptions)
      const sent = await sendPushToUser(
        task.user_id,
        {
          title: '⏰ Erinnerung',
          body: `${task.title}${task.time ? ' um ' + task.time.slice(0, 5) : ''}`,
          tag: `reminder-${task.id}`,
          url: '/calendar',
        },
        'reminder',
        task.id
      );
      
      // Manual log if push had 0 deliveries (for offline or no subscription users)
      if (sent === 0) {
        await pool.query(
          `INSERT INTO notification_log (user_id, type, task_id, title, body) 
           VALUES ($1, $2, $3, $4, $5) 
           ON CONFLICT DO NOTHING`,
          [
            task.user_id,
            'reminder',
            task.id,
            '⏰ Erinnerung',
            `${task.title}${task.time ? ' um ' + task.time.slice(0, 5) : ''}`,
          ]
        ).catch(() => null);
      }
      
      results.reminders++;
    }

    // ─── 2. Tägliche Aufgaben-Zusammenfassung (1x pro Tag, ~18 Uhr UTC) ───
    const currentHour = new Date().getUTCHours();
    if (currentHour === 18) {
      const { rows: usersWithTasks } = await pool.query(
        `SELECT u.id as user_id, COUNT(t.id) as open_count
         FROM users u
         INNER JOIN tasks t ON t.user_id = u.id AND t.completed = false AND t.type != 'event'
         INNER JOIN push_subscriptions ps ON ps.user_id = u.id
         GROUP BY u.id
         HAVING COUNT(t.id) > 0`
      );

      for (const row of usersWithTasks) {
        if (!(await isTypeEnabled(row.user_id, 'daily_tasks'))) continue;
        const already = await wasSentToday(row.user_id, 'daily_tasks');
        if (already) continue;

        await sendPushToUser(
          row.user_id,
          {
            title: '📌 Offene Aufgaben',
            body: `Du hast noch ${row.open_count} offene Aufgabe${row.open_count > 1 ? 'n' : ''}`,
            tag: 'daily-tasks',
            url: '/',
          },
          'daily_tasks'
        );
        results.dailySummary++;
      }
    }

    // ─── 3. Engagement-Notifications (inaktiv > 3 Tage) ───
    if (currentHour === 10) {
      const { rows: inactiveUsers } = await pool.query(
        `SELECT u.id as user_id
         FROM users u
         INNER JOIN push_subscriptions ps ON ps.user_id = u.id
         WHERE u.last_active_at < NOW() - INTERVAL '3 days'
         AND NOT EXISTS (
           SELECT 1 FROM notification_log nl
           WHERE nl.user_id = u.id
           AND nl.sent_at >= CURRENT_DATE
         )`
      );

      for (const row of inactiveUsers) {
        if (!(await isTypeEnabled(row.user_id, 'engagement'))) continue;
        const already = await wasSentToday(row.user_id, 'engagement');
        if (already) continue;

        await sendPushToUser(
          row.user_id,
          {
            title: '📈 Bleib organisiert',
            body: 'Ein kurzer Check deiner Aufgaben lohnt sich!',
            tag: 'engagement',
            url: '/',
          },
          'engagement'
        );
        results.engagement++;
      }
    }

    // ─── 4. Team-Aufgaben (neue Gruppen-Tasks der letzten 5 Minuten) ───
    // Only run if tasks table has group_id column
    const { rows: colCheck } = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'tasks' AND column_name = 'group_id' LIMIT 1`
    );

    if (colCheck.length > 0) {
      const { rows: newGroupTasks } = await pool.query(
        `SELECT t.id, t.title, t.user_id as creator_id, g.id as group_id, g.name as group_name
         FROM tasks t
         INNER JOIN groups g ON t.group_id = g.id
         WHERE t.created_at > NOW() - INTERVAL '6 minutes'
         AND t.created_at <= NOW()`
      );

      for (const task of newGroupTasks) {
        const { rows: members } = await pool.query(
          `SELECT user_id FROM group_members
           WHERE group_id = $1 AND user_id != $2`,
          [task.group_id, task.creator_id]
        );

        for (const member of members) {
          if (!(await isTypeEnabled(member.user_id, 'team_task'))) continue;
          const already = await wasTaskTypeSent(member.user_id, task.id, 'team_task');
          if (already) continue;

          await sendPushToUser(
            member.user_id,
            {
              title: `👥 ${task.group_name}`,
              body: `Neue Aufgabe: ${task.title}`,
              tag: `team-${task.id}`,
              url: '/groups',
            },
            'team_task',
            task.id
          );
          results.team++;
        }
      }
    }

    return res.json({ success: true, results });
  } catch (err) {
    console.error('Cron error:', err);
    return res.status(500).json({ error: 'Cron-Job fehlgeschlagen', details: err.message });
  }
};
