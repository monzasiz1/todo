const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');
const { parseTaskWithAI, parsePermissionsWithAI, classifyIntentWithAI, answerCalendarQueryWithAI } = require('./_lib/mistral');

function toDateOnly(value) {
  if (!value) return null;
  // PostgreSQL gibt date-Spalten als JS Date-Objekte zurück
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const iso = value.toISOString().split('T')[0];
    return new Date(iso + 'T00:00:00');
  }
  // String: nur die ersten 10 Zeichen nehmen (ignoriert Zeitzone/Zeit-Anteil)
  const str = String(value).substring(0, 10);
  const d = new Date(str + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return d;
}

function formatDateOnly(dateObj) {
  if (!dateObj || isNaN(dateObj.getTime())) return null;
  return dateObj.toISOString().split('T')[0];
}

function shiftDate(dateValue, days) {
  const d = toDateOnly(dateValue);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return formatDateOnly(d);
}

function normalizeDateString(value) {
  if (!value) return null;
  if (value instanceof Date) return formatDateOnly(value);
  return String(value).substring(0, 10);
}

function formatDateDe(value) {
  const d = toDateOnly(value);
  if (!d) return String(value || '');
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function timeToMinutes(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function taskOccursOnDate(task, dateStr) {
  const start = normalizeDateString(task.date);
  const end = normalizeDateString(task.date_end) || start;
  if (!start || !end) return false;
  return dateStr >= start && dateStr <= end;
}

function hasTimeConflict(newTask, existingTask) {
  const newStart = timeToMinutes(newTask.time);
  const existingStart = timeToMinutes(existingTask.time);

  // If either side is all-day/without time, treat as overlap for that day.
  if (newStart === null || existingStart === null) return true;

  const newEnd = timeToMinutes(newTask.time_end) ?? (newStart + 60);
  const existingEnd = timeToMinutes(existingTask.time_end) ?? (existingStart + 60);

  return rangesOverlap(newStart, newEnd, existingStart, existingEnd);
}

function buildSuggestionLabel(dateStr, timeStr) {
  const base = formatDateDe(dateStr);
  return timeStr ? `${base} um ${String(timeStr).substring(0, 5)} Uhr` : base;
}

function buildPermissionDeniedMessage(taskTitle, actionVerb) {
  return `Du hast nicht die Rechte, die Aufgabe "${taskTitle}" zu ${actionVerb}.`;
}

async function detectConflictWithSuggestion(pool, userId, parsedTask) {
  if (!parsedTask?.date) return null;

  const targetDate = normalizeDateString(parsedTask.date);
  if (!targetDate) return null;

  const horizonEnd = shiftDate(targetDate, 14) || targetDate;
  const existingRes = await pool.query(
    `SELECT id, title, date, date_end, time, time_end, type
     FROM tasks
     WHERE user_id = $1
       AND completed = false
       AND date IS NOT NULL
       AND date <= $3
       AND (date_end IS NULL OR date_end >= $2)
     ORDER BY date ASC, time ASC NULLS LAST`,
    [userId, targetDate, horizonEnd]
  );

  const tasksOnTargetDate = existingRes.rows.filter((t) => taskOccursOnDate(t, targetDate));
  const conflicting = tasksOnTargetDate.filter((t) => hasTimeConflict(parsedTask, t));
  if (conflicting.length === 0) return null;

  let suggestedDate = null;
  for (let offset = 1; offset <= 14; offset += 1) {
    const candidateDate = shiftDate(targetDate, offset);
    if (!candidateDate) continue;
    const tasksOnCandidate = existingRes.rows.filter((t) => taskOccursOnDate(t, candidateDate));
    const hasConflict = tasksOnCandidate.some((t) => hasTimeConflict(parsedTask, t));
    if (!hasConflict) {
      suggestedDate = candidateDate;
      break;
    }
  }

  const conflictTitles = conflicting.slice(0, 3).map((t) => t.title).filter(Boolean);
  const suggestion = suggestedDate
    ? {
        date: suggestedDate,
        time: parsedTask.time || null,
        label: buildSuggestionLabel(suggestedDate, parsedTask.time || null),
      }
    : null;

  const message = suggestion
    ? `KI-Hinweis: Am ${formatDateDe(targetDate)} gibt es bereits Überschneidungen (${conflictTitles.join(', ') || `${conflicting.length} Termin(e)`}). Vorschlag: ${suggestion.label}.`
    : `KI-Hinweis: Am ${formatDateDe(targetDate)} gibt es bereits Überschneidungen (${conflictTitles.join(', ') || `${conflicting.length} Termin(e)`}).`;

  return {
    has_conflict: true,
    date: targetDate,
    conflict_count: conflicting.length,
    conflicts: conflicting.map((t) => ({
      id: t.id,
      title: t.title,
      time: t.time,
      time_end: t.time_end,
      date: normalizeDateString(t.date),
    })),
    suggestion,
    message,
  };
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
      const {
        input,
        visibility: reqVisibility,
        permissions: reqPermissions,
        type: typeHint,
        groupContext,
        reminder_at_override,
        source_scope,
        source_group_id,
        source_organization_id,
      } = req.body;
      if (!input) {
        return res.status(400).json({ error: 'Eingabe ist erforderlich' });
      }

      // Enrich input with type hint so AI correctly classifies
      let enrichedInput = input;
      if (typeHint === 'aufgabe') enrichedInput = `Aufgabe (task): ${input}`;
      else if (typeHint === 'termin') enrichedInput = `Termin (event) mit fester Uhrzeit: ${input}`;
      else if (typeHint === 'erinnerung') enrichedInput = `Erinnerung – bitte hasReminder auf true setzen: ${input}`;

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

      const parsed = await parseTaskWithAI(enrichedInput, { groupNames, groupContext });
      if (!parsed || !parsed.title) {
        return res.status(400).json({ error: 'Aufgabe konnte nicht erkannt werden' });
      }

      // Reminder flow must never create events. It should always create a task
      // with a notification timestamp chosen by the user when provided.
      if (typeHint === 'erinnerung') {
        parsed.type = 'task';
        parsed.hasReminder = true;
        if (reminder_at_override) {
          const overridden = new Date(reminder_at_override);
          if (!isNaN(overridden.getTime())) {
            parsed.reminder_at = overridden.toISOString();
            if (!parsed.date) parsed.date = overridden.toISOString().split('T')[0];
          }
        }
      }

      // Chat-created entries should always be visible in calendar: if no date,
      // assign today for this chat flow.
      if (groupContext && !parsed.date) {
        parsed.date = formatDateOnly(new Date());
        parsed.auto_assigned_date = true;
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
      // Wenn keine Enddatum für Wiederholung angegeben: Standard 5 Jahre
      let recurrenceEnd = parsed.recurrence_end || null;
      if (recurrenceRule && !recurrenceEnd && parsed.date) {
        const defaultEnd = new Date(parsed.date + 'T00:00:00');
        defaultEnd.setFullYear(defaultEnd.getFullYear() + 5);
        recurrenceEnd = defaultEnd.toISOString().split('T')[0];
      }
      const extraDates = buildRecurringDates(parsed.date || null, recurrenceRule, recurrenceInterval, recurrenceEnd);

      let spanDays = 0;
      if (parsed.date && parsed.date_end) {
        const start = toDateOnly(parsed.date);
        const end = toDateOnly(parsed.date_end);
        if (start && end) {
          spanDays = Math.max(0, Math.round((end - start) / 86400000));
        }
      }

      const taskType = (typeHint === 'erinnerung') ? 'task' : (parsed.type === 'event' ? 'event' : 'task');

      const conflictInfo = taskType === 'event'
        ? await detectConflictWithSuggestion(pool, user.id, parsed)
        : null;

      // Compute reminder_at from AI response or from date+time when hasReminder
      let reminderAt = null;
      if (parsed.reminder_at) {
        reminderAt = new Date(parsed.reminder_at).toISOString();
      } else if (parsed.hasReminder && parsed.date) {
        const rTime = parsed.time || '09:00';
        reminderAt = new Date(`${parsed.date}T${rTime}:00`).toISOString();
      }

      const normalizedScope = source_scope === 'organization'
        ? 'organization'
        : ((groupContext?.id || source_group_id) ? 'group' : 'private');

      const result = await pool.query(
        `INSERT INTO tasks (user_id, title, description, date, date_end, time, time_end, priority, category_id, reminder_at, sort_order, visibility,
         recurrence_rule, recurrence_interval, recurrence_end, type, source_scope, source_group_id, source_organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
         RETURNING *`,
        [user.id, parsed.title, parsed.description || null, parsed.date || null,
         parsed.date_end || null, parsed.time || null, parsed.time_end || null,
         parsed.priority || 'medium', categoryId,
         reminderAt, maxOrder.rows[0].next_order, finalVisibility,
         recurrenceRule, recurrenceInterval, recurrenceEnd, taskType,
         normalizedScope, groupContext?.id || source_group_id || null, source_organization_id || null]
      );

      const firstTask = result.rows[0];
      const createdTasks = [firstTask];
      const taskIds = [firstTask.id];

      for (let i = 0; i < extraDates.length; i++) {
        const occurrenceDate = extraDates[i];
        const occurrenceDateEnd = spanDays > 0 ? shiftDate(occurrenceDate, spanDays) : null;

        const ins = await pool.query(
          `INSERT INTO tasks (user_id, title, description, date, date_end, time, time_end, priority, category_id, reminder_at, sort_order, visibility,
            recurrence_rule, recurrence_interval, recurrence_end, recurrence_parent_id, type, source_scope, source_group_id, source_organization_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
           RETURNING *`,
          [user.id, parsed.title, parsed.description || null, occurrenceDate,
           occurrenceDateEnd, parsed.time || null, parsed.time_end || null,
           parsed.priority || 'medium', categoryId,
           parsed.hasReminder ? new Date(`${occurrenceDate}T${parsed.time || '09:00'}:00`).toISOString() : null,
           maxOrder.rows[0].next_order + i + 1, finalVisibility,
            recurrenceRule, recurrenceInterval, recurrenceEnd, firstTask.id, taskType,
            normalizedScope, groupContext?.id || source_group_id || null, source_organization_id || null]
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
        conflict_info: conflictInfo,
      });
    } catch (err) {
      console.error('AI parse-and-create error:', err);
      return res.status(500).json({ error: 'KI-Erstellung fehlgeschlagen' });
    }
  }

  // POST /api/ai/smart – Unified smart action (create, delete, move, update)
  if (action === 'smart') {
    try {
      const { input } = req.body;
      if (!input) return res.status(400).json({ error: 'Eingabe ist erforderlich' });

      const hasCollab = await pool.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'visibility') as has_visibility`
      );
      const collabEnabled = hasCollab.rows[0]?.has_visibility === true;

      // Fetch user's tasks for matching
      let userTasks = [];
      if (collabEnabled) {
        const taskResult = await pool.query(
          `WITH visible_ids AS (
             SELECT t.id
             FROM tasks t
             WHERE t.user_id = $1

             UNION ALL

             SELECT t.id
             FROM tasks t
             WHERE t.visibility = 'shared'
               AND EXISTS (
                 SELECT 1
                 FROM friends f
                 WHERE f.status = 'accepted'
                   AND ((f.user_id = t.user_id AND f.friend_id = $1) OR (f.user_id = $1 AND f.friend_id = t.user_id))
               )

             UNION ALL

             SELECT tp.task_id AS id
             FROM task_permissions tp
             WHERE tp.user_id = $1 AND tp.can_view = true

             UNION ALL

             SELECT gt.task_id AS id
             FROM group_tasks gt
             JOIN group_members gm ON gm.group_id = gt.group_id
             WHERE gm.user_id = $1
           ),
           task_ids AS (
             SELECT DISTINCT id FROM visible_ids
           )
           SELECT t.id, t.title, t.date, t.time, t.time_end, t.priority, t.completed, t.category_id, t.recurrence_parent_id,
                  CASE
                    WHEN t.user_id = $1 THEN true
                    ELSE EXISTS (
                      SELECT 1 FROM task_permissions tp
                      WHERE tp.task_id = t.id AND tp.user_id = $1 AND tp.can_edit = true
                    )
                  END AS can_edit
           FROM task_ids ids
           JOIN tasks t ON t.id = ids.id
           WHERE t.completed = false
           ORDER BY t.date DESC NULLS LAST
           LIMIT 150`,
          [user.id]
        );
        userTasks = taskResult.rows;
      } else {
        const taskResult = await pool.query(
          `SELECT id, title, date, time, time_end, priority, completed, category_id, recurrence_parent_id,
                  true AS can_edit
           FROM tasks WHERE user_id = $1 AND completed = false
           ORDER BY date DESC NULLS LAST LIMIT 150`,
          [user.id]
        );
        userTasks = taskResult.rows;
      }

      const intent = await classifyIntentWithAI(input, userTasks.map(t => ({
        title: t.title,
        date: t.date,
        time: t.time,
      })));

      // === CREATE → delegate to parse-and-create logic ===
      if (intent.intent === 'create') {
        return res.json({ intent: 'create', redirect: true });
      }

      // === QUERY → answer free time / capacity question ===
      if (intent.intent === 'query') {
        const now = new Date();
        const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
        const today = now.toISOString().split('T')[0];

        // Fetch tasks for the next 14 days
        const end = new Date(now.getTime() + 14 * 86400000).toISOString().split('T')[0];
        const { rows: upcoming } = await pool.query(
          `SELECT title, date, time, time_end, type
           FROM tasks
           WHERE user_id = $1
             AND date >= $2 AND date <= $3
             AND completed = false
           ORDER BY date ASC, time ASC NULLS LAST`,
          [user.id, today, end]
        );

        // Build per-day calendar context
        const calDays = [];
        for (let i = 0; i < 14; i++) {
          const d = new Date(now.getTime() + i * 86400000);
          const dateStr = d.toISOString().split('T')[0];
          calDays.push({
            date: dateStr,
            dayName: days[d.getDay()],
            tasks: upcoming.filter(t => {
              const td = t.date instanceof Date
                ? t.date.toISOString().split('T')[0]
                : String(t.date).substring(0, 10);
              return td === dateStr;
            }).map(t => ({ title: t.title, time: t.time, time_end: t.time_end })),
          });
        }

        const answer = await answerCalendarQueryWithAI(input, {
          today,
          todayName: days[now.getDay()],
          days: calDays,
        });

        return res.json({ intent: 'query', answer });
      }

      // Find matching task by fuzzy title
      let matchedTask = null;
      if (intent.task_title) {
        const search = intent.task_title.toLowerCase();

        // If scope=single and target_date provided: prefer matching by title + exact date
        if (intent.scope === 'single' && intent.target_date) {
          matchedTask = userTasks.find(t =>
            normalizeDateString(t.date) === intent.target_date && (
              t.title.toLowerCase() === search ||
              t.title.toLowerCase().includes(search) ||
              search.includes(t.title.toLowerCase())
            )
          );
        }

        // Fallback: match by title only
        if (!matchedTask) {
          matchedTask = userTasks.find(t => t.title.toLowerCase() === search)
            || userTasks.find(t => t.title.toLowerCase().includes(search))
            || userTasks.find(t => search.includes(t.title.toLowerCase()));
        }
      }

      const permissionDeniedResponse = (intentName, task, actionVerb) => ({
        intent: intentName,
        success: false,
        permission_denied: true,
        task: task ? { id: task.id, title: task.title } : null,
        message: buildPermissionDeniedMessage(task?.title || intent.task_title || 'diese Aufgabe', actionVerb),
      });

      // === DELETE ===
      if (intent.intent === 'delete') {
        if (!matchedTask) {
          return res.json({
            intent: 'delete',
            success: false,
            message: `Aufgabe "${intent.task_title}" nicht gefunden. Hast du den Namen richtig geschrieben?`,
          });
        }

        if (!matchedTask.can_edit) {
          return res.json(permissionDeniedResponse('delete', matchedTask, 'loeschen'));
        }

        // Delete the task and all recurring children
        await pool.query('DELETE FROM tasks WHERE id = $1 OR recurrence_parent_id = $1', [matchedTask.id]);

        return res.json({
          intent: 'delete',
          success: true,
          deleted_task: { id: matchedTask.id, title: matchedTask.title },
          message: `"${matchedTask.title}" wurde gelöscht`,
        });
      }

      // === MOVE ===
      if (intent.intent === 'move') {
        if (!matchedTask) {
          return res.json({
            intent: 'move',
            success: false,
            message: `Aufgabe "${intent.task_title}" nicht gefunden.`,
          });
        }

        if (!matchedTask.can_edit) {
          return res.json(permissionDeniedResponse('move', matchedTask, 'verschieben'));
        }

        const updates = {};
        if (intent.new_date) updates.date = intent.new_date;
        if (intent.new_time) updates.time = intent.new_time;

        if (Object.keys(updates).length === 0) {
          return res.json({
            intent: 'move',
            success: false,
            message: 'Kein neues Datum oder neue Uhrzeit erkannt. Wohin soll verschoben werden?',
          });
        }

        // Update reminder_at if task has one
        const { rows: [fullTask] } = await pool.query('SELECT reminder_at FROM tasks WHERE id = $1', [matchedTask.id]);
        if (fullTask?.reminder_at) {
          const newDate = updates.date || matchedTask.date;
          const newTime = updates.time || matchedTask.time || '09:00';
          if (newDate) {
            updates.reminder_at = new Date(`${newDate}T${newTime}:00`).toISOString();
          }
        }

        const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`);
        const values = Object.values(updates);

        // scope=all → update all occurrences (parent + children)
        if (intent.scope === 'all') {
          const parentId = matchedTask.recurrence_parent_id || matchedTask.id;

          if (collabEnabled) {
            const permissionScope = await pool.query(
              `SELECT COUNT(*)::int AS total_count,
                      COUNT(*) FILTER (
                        WHERE t.user_id = $2
                          OR EXISTS (
                            SELECT 1 FROM task_permissions tp
                            WHERE tp.task_id = t.id AND tp.user_id = $2 AND tp.can_edit = true
                          )
                      )::int AS editable_count
               FROM tasks t
               WHERE t.id = $1 OR t.recurrence_parent_id = $1`,
              [parentId, user.id]
            );
            const scopeRow = permissionScope.rows[0] || { total_count: 0, editable_count: 0 };
            if (scopeRow.total_count > 0 && scopeRow.editable_count < scopeRow.total_count) {
              return res.json(permissionDeniedResponse('move', matchedTask, 'alle Wiederholungen verschieben'));
            }
          }

          await pool.query(
            `UPDATE tasks SET ${setClauses.join(', ')}, updated_at = NOW() WHERE (id = $1 OR recurrence_parent_id = $1)`,
            [parentId, ...values]
          );
          const updatedCount = await pool.query(
            'SELECT COUNT(*) FROM tasks WHERE id = $1 OR recurrence_parent_id = $1',
            [parentId]
          );
          return res.json({
            intent: 'move',
            success: true,
            task: { id: matchedTask.id, title: matchedTask.title, ...updates },
            scope: 'all',
            updated_count: parseInt(updatedCount.rows[0].count),
            message: `Alle Termine "${matchedTask.title}" aktualisiert${updates.date ? ` auf ${updates.date}` : ''}${updates.time ? ` um ${updates.time}` : ''}`,
          });
        }

        // scope=single (default) → nur diesen einen Termin
        await pool.query(
          `UPDATE tasks SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $1`,
          [matchedTask.id, ...values]
        );

        return res.json({
          intent: 'move',
          success: true,
          task: { id: matchedTask.id, title: matchedTask.title, ...updates },
          scope: 'single',
          message: `"${matchedTask.title}" verschoben${updates.date ? ` auf ${updates.date}` : ''}${updates.time ? ` um ${updates.time}` : ''}`,
        });
      }

      // === UPDATE ===
      if (intent.intent === 'update') {
        if (!matchedTask) {
          return res.json({
            intent: 'update',
            success: false,
            message: `Aufgabe "${intent.task_title}" nicht gefunden.`,
          });
        }

        if (!matchedTask.can_edit) {
          return res.json(permissionDeniedResponse('update', matchedTask, 'aendern'));
        }

        const allowed = ['title', 'description', 'priority', 'date', 'time', 'time_end', 'date_end', 'recurrence_rule', 'recurrence_interval', 'recurrence_end'];
        const updates = {};
        if (intent.updates && typeof intent.updates === 'object') {
          for (const [k, v] of Object.entries(intent.updates)) {
            if (allowed.includes(k) && v != null) updates[k] = v;
          }
        }

        if (Object.keys(updates).length === 0) {
          return res.json({
            intent: 'update',
            success: false,
            message: 'Keine Änderungen erkannt.',
          });
        }

        const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`);
        const values = Object.values(updates);

        // === SPECIAL: Nachträglich wiederkehrend machen ===
        // Wenn recurrence_rule gesetzt wird und der Task noch KEINE Kinder hat → Folge-Einträge erstellen
        if (updates.recurrence_rule && matchedTask.date) {
          // Task hatte vorher keine Wiederholung → recurrence_parent_id ist null
          const hasChildren = await pool.query(
            'SELECT COUNT(*) FROM tasks WHERE recurrence_parent_id = $1',
            [matchedTask.id]
          );
          const childCount = parseInt(hasChildren.rows[0].count);

          // Update den bestehenden Task (wird Parent)
          await pool.query(
            `UPDATE tasks SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $1`,
            [matchedTask.id, ...values]
          );

          // Nur neue Kinder erstellen wenn noch keine existieren
          if (childCount === 0) {
            const rule = updates.recurrence_rule;
            const interval = Math.max(1, Number(updates.recurrence_interval) || 1);
            // Enddatum: toDateOnly() damit Date-Objekte von PostgreSQL korrekt verarbeitet werden
            const baseDate = toDateOnly(matchedTask.date);
            if (!baseDate) {
              return res.json({ intent: 'update', success: false, message: 'Termindatum ungültig.' });
            }
            const endFallback = new Date(baseDate.getTime());
            endFallback.setFullYear(endFallback.getFullYear() + 5);
            const recEnd = updates.recurrence_end || formatDateOnly(endFallback);
            const startDateStr = formatDateOnly(baseDate);

            const extraDates = buildRecurringDates(startDateStr, rule, interval, recEnd);
            let createdCount = 0;

            for (let i = 0; i < extraDates.length; i++) {
              const oDate = extraDates[i];
              await pool.query(
                `INSERT INTO tasks (user_id, title, description, date, time, time_end, priority, category_id, sort_order, visibility,
                 recurrence_rule, recurrence_interval, recurrence_end, recurrence_parent_id, type)
                 SELECT user_id, title, description, $2, time, time_end, priority, category_id, sort_order + $3, visibility,
                 $4, $5, $6, $1, type FROM tasks WHERE id = $1`,
                [matchedTask.id, oDate, i + 1, rule, interval, recEnd]
              );
              createdCount++;
            }

            return res.json({
              intent: 'update',
              success: true,
              task: { id: matchedTask.id, title: matchedTask.title, ...updates },
              scope: 'all',
              updated_count: createdCount + 1,
              message: `"${matchedTask.title}" ist jetzt wiederkehrend (${rule}) – ${createdCount + 1} Termine insgesamt`,
            });
          }
        }

        // scope=all → update all occurrences (parent + children)
        if (intent.scope === 'all') {
          const parentId = matchedTask.recurrence_parent_id || matchedTask.id;

          if (collabEnabled) {
            const permissionScope = await pool.query(
              `SELECT COUNT(*)::int AS total_count,
                      COUNT(*) FILTER (
                        WHERE t.user_id = $2
                          OR EXISTS (
                            SELECT 1 FROM task_permissions tp
                            WHERE tp.task_id = t.id AND tp.user_id = $2 AND tp.can_edit = true
                          )
                      )::int AS editable_count
               FROM tasks t
               WHERE t.id = $1 OR t.recurrence_parent_id = $1`,
              [parentId, user.id]
            );
            const scopeRow = permissionScope.rows[0] || { total_count: 0, editable_count: 0 };
            if (scopeRow.total_count > 0 && scopeRow.editable_count < scopeRow.total_count) {
              return res.json(permissionDeniedResponse('update', matchedTask, 'alle Wiederholungen aendern'));
            }
          }

          await pool.query(
            `UPDATE tasks SET ${setClauses.join(', ')}, updated_at = NOW() WHERE (id = $1 OR recurrence_parent_id = $1)`,
            [parentId, ...values]
          );
          const updatedCount = await pool.query(
            'SELECT COUNT(*) FROM tasks WHERE id = $1 OR recurrence_parent_id = $1',
            [parentId]
          );
          return res.json({
            intent: 'update',
            success: true,
            task: { id: matchedTask.id, title: matchedTask.title, ...updates },
            scope: 'all',
            updated_count: parseInt(updatedCount.rows[0].count),
            message: `Alle Termine "${matchedTask.title}" wurden aktualisiert`,
          });
        }

        // scope=single (default) → nur diesen einen Termin
        await pool.query(
          `UPDATE tasks SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $1`,
          [matchedTask.id, ...values]
        );

        return res.json({
          intent: 'update',
          success: true,
          task: { id: matchedTask.id, title: matchedTask.title, ...updates },
          scope: 'single',
          message: `"${matchedTask.title}" wurde aktualisiert`,
        });
      }

      // === ATTACH ===
      if (intent.intent === 'attach') {
        if (!matchedTask) {
          return res.json({
            intent: 'attach',
            success: false,
            message: `Aufgabe "${intent.task_title}" nicht gefunden.`,
          });
        }

        if (!matchedTask.can_edit) {
          return res.json(permissionDeniedResponse('attach', matchedTask, 'Dateien anhaengen'));
        }

        return res.json({
          intent: 'attach',
          success: true,
          task: { id: matchedTask.id, title: matchedTask.title },
          message: `Wähle eine Datei für "${matchedTask.title}"`,
        });
      }

      // Fallback
      return res.json({ intent: 'create', redirect: true });

    } catch (err) {
      console.error('AI smart error:', err);
      return res.status(500).json({ error: 'KI-Aktion fehlgeschlagen' });
    }
  }

  return res.status(404).json({ error: 'Route nicht gefunden' });
};
