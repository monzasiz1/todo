const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');
const { parseTaskWithAI, parsePermissionsWithAI } = require('./_lib/mistral');

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

function nextOccurrenceDate(currentDate, rule, interval = 1) {
  const d = toDateOnly(currentDate);
  if (!d || !rule) return null;

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
    case 'weekdays':
      do {
        d.setDate(d.getDate() + 1);
      } while (d.getDay() === 0 || d.getDay() === 6);
      break;
    default:
      return null;
  }

  return formatDateOnly(d);
}

function buildRecurringDates(startDate, rule, interval, endDate) {
  if (!startDate || !rule || !endDate) return [];

  const dates = [];
  let cursor = startDate;
  let guard = 0;

  while (guard < 366) {
    const next = nextOccurrenceDate(cursor, rule, interval);
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

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Methode nicht erlaubt' });
  }

  const subPath = req.query.__path || '';
  const segments = subPath.split('/').filter(Boolean);
  const action = segments[0] || '';
  const pool = getPool();

  // POST /api/ai/parse
  if (action === 'parse') {
    try {
      const { input } = req.body;
      if (!input) {
        return res.status(400).json({ error: 'Eingabe ist erforderlich' });
      }

      // Get user's groups for recognition
      const groupsRes = await pool.query(
        `SELECT g.id, g.name, g.color, g.image_url FROM groups g JOIN group_members gm ON gm.group_id = g.id WHERE gm.user_id = $1`,
        [user.id]
      );
      const groupNames = groupsRes.rows.map(g => g.name);

      const parsed = await parseTaskWithAI(input, { groupNames });
      let matchedGroup = null;
      if (parsed.group_name) {
        matchedGroup = groupsRes.rows.find(
          (g) => g.name.toLowerCase() === parsed.group_name.toLowerCase()
            || g.name.toLowerCase().includes(parsed.group_name.toLowerCase())
            || parsed.group_name.toLowerCase().includes(g.name.toLowerCase())
        ) || null;
      }
      if (matchedGroup) {
        parsed.group_id = matchedGroup.id;
        parsed.group_color = matchedGroup.color || null;
        parsed.group_image_url = matchedGroup.image_url || null;
      }
      return res.json({ parsed });
    } catch (err) {
      console.error('AI parse error:', err);
      return res.status(500).json({ error: 'KI-Analyse fehlgeschlagen' });
    }
  }

  // POST /api/ai/permissions — parse natural language permissions
  if (action === 'permissions') {
    try {
      const { input } = req.body;
      if (!input) return res.status(400).json({ error: 'Eingabe erforderlich' });

      // Get user's friends
      const friends = await pool.query(
        `SELECT u.id, u.name FROM friends f
         JOIN users u ON u.id = CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
         WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'`,
        [user.id]
      );

      const friendNames = friends.rows.map((f) => f.name);
      const parsed = await parsePermissionsWithAI(input, friendNames);

      // Resolve names to user IDs
      const resolvedVisibleTo = [];
      const resolvedEditableBy = [];

      if (parsed.visible_to) {
        for (const name of parsed.visible_to) {
          const match = friends.rows.find((f) =>
            f.name.toLowerCase().includes(name.toLowerCase())
          );
          if (match) resolvedVisibleTo.push({ id: match.id, name: match.name });
        }
      }

      if (Array.isArray(parsed.editable_by)) {
        for (const name of parsed.editable_by) {
          const match = friends.rows.find((f) =>
            f.name.toLowerCase().includes(name.toLowerCase())
          );
          if (match) resolvedEditableBy.push({ id: match.id, name: match.name });
        }
      }

      // Handle exclusions
      let excluded = [];
      if (parsed.excluded) {
        for (const name of parsed.excluded) {
          const match = friends.rows.find((f) =>
            f.name.toLowerCase().includes(name.toLowerCase())
          );
          if (match) excluded.push({ id: match.id, name: match.name });
        }
      }

      return res.json({
        parsed: {
          ...parsed,
          resolved_visible_to: resolvedVisibleTo,
          resolved_editable_by: parsed.editable_by === 'all' ? 'all' : resolvedEditableBy,
          resolved_excluded: excluded,
        },
      });
    } catch (err) {
      console.error('AI permissions error:', err);
      return res.status(500).json({ error: 'KI-Berechtigungsanalyse fehlgeschlagen' });
    }
  }

  // POST /api/ai/parse-and-create
  if (action === 'parse-and-create') {
    try {
      const { input, visibility: reqVisibility, permissions: reqPermissions } = req.body;
      if (!input) {
        return res.status(400).json({ error: 'Eingabe ist erforderlich' });
      }

      const categories = await pool.query(
        'SELECT id, name FROM categories WHERE user_id = $1',
        [user.id]
      );

      // Get user's groups for recognition
      const groupsRes = await pool.query(
        `SELECT g.id, g.name, g.color, g.image_url FROM groups g JOIN group_members gm ON gm.group_id = g.id WHERE gm.user_id = $1`,
        [user.id]
      );
      const groupNames = groupsRes.rows.map(g => g.name);

      const parsed = await parseTaskWithAI(input, { groupNames });
      if (!parsed || !parsed.title) {
        return res.status(400).json({ error: 'Aufgabe konnte nicht erkannt werden' });
      }

      // Map AI category name to category_id
      let categoryId = null;
      if (parsed.category) {
        const match = categories.rows.find(
          (c) => c.name.toLowerCase() === parsed.category.toLowerCase()
        );
        if (match) categoryId = match.id;
      }

      // Determine visibility and permissions
      let finalVisibility = reqVisibility || 'private';
      let permissions = reqPermissions || [];
      let sharedWithNames = [];

      // If AI detected share_with names, auto-resolve to friends
      if (parsed.share_with && Array.isArray(parsed.share_with) && parsed.share_with.length > 0) {
        const friends = await pool.query(
          `SELECT u.id, u.name FROM friends f
           JOIN users u ON u.id = CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
           WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'`,
          [user.id]
        );

        const resolvedPerms = [];
        for (const name of parsed.share_with) {
          const friend = friends.rows.find(
            (f) => f.name.toLowerCase().includes(name.toLowerCase()) ||
                   name.toLowerCase().includes(f.name.split(' ')[0].toLowerCase())
          );
          if (friend) {
            resolvedPerms.push({ user_id: friend.id, can_view: true, can_edit: true });
            sharedWithNames.push(friend.name);
          }
        }

        if (resolvedPerms.length > 0) {
          finalVisibility = 'selected_users';
          permissions = resolvedPerms;
        } else {
          // Names given but no matching friends found
          parsed.share_error = `Kein Freund gefunden für: ${parsed.share_with.join(', ')}. Füge sie zuerst als Freund hinzu!`;
        }
      }

      const maxOrder = await pool.query(
        'SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM tasks WHERE user_id = $1',
        [user.id]
      );

      const recurrenceRule = parsed.recurrence_rule || null;
      const recurrenceInterval = Math.max(1, Number(parsed.recurrence_interval) || 1);
      const recurrenceEnd = parsed.recurrence_end || null;
      const extraDates = buildRecurringDates(parsed.date || null, recurrenceRule, recurrenceInterval, recurrenceEnd);

      let spanDays = 0;
      if (parsed.date && parsed.date_end) {
        const start = toDateOnly(parsed.date);
        const end = toDateOnly(parsed.date_end);
        if (start && end) {
          spanDays = Math.max(0, Math.round((end - start) / 86400000));
        }
      }

      const taskType = parsed.type === 'event' ? 'event' : 'task';

      const result = await pool.query(
        `INSERT INTO tasks (user_id, title, description, date, date_end, time, time_end, priority, category_id, reminder_at, sort_order, visibility,
         recurrence_rule, recurrence_interval, recurrence_end, type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING *`,
        [user.id, parsed.title, parsed.description || null, parsed.date || null,
         parsed.date_end || null, parsed.time || null, parsed.time_end || null,
         parsed.priority || 'medium', categoryId,
         null, maxOrder.rows[0].next_order, finalVisibility,
         recurrenceRule, recurrenceInterval, recurrenceEnd, taskType]
      );

      const firstTask = result.rows[0];
      const createdTasks = [firstTask];
      const taskIds = [firstTask.id];

      for (let i = 0; i < extraDates.length; i++) {
        const occurrenceDate = extraDates[i];
        const occurrenceDateEnd = spanDays > 0 ? shiftDate(occurrenceDate, spanDays) : null;

        const ins = await pool.query(
          `INSERT INTO tasks (user_id, title, description, date, date_end, time, time_end, priority, category_id, reminder_at, sort_order, visibility,
           recurrence_rule, recurrence_interval, recurrence_end, recurrence_parent_id, type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           RETURNING *`,
          [user.id, parsed.title, parsed.description || null, occurrenceDate,
           occurrenceDateEnd, parsed.time || null, parsed.time_end || null,
           parsed.priority || 'medium', categoryId,
           null, maxOrder.rows[0].next_order + i + 1, finalVisibility,
           recurrenceRule, recurrenceInterval, recurrenceEnd, firstTask.id, taskType]
        );

        createdTasks.push(ins.rows[0]);
        taskIds.push(ins.rows[0].id);
      }

      // Set permissions
      if (permissions && Array.isArray(permissions) && permissions.length > 0) {
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

      // Auto-link to group if AI recognized a group name
      let groupInfo = null;
      if (parsed.group_name) {
        const matchedGroup = groupsRes.rows.find(
          (g) => g.name.toLowerCase() === parsed.group_name.toLowerCase()
            || g.name.toLowerCase().includes(parsed.group_name.toLowerCase())
            || parsed.group_name.toLowerCase().includes(g.name.toLowerCase())
        );
        if (matchedGroup) {
          for (const currentTaskId of taskIds) {
            await pool.query(
              `INSERT INTO group_tasks (group_id, task_id, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
              [matchedGroup.id, currentTaskId, user.id]
            );
          }
          groupInfo = {
            id: matchedGroup.id,
            name: matchedGroup.name,
            color: matchedGroup.color || null,
            image_url: matchedGroup.image_url || null,
          };
        }
      }

      return res.status(201).json({
        task: firstTask,
        created_tasks: createdTasks,
        created_count: createdTasks.length,
        parsed,
        shared_with: sharedWithNames,
        group: groupInfo,
      });
    } catch (err) {
      console.error('AI parse-and-create error:', err);
      return res.status(500).json({ error: 'KI-Erstellung fehlgeschlagen' });
    }
  }

  return res.status(404).json({ error: 'Route nicht gefunden' });
};
