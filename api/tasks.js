const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

function calcNextDate(currentDate, rule, interval) {
  if (!currentDate) return null;
  const d = new Date(currentDate);
  switch (rule) {
    case 'daily':
      d.setDate(d.getDate() + interval);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7 * interval);
      break;
    case 'biweekly':
      d.setDate(d.getDate() + 14);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + interval);
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() + interval);
      break;
    case 'weekdays': {
      // Next weekday (Mon-Fri)
      let next = new Date(d);
      do {
        next.setDate(next.getDate() + 1);
      } while (next.getDay() === 0 || next.getDay() === 6);
      return next.toISOString().split('T')[0];
    }
    default:
      return null;
  }
  return d.toISOString().split('T')[0];
}

function toDateOnly(value) {
  if (!value) return null;
  return new Date(value + 'T00:00:00');
}

function formatDateOnly(dateObj) {
  return dateObj.toISOString().split('T')[0];
}

function shiftDate(dateValue, days) {
  const d = toDateOnly(dateValue);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return formatDateOnly(d);
}

function buildRecurringDates(startDate, rule, interval, endDate) {
  if (!startDate || !rule || !endDate) return [];

  const dates = [];
  let cursor = startDate;
  let guard = 0;

  while (guard < 366) {
    const next = calcNextDate(cursor, rule, interval || 1);
    if (!next || next > endDate) break;
    dates.push(next);
    cursor = next;
    guard += 1;
  }

  return dates;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const subPath = req.query.__path || '';
  const segments = subPath.split('/').filter(Boolean);
  const pool = getPool();

  // GET /api/tasks/range?start=...&end=...
  if (segments[0] === 'range' && req.method === 'GET') {
    try {
      const { start, end } = req.query || {};
      if (!start || !end) {
        return res.status(400).json({ error: 'Start- und Enddatum erforderlich' });
      }
      const result = await pool.query(
        `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon,
           gt.group_id, grp.name as group_name, grp.color as group_color, grp.image_url as group_image_url,
           gtc.name as group_task_creator_name, gtc.avatar_color as group_task_creator_color
         FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
         LEFT JOIN group_tasks gt ON gt.task_id = t.id
         LEFT JOIN groups grp ON grp.id = gt.group_id
         LEFT JOIN users gtc ON gtc.id = gt.created_by
         WHERE t.user_id = $1 AND (
           (t.date >= $2 AND t.date <= $3)
           OR (t.date_end IS NOT NULL AND t.date <= $3 AND t.date_end >= $2)
         )
         ORDER BY t.date ASC, t.sort_order ASC`,
        [user.id, start, end]
      );
      return res.json({ tasks: result.rows });
    } catch (err) {
      console.error('Tasks range error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden der Aufgaben' });
    }
  }

  // PATCH /api/tasks/reorder
  if (segments[0] === 'reorder' && req.method === 'PATCH') {
    try {
      const { taskIds } = req.body;
      if (!Array.isArray(taskIds)) {
        return res.status(400).json({ error: 'taskIds Array erforderlich' });
      }
      for (let i = 0; i < taskIds.length; i++) {
        await pool.query(
          'UPDATE tasks SET sort_order = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
          [i, taskIds[i], user.id]
        );
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('Reorder error:', err);
      return res.status(500).json({ error: 'Fehler beim Sortieren' });
    }
  }

  // GET /api/tasks/reminders/due
  if (segments[0] === 'reminders' && segments[1] === 'due' && req.method === 'GET') {
    try {
      const result = await pool.query(
        `SELECT t.*, c.name as category_name, c.color as category_color
         FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.user_id = $1 AND t.completed = false
         AND t.reminder_at IS NOT NULL AND t.reminder_at <= NOW()
         ORDER BY t.reminder_at ASC`,
        [user.id]
      );
      return res.json({ tasks: result.rows });
    } catch (err) {
      console.error('Reminders error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden der Erinnerungen' });
    }
  }

  // PATCH /api/tasks/:id/toggle
  if (segments.length === 2 && segments[1] === 'toggle' && req.method === 'PATCH') {
    try {
      const taskId = segments[0];

      // Check if this is an event (events cannot be toggled)
      const typeCheck = await pool.query('SELECT type FROM tasks WHERE id = $1', [taskId]);
      if (typeCheck.rows.length > 0 && typeCheck.rows[0].type === 'event') {
        return res.status(400).json({ error: 'Termine können nicht als erledigt markiert werden' });
      }

      // Owner or has edit permission
      const result = await pool.query(
        `UPDATE tasks SET completed = NOT completed, updated_at = NOW(), last_edited_by = $3
         WHERE id = $1 AND (
           user_id = $2
           OR EXISTS (SELECT 1 FROM task_permissions WHERE task_id = $1 AND user_id = $2 AND can_edit = true)
         )
         RETURNING *`,
        [taskId, user.id, user.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Aufgabe nicht gefunden oder keine Berechtigung' });
      }

      const toggled = result.rows[0];
      let nextTask = null;

      // If a recurring task was just completed, auto-create next occurrence
      if (toggled.completed && toggled.recurrence_rule) {
        const nextDate = calcNextDate(toggled.date, toggled.recurrence_rule, toggled.recurrence_interval || 1);
        // Only create if within recurrence end (or no end set)
        if (nextDate && (!toggled.recurrence_end || nextDate <= toggled.recurrence_end)) {
          // Calculate date_end offset
          let nextDateEnd = null;
          if (toggled.date_end && toggled.date) {
            const diffMs = new Date(toggled.date_end) - new Date(toggled.date);
            const diffDays = Math.round(diffMs / 86400000);
            const nd = new Date(nextDate);
            nd.setDate(nd.getDate() + diffDays);
            nextDateEnd = nd.toISOString().split('T')[0];
          }

          const parentId = toggled.recurrence_parent_id || toggled.id;

          const existingNext = await pool.query(
            `SELECT id FROM tasks
             WHERE user_id = $1 AND recurrence_parent_id = $2 AND date = $3
             LIMIT 1`,
            [toggled.user_id, parentId, nextDate]
          );

          if (existingNext.rows.length > 0) {
            return res.json({ task: toggled, nextTask: null });
          }

          const maxOrder = await pool.query(
            'SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM tasks WHERE user_id = $1',
            [toggled.user_id]
          );

          const ins = await pool.query(
            `INSERT INTO tasks (user_id, title, description, date, date_end, time, time_end, priority, category_id, reminder_at, sort_order, visibility,
             recurrence_rule, recurrence_interval, recurrence_end, recurrence_parent_id, type)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             RETURNING *`,
            [toggled.user_id, toggled.title, toggled.description,
             nextDate, nextDateEnd, toggled.time, toggled.time_end,
             toggled.priority, toggled.category_id, toggled.reminder_at,
             maxOrder.rows[0].next_order, toggled.visibility || 'private',
             toggled.recurrence_rule, toggled.recurrence_interval || 1,
             toggled.recurrence_end, parentId, toggled.type || 'task']
          );
          nextTask = ins.rows[0];

          // Copy group assignment if exists
          try {
            const gt = await pool.query('SELECT group_id, created_by FROM group_tasks WHERE task_id = $1', [toggled.id]);
            if (gt.rows.length > 0) {
              await pool.query(
                'INSERT INTO group_tasks (group_id, task_id, created_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
                [gt.rows[0].group_id, nextTask.id, gt.rows[0].created_by]
              );
            }
          } catch { /* ignore if group tables don't exist */ }
        }
      }

      return res.json({ task: toggled, nextTask });
    } catch (err) {
      console.error('Toggle error:', err);
      return res.status(500).json({ error: 'Fehler beim Umschalten' });
    }
  }

  // PUT /api/tasks/:id
  if (segments.length === 1 && segments[0] !== 'range' && segments[0] !== 'reorder' && req.method === 'PUT') {
    try {
      const taskId = segments[0];
      const { title, description, date, date_end, time, time_end, priority, category_id, reminder_at,
              recurrence_rule, recurrence_interval, recurrence_end, type } = req.body;
      const taskType = type === 'event' ? 'event' : (type === 'task' ? 'task' : undefined);
      const result = await pool.query(
        `UPDATE tasks SET title = COALESCE($1, title), description = COALESCE($2, description),
         date = COALESCE($3, date), date_end = $4, time = COALESCE($5, time), time_end = $6,
         priority = COALESCE($7, priority), category_id = $8,
         reminder_at = $9, recurrence_rule = $12, recurrence_interval = COALESCE($13, 1),
         recurrence_end = $14, type = COALESCE($15, type), updated_at = NOW()
         WHERE id = $10 AND user_id = $11
         RETURNING *`,
        [title, description, date, date_end || null, time, time_end || null, priority, category_id, reminder_at,
         taskId, user.id, recurrence_rule || null, recurrence_interval || 1, recurrence_end || null, taskType || null]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
      }
      return res.json({ task: result.rows[0] });
    } catch (err) {
      console.error('Update error:', err);
      return res.status(500).json({ error: 'Fehler beim Aktualisieren' });
    }
  }

  // DELETE /api/tasks/:id
  if (segments.length === 1 && req.method === 'DELETE') {
    try {
      const taskId = segments[0];
      const result = await pool.query(
        'DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id',
        [taskId, user.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('Delete error:', err);
      return res.status(500).json({ error: 'Fehler beim Löschen' });
    }
  }

  // GET /api/tasks
  if (segments.length === 0 && req.method === 'GET') {
    try {
      // Check if collaboration tables exist
      const hasCollab = await pool.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'visibility') as has_visibility`
      );
      const collabEnabled = hasCollab.rows[0]?.has_visibility === true;

      let result;
      if (collabEnabled) {
        // Full query with collaboration support
        result = await pool.query(
          `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon,
             u.name as creator_name, u.avatar_color as creator_color, u.avatar_url as creator_avatar_url,
             editor.name as last_editor_name,
             CASE WHEN t.user_id = $1 THEN true ELSE false END as is_owner,
             COALESCE(tp.can_edit, false) as can_edit,
             gt.group_id, grp.name as group_name, grp.color as group_color, grp.image_url as group_image_url,
             gtc.name as group_task_creator_name, gtc.avatar_color as group_task_creator_color, gtc.avatar_url as group_task_creator_avatar_url,
             (SELECT COUNT(*) FROM task_attachments ta WHERE ta.task_id = t.id)::int as attachment_count,
             (SELECT COALESCE(json_agg(json_build_object('name', su.name, 'color', su.avatar_color, 'avatar_url', su.avatar_url)), '[]'::json)
              FROM task_permissions tp2 JOIN users su ON tp2.user_id = su.id
              WHERE tp2.task_id = t.id) as shared_with_users
           FROM tasks t
           LEFT JOIN categories c ON t.category_id = c.id
           LEFT JOIN users u ON t.user_id = u.id
           LEFT JOIN users editor ON t.last_edited_by = editor.id
           LEFT JOIN task_permissions tp ON tp.task_id = t.id AND tp.user_id = $1
           LEFT JOIN group_tasks gt ON gt.task_id = t.id
           LEFT JOIN groups grp ON grp.id = gt.group_id
           LEFT JOIN users gtc ON gtc.id = gt.created_by
           WHERE t.user_id = $1
             OR (t.visibility = 'shared' AND EXISTS (
               SELECT 1 FROM friends f WHERE f.status = 'accepted'
               AND ((f.user_id = t.user_id AND f.friend_id = $1) OR (f.user_id = $1 AND f.friend_id = t.user_id))
             ))
             OR (t.visibility = 'selected_users' AND tp.can_view = true)
             OR EXISTS (SELECT 1 FROM group_tasks gt2 JOIN group_members gm ON gm.group_id = gt2.group_id WHERE gt2.task_id = t.id AND gm.user_id = $1)
           ORDER BY t.sort_order ASC, t.created_at DESC`,
          [user.id]
        );
      } else {
        // Simple query without collaboration
        result = await pool.query(
          `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon,
             gt.group_id, grp.name as group_name, grp.color as group_color, grp.image_url as group_image_url,
             gtc.name as group_task_creator_name, gtc.avatar_color as group_task_creator_color, gtc.avatar_url as group_task_creator_avatar_url,
             (SELECT COUNT(*) FROM task_attachments ta WHERE ta.task_id = t.id)::int as attachment_count
           FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
           LEFT JOIN group_tasks gt ON gt.task_id = t.id
           LEFT JOIN groups grp ON grp.id = gt.group_id
           LEFT JOIN users gtc ON gtc.id = gt.created_by
           WHERE t.user_id = $1
             OR EXISTS (SELECT 1 FROM group_tasks gt2 JOIN group_members gm ON gm.group_id = gt2.group_id WHERE gt2.task_id = t.id AND gm.user_id = $1)
           ORDER BY t.sort_order ASC, t.created_at DESC`,
          [user.id]
        );
      }
      return res.json({ tasks: result.rows });
    } catch (err) {
      console.error('Tasks list error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden der Aufgaben' });
    }
  }

  // POST /api/tasks
  if (segments.length === 0 && req.method === 'POST') {
    try {
      const { title, description, date, date_end, time, time_end, priority, category_id, reminder_at,
              recurrence_rule, recurrence_interval, recurrence_end, group_id,
              visibility, permissions, type } = req.body;
      if (!title) {
        return res.status(400).json({ error: 'Titel ist erforderlich' });
      }

      const taskType = type === 'event' ? 'event' : 'task';

      const visibilityResult = await pool.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'visibility') as has_visibility`
      );
      const collabEnabled = visibilityResult.rows[0]?.has_visibility === true;
      const finalVisibility = collabEnabled ? (visibility || 'private') : 'private';

      let groupInfo = null;
      if (group_id) {
        const groupAccess = await pool.query(
          `SELECT g.id, g.name, g.color, g.image_url
           FROM groups g
           JOIN group_members gm ON gm.group_id = g.id
           WHERE g.id = $1 AND gm.user_id = $2
           LIMIT 1`,
          [group_id, user.id]
        );
        if (groupAccess.rows.length === 0) {
          return res.status(403).json({ error: 'Keine Berechtigung für diese Gruppe' });
        }
        groupInfo = groupAccess.rows[0];
      }

      const maxOrder = await pool.query(
        'SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM tasks WHERE user_id = $1',
        [user.id]
      );

      const recurrenceRule = recurrence_rule || null;
      const recurrenceInterval = Math.max(1, Number(recurrence_interval) || 1);
      const recurrenceEnd = recurrence_end || null;
      const extraDates = buildRecurringDates(date || null, recurrenceRule, recurrenceInterval, recurrenceEnd);

      let spanDays = 0;
      if (date && date_end) {
        const start = toDateOnly(date);
        const end = toDateOnly(date_end);
        if (start && end) {
          spanDays = Math.max(0, Math.round((end - start) / 86400000));
        }
      }

      const result = await pool.query(
        `INSERT INTO tasks (user_id, title, description, date, date_end, time, time_end, priority, category_id, reminder_at, sort_order,
        recurrence_rule, recurrence_interval, recurrence_end, visibility, type)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING *`,
        [user.id, title, description || null, date || null, date_end || null, time || null, time_end || null,
         priority || 'medium', category_id || null, reminder_at || null,
        maxOrder.rows[0].next_order, recurrenceRule, recurrenceInterval, recurrenceEnd, finalVisibility, taskType]
      );

      const firstTask = result.rows[0];
      const createdTasks = [firstTask];
      const taskIds = [firstTask.id];

      for (let i = 0; i < extraDates.length; i++) {
        const occurrenceDate = extraDates[i];
        const occurrenceDateEnd = spanDays > 0 ? shiftDate(occurrenceDate, spanDays) : null;
        const ins = await pool.query(
          `INSERT INTO tasks (user_id, title, description, date, date_end, time, time_end, priority, category_id, reminder_at, sort_order,
           recurrence_rule, recurrence_interval, recurrence_end, recurrence_parent_id, visibility, type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           RETURNING *`,
          [user.id, title, description || null, occurrenceDate, occurrenceDateEnd, time || null, time_end || null,
           priority || 'medium', category_id || null, reminder_at || null,
           maxOrder.rows[0].next_order + i + 1, recurrenceRule, recurrenceInterval, recurrenceEnd, firstTask.id, finalVisibility, taskType]
        );
        createdTasks.push(ins.rows[0]);
        taskIds.push(ins.rows[0].id);
      }

      if (collabEnabled && Array.isArray(permissions) && permissions.length > 0) {
        for (const currentTaskId of taskIds) {
          for (const perm of permissions) {
            if (!perm.user_id) continue;
            await pool.query(
              `INSERT INTO task_permissions (task_id, user_id, can_view, can_edit)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (task_id, user_id) DO UPDATE SET can_view = $3, can_edit = $4`,
              [currentTaskId, perm.user_id, perm.can_view !== false, perm.can_edit === true]
            );
          }
        }
      }

      if (groupInfo) {
        for (const currentTaskId of taskIds) {
          await pool.query(
            `INSERT INTO group_tasks (group_id, task_id, created_by)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [groupInfo.id, currentTaskId, user.id]
          );
        }
      }

      const decoratedTasks = createdTasks.map((task) => ({
        ...task,
        visibility: finalVisibility,
        group_id: groupInfo?.id || null,
        group_name: groupInfo?.name || null,
        group_color: groupInfo?.color || null,
        group_image_url: groupInfo?.image_url || null,
      }));

      return res.status(201).json({
        task: decoratedTasks[0],
        created_tasks: decoratedTasks,
        created_count: decoratedTasks.length,
        group: groupInfo,
      });
    } catch (err) {
      console.error('Create task error:', err);
      return res.status(500).json({ error: 'Fehler beim Erstellen der Aufgabe' });
    }
  }

  return res.status(404).json({ error: 'Route nicht gefunden' });
};
