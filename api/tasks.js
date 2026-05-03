const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');
const { cacheManager } = require('./_lib/cache');
const { sendPushToUser } = require('./_lib/pushService');

const REMINDER_GRACE_WINDOW = '6 hours';
const EVENT_REMINDER_OFFSET = '5 hours';
const EVENT_DEFAULT_START_TIME = '12:00';
function resolveAppTimeZone(value) {
  const fallback = 'Europe/Berlin';
  const candidate = String(value || fallback).trim();
  try {
    new Intl.DateTimeFormat('de-DE', { timeZone: candidate });
    return candidate;
  } catch {
    return fallback;
  }
}

const APP_TIME_ZONE = resolveAppTimeZone(process.env.APP_TIME_ZONE);
// Keep local wall-clock semantics (DST-safe): convert local date+time to timestamptz first, then subtract offset.
const EVENT_DUE_AT_SQL = `(((t.date::date + COALESCE(t.time, TIME '${EVENT_DEFAULT_START_TIME}'))::timestamp AT TIME ZONE '${APP_TIME_ZONE}') - INTERVAL '${EVENT_REMINDER_OFFSET}')`;

function formatReminderDateForLog(value) {
  const reminderDate = new Date(value);
  if (Number.isNaN(reminderDate.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: APP_TIME_ZONE,
  }).format(reminderDate);
}

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
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const iso = value.toISOString().split('T')[0];
    return new Date(iso + 'T00:00:00');
  }
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

// ─── Virtual Recurrence ────────────────────────────────────────────────────
// Instead of storing hundreds of DB rows, we store only the template and
// generate virtual occurrences on-the-fly within a requested date window.
// A concrete row is created only when an occurrence is explicitly modified
// (completed, edited, deleted). Virtual IDs use format: "v_{parentId}_{date}"

function expandRecurringTemplate(template, rangeStart, rangeEnd) {
  if (!template || !template.recurrence_rule || !template.date) return [];

  try {
    const templateDate = typeof template.date === 'string'
      ? template.date.substring(0, 10)
      : template.date.toISOString?.()?.split('T')[0] || null;

    if (!templateDate) return [];

    const effectiveEnd = template.recurrence_end
      ? (template.recurrence_end < rangeEnd ? template.recurrence_end : rangeEnd)
      : rangeEnd;

    if (templateDate > rangeEnd || effectiveEnd < rangeStart) return [];

    // Start from the first virtual occurrence (one step after template date)
    let cursor = calcNextDate(templateDate, template.recurrence_rule, template.recurrence_interval || 1);
    if (!cursor) return [];

    // Fast-forward to first occurrence within range (max 10000 steps safety)
    let guard = 0;
    while (cursor < rangeStart && guard < 10000) {
      const next = calcNextDate(cursor, template.recurrence_rule, template.recurrence_interval || 1);
      if (!next || next <= cursor) break;
      cursor = next;
      guard++;
    }

    // Calculate multi-day span offset
    // Safely convert date_end to string (may be Date object, string, or null from DB)
    const dateEndSafe = template.date_end
      ? (typeof template.date_end === 'string'
          ? template.date_end.substring(0, 10)
          : template.date_end instanceof Date
            ? template.date_end.toISOString().split('T')[0]
            : String(template.date_end).split('T')[0])
      : null;
    const spanDays = (dateEndSafe && templateDate)
      ? Math.max(0, Math.round(
          (new Date(dateEndSafe + 'T00:00:00') -
           new Date(templateDate + 'T00:00:00')) / 86400000
        ))
      : 0;

    // Collect occurrences within [rangeStart, effectiveEnd]
    const result = [];
    guard = 0;
    while (cursor && cursor <= effectiveEnd && guard < 1000) {
      if (cursor >= rangeStart) {
        result.push({
          ...template,
          id: `v_${template.id}_${cursor}`,
          date: cursor,
          date_end: spanDays > 0 ? shiftDate(cursor, spanDays) : null,
          completed: false,
          is_virtual: true,
          recurrence_parent_id: template.id,
        });
      }
      const next = calcNextDate(cursor, template.recurrence_rule, template.recurrence_interval || 1);
      if (!next || next <= cursor) break;
      cursor = next;
      guard++;
    }

    return result;
  } catch (err) {
    console.error(`Error in expandRecurringTemplate for template ${template?.id}:`, err.message);
    return [];
  }
}

// Parse virtual ID → { parentId, date } or null
function parseVirtualId(id) {
  if (typeof id !== 'string' || !id.startsWith('v_')) return null;
  const parts = id.split('_');
  if (parts.length < 3) return null;
  const date = parts[parts.length - 1];
  const parentId = parts.slice(1, -1).join('_');
  if (!parentId || !date.match(/^\d{4}-\d{2}-\d{2}$/)) return null;
  return { parentId, date };
}

async function inheritTaskRelations(pool, parentId, concreteTaskId) {
  await pool.query(
    `INSERT INTO task_permissions (task_id, user_id, can_view, can_edit)
     SELECT $2, tp.user_id, tp.can_view, tp.can_edit
       FROM task_permissions tp
      WHERE tp.task_id = $1
     ON CONFLICT (task_id, user_id)
     DO UPDATE SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit`,
    [parentId, concreteTaskId]
  );

  await pool.query(
    `INSERT INTO group_tasks (group_id, task_id, created_by)
     SELECT gt.group_id, $2, gt.created_by
       FROM group_tasks gt
      WHERE gt.task_id = $1
     ON CONFLICT DO NOTHING`,
    [parentId, concreteTaskId]
  );
}

// Materialize a virtual occurrence into a concrete DB row.
// Returns the concrete task row.
async function materializeOccurrence(pool, parentId, date, userId) {
  // Return existing concrete row if already materialized
  const existing = await pool.query(
    `SELECT * FROM tasks WHERE recurrence_parent_id = $1 AND date::text LIKE $2 AND user_id = $3 LIMIT 1`,
    [parentId, date + '%', userId]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  // Fetch parent template
  const parent = await pool.query(
    `SELECT * FROM tasks WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [parentId, userId]
  );
  if (parent.rows.length === 0) throw new Error('Vorlage nicht gefunden');
  const t = parent.rows[0];

  const templateDate = t.date instanceof Date
    ? t.date.toISOString().split('T')[0]
    : String(t.date).substring(0, 10);

  const spanDays = t.date_end
    ? Math.max(0, Math.round(
        (new Date(toIsoDateStr(t.date_end) + 'T00:00:00') -
         new Date(templateDate + 'T00:00:00')) / 86400000
      ))
    : 0;
  const dateEnd = spanDays > 0 ? shiftDate(date, spanDays) : null;

  const maxOrder = await pool.query(
    'SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM tasks WHERE user_id = $1',
    [userId]
  );

  const ins = await pool.query(
    `INSERT INTO tasks
       (user_id, title, description, date, date_end, time, time_end, priority,
        category_id, reminder_at, sort_order, visibility, type,
        recurrence_rule, recurrence_interval, recurrence_end, recurrence_parent_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [t.user_id, t.title, t.description, date, dateEnd, t.time, t.time_end,
     t.priority, t.category_id, null,
     maxOrder.rows[0].next_order, t.visibility || 'private', t.type || 'task',
     t.recurrence_rule, t.recurrence_interval || 1, t.recurrence_end, parentId]
  );

  // If ON CONFLICT hit, fetch the row
  if (ins.rows.length === 0) {
    const retry = await pool.query(
      `SELECT * FROM tasks WHERE recurrence_parent_id = $1 AND date::text LIKE $2 AND user_id = $3 LIMIT 1`,
      [parentId, date + '%', userId]
    );
    if (retry.rows[0]?.id) {
      await inheritTaskRelations(pool, parentId, retry.rows[0].id);
    }
    return retry.rows[0];
  }
  await inheritTaskRelations(pool, parentId, ins.rows[0].id);
  return ins.rows[0];
}

// Merge concrete tasks + virtual expansions, deduplicating by parent+date
function toIsoDateStr(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().substring(0, 10);
  return String(value).substring(0, 10);
}

function mergeWithVirtual(concreteTasks, templates, rangeStart, rangeEnd) {
  if (!Array.isArray(concreteTasks)) concreteTasks = [];
  if (!Array.isArray(templates)) templates = [];
  
  // Set of (parentId:date) already covered by concrete rows
  const concreteKeys = new Set();
  
  for (const t of concreteTasks) {
    if (t && t.recurrence_parent_id) {
      const dateStr = toIsoDateStr(t.date) || 'null';
      concreteKeys.add(`${t.recurrence_parent_id}:${dateStr}`);
    }
  }
  
  // Also exclude the template's own date (it's a concrete row)
  for (const tpl of templates) {
    if (tpl && tpl.id && tpl.date) {
      const dateStr = toIsoDateStr(tpl.date);
      concreteKeys.add(`${tpl.id}:${dateStr}`);
    }
  }

  const virtual = [];
  for (const tpl of templates) {
    if (!tpl || !tpl.recurrence_rule) continue;
    try {
      const occurrences = expandRecurringTemplate(tpl, rangeStart, rangeEnd);
      for (const occ of occurrences) {
        if (!occ) continue;
        const key = `${tpl.id}:${occ.date}`;
        if (!concreteKeys.has(key)) {
          virtual.push(occ);
          concreteKeys.add(key);
        }
      }
    } catch (err) {
      console.error(`Error expanding template ${tpl.id}:`, err.message);
    }
  }

  return [...concreteTasks, ...virtual].sort((a, b) => {
    const da = toIsoDateStr(a && a.date ? a.date : '') || '';
    const db = toIsoDateStr(b && b.date ? b.date : '') || '';
    return da < db ? -1 : da > db ? 1 : 0;
  });
}

function normalizeTaskRow(row) {
  if (!row || typeof row !== 'object') return row;

  const attachmentCount = Number(row.attachment_count);

  return {
    ...row,
    teams_join_url: row.teams_join_url || null,
    teams_meeting_id: row.teams_meeting_id || null,
    shared_with_users: Array.isArray(row.shared_with_users) ? row.shared_with_users : [],
    attachment_count: Number.isFinite(attachmentCount) ? attachmentCount : 0,
    creator_name: row.creator_name || null,
    creator_color: row.creator_color || null,
    creator_avatar_url: row.creator_avatar_url || null,
    last_editor_name: row.last_editor_name || null,
    group_id: row.group_id || null,
    group_name: row.group_name || null,
    group_color: row.group_color || null,
    group_image_url: row.group_image_url || null,
    group_category_id: row.group_category_id || null,
    group_category_name: row.group_category_name || null,
    group_category_color: row.group_category_color || null,
    group_task_creator_name: row.group_task_creator_name || null,
    group_task_creator_color: row.group_task_creator_color || null,
    group_task_creator_avatar_url: row.group_task_creator_avatar_url || null,
    enable_group_rsvp: row.enable_group_rsvp === true,
    is_owner: row.is_owner === undefined || row.is_owner === null ? true : row.is_owner === true,
    can_edit: row.can_edit === undefined || row.can_edit === null ? true : row.can_edit === true,
  };
}

function normalizeTaskRows(rows) {
  return Array.isArray(rows) ? rows.map(normalizeTaskRow) : [];
}

function buildDashboardCacheKey(userId, completedFilter, limit, horizonDays, completedLookbackDays) {
  const completedScope = completedFilter === null ? 'all' : String(completedFilter);
  return `dashboard:user:${userId}:${completedScope}:${limit}:h${horizonDays}:c${completedLookbackDays}`;
}

function buildDashboardOrderByClause() {
  return `ORDER BY
             CASE WHEN t.date IS NULL THEN 1 ELSE 0 END ASC,
             t.date ASC NULLS LAST,
             t.time ASC NULLS LAST,
             t.sort_order ASC,
             t.created_at DESC`;
}

function parseVirtualTaskId(rawId) {
  if (typeof rawId !== 'string' || !rawId.startsWith('v_')) return null;
  const parts = rawId.split('_');
  if (parts.length < 3) return null;
  const date = parts[parts.length - 1];
  const parentId = parts.slice(1, -1).join('_');
  if (!parentId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { parentId: Number(parentId), date };
}

function getVoteKey(taskId, occurrenceDate) {
  return `${taskId}|${occurrenceDate || ''}`;
}

function getTaskVoteContext(task) {
  const virtual = parseVirtualTaskId(task?.id);
  if (virtual) {
    return {
      baseTaskId: virtual.parentId,
      occurrenceDate: virtual.date,
    };
  }

  if (task?.recurrence_parent_id) {
    return {
      baseTaskId: Number(task.recurrence_parent_id),
      occurrenceDate: toIsoDateStr(task.date),
    };
  }

  if (task?.recurrence_rule) {
    return {
      baseTaskId: Number(task.id),
      occurrenceDate: toIsoDateStr(task.date),
    };
  }

  return {
    baseTaskId: Number(task?.id),
    occurrenceDate: null,
  };
}

async function enrichTaskVoteStats(pool, tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return tasks;

  const eligible = tasks.filter((t) => t && t.group_id && t.enable_group_rsvp === true);
  if (eligible.length === 0) {
    return tasks.map((t) => ({
      ...t,
      vote_yes_count: Number(t?.vote_yes_count || 0),
      vote_no_count: Number(t?.vote_no_count || 0),
      vote_unanswered_count: Number(t?.vote_unanswered_count || 0),
      vote_member_count: Number(t?.vote_member_count || 0),
    }));
  }

  const contextByTaskId = new Map();
  const baseTaskIdsSet = new Set();
  for (const task of eligible) {
    const ctx = getTaskVoteContext(task);
    if (!ctx.baseTaskId || Number.isNaN(ctx.baseTaskId)) continue;
    contextByTaskId.set(String(task.id), ctx);
    baseTaskIdsSet.add(ctx.baseTaskId);
  }

  const baseTaskIds = Array.from(baseTaskIdsSet);
  if (baseTaskIds.length === 0) return tasks;

  const memberCountsRes = await pool.query(
    `SELECT gt.task_id, COUNT(DISTINCT gm.user_id)::int AS member_count
     FROM group_tasks gt
     JOIN group_members gm ON gm.group_id = gt.group_id
     WHERE gt.task_id = ANY($1::int[])
     GROUP BY gt.task_id`,
    [baseTaskIds]
  );

  const memberCountByTaskId = new Map();
  for (const row of memberCountsRes.rows || []) {
    memberCountByTaskId.set(Number(row.task_id), Number(row.member_count || 0));
  }

  const voteStatsRes = await pool.query(
    `SELECT task_id,
            occurrence_date,
            COUNT(*) FILTER (WHERE status = 'yes')::int AS yes_count,
            COUNT(*) FILTER (WHERE status = 'no')::int AS no_count
     FROM task_votes
     WHERE task_id = ANY($1::int[])
     GROUP BY task_id, occurrence_date`,
    [baseTaskIds]
  );

  const voteByKey = new Map();
  for (const row of voteStatsRes.rows || []) {
    const key = getVoteKey(Number(row.task_id), row.occurrence_date ? toIsoDateStr(row.occurrence_date) : null);
    voteByKey.set(key, {
      yes: Number(row.yes_count || 0),
      no: Number(row.no_count || 0),
    });
  }

  return tasks.map((task) => {
    if (!task || !(task.group_id && task.enable_group_rsvp === true)) {
      return {
        ...task,
        vote_yes_count: Number(task?.vote_yes_count || 0),
        vote_no_count: Number(task?.vote_no_count || 0),
        vote_unanswered_count: Number(task?.vote_unanswered_count || 0),
        vote_member_count: Number(task?.vote_member_count || 0),
      };
    }

    const ctx = contextByTaskId.get(String(task.id)) || getTaskVoteContext(task);
    const key = getVoteKey(ctx.baseTaskId, ctx.occurrenceDate);
    const stat = voteByKey.get(key) || { yes: 0, no: 0 };
    const memberCount = Number(memberCountByTaskId.get(ctx.baseTaskId) || 0);
    const unanswered = Math.max(0, memberCount - stat.yes - stat.no);

    return {
      ...task,
      vote_yes_count: stat.yes,
      vote_no_count: stat.no,
      vote_unanswered_count: unanswered,
      vote_member_count: memberCount,
    };
  });
}

let collabEnabledCache = null;
let collabEnabledCacheAt = 0;
const COLLAB_CACHE_TTL_MS = 5 * 60 * 1000;

async function getCollabEnabled(pool) {
  const now = Date.now();
  if (collabEnabledCache !== null && (now - collabEnabledCacheAt) < COLLAB_CACHE_TTL_MS) {
    return collabEnabledCache;
  }

  const hasCollab = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'visibility') as has_visibility`
  );
  collabEnabledCache = hasCollab.rows[0]?.has_visibility === true;
  collabEnabledCacheAt = now;
  return collabEnabledCache;
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

      const collabEnabled = await getCollabEnabled(pool);

      // 1. Fetch all concrete rows in [start, end] (includes templates + any materialized overrides)
      let concreteResult;
      try {
        if (collabEnabled) {
          concreteResult = await pool.query(
            `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon,
               u.name as creator_name, u.avatar_color as creator_color, u.avatar_url as creator_avatar_url,
               NULL::text as last_editor_name,
               CASE WHEN t.user_id = $1 THEN true ELSE false END as is_owner,
               CASE
                 WHEN t.user_id = $1 THEN true
                 ELSE EXISTS (
                   SELECT 1 FROM task_permissions tp_edit
                   WHERE tp_edit.task_id = t.id AND tp_edit.user_id = $1 AND tp_edit.can_edit = true
                 )
               END as can_edit,
               gt.group_id, grp.name as group_name, grp.color as group_color, grp.image_url as group_image_url,
               gc.id as group_category_id, gc.name as group_category_name, gc.color as group_category_color,
               gtc.name as group_task_creator_name, gtc.avatar_color as group_task_creator_color,
               gtc.avatar_url as group_task_creator_avatar_url,
               COALESCE((
                 SELECT json_agg(
                   json_build_object('name', su.name, 'color', su.avatar_color, 'avatar_url', su.avatar_url)
                   ORDER BY su.name
                 )
                 FROM task_permissions tp2
                 JOIN users su ON su.id = tp2.user_id
                 WHERE tp2.task_id = t.id AND tp2.can_view = true
               ), '[]'::json) as shared_with_users
             FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
             LEFT JOIN users u ON u.id = t.user_id
             LEFT JOIN task_permissions tp ON tp.task_id = t.id AND tp.user_id = $1
             LEFT JOIN group_tasks gt ON gt.task_id = t.id
             LEFT JOIN groups grp ON grp.id = gt.group_id
             LEFT JOIN group_categories gc ON gc.id = gt.group_category_id
             LEFT JOIN users gtc ON gtc.id = gt.created_by
             WHERE (
               t.user_id = $1
               OR (t.visibility = 'shared' AND EXISTS (
                 SELECT 1 FROM friends f WHERE f.status = 'accepted'
                 AND ((f.user_id = t.user_id AND f.friend_id = $1) OR (f.user_id = $1 AND f.friend_id = t.user_id))
               ))
               OR (t.visibility = 'selected_users' AND tp.can_view = true)
               OR EXISTS (SELECT 1 FROM group_tasks gt2 JOIN group_members gm ON gm.group_id = gt2.group_id WHERE gt2.task_id = t.id AND gm.user_id = $1)
             ) AND (
               (t.date >= $2 AND t.date <= $3)
               OR (t.date_end IS NOT NULL AND t.date <= $3 AND t.date_end >= $2)
             )
             ORDER BY t.date ASC, t.sort_order ASC`,
            [user.id, start, end]
          );
        } else {
          concreteResult = await pool.query(
            `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon,
               gt.group_id, grp.name as group_name, grp.color as group_color, grp.image_url as group_image_url,
               gc.id as group_category_id, gc.name as group_category_name, gc.color as group_category_color,
               gtc.name as group_task_creator_name, gtc.avatar_color as group_task_creator_color
             FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
             LEFT JOIN group_tasks gt ON gt.task_id = t.id
           LEFT JOIN groups grp ON grp.id = gt.group_id
           LEFT JOIN group_categories gc ON gc.id = gt.group_category_id
           LEFT JOIN users gtc ON gtc.id = gt.created_by
           WHERE (t.user_id = $1
             OR EXISTS (SELECT 1 FROM group_tasks gt2 JOIN group_members gm ON gm.group_id = gt2.group_id WHERE gt2.task_id = t.id AND gm.user_id = $1))
             AND (
               (t.date >= $2 AND t.date <= $3)
               OR (t.date_end IS NOT NULL AND t.date <= $3 AND t.date_end >= $2)
             )
           ORDER BY t.date ASC, t.sort_order ASC`,
            [user.id, start, end]
          );
        }
      } catch (schemaError) {
        console.warn('[TASKS-RANGE] Schema error, falling back to basic query:', schemaError.message);
        // SAFE FALLBACK: Basic query only using core tables
        concreteResult = await pool.query(
          `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
           FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
           WHERE t.user_id = $1 AND (
             (t.date >= $2 AND t.date <= $3)
             OR (t.date_end IS NOT NULL AND t.date <= $3 AND t.date_end >= $2)
           )
           ORDER BY t.date ASC, COALESCE(t.sort_order, 0) ASC`,
          [user.id, start, end]
        );
      }

      // 2. Fetch all recurring templates (recurrence_rule set, no parent = they ARE the template)
      //    that are active during the range window
      let templateResult;
      try {
        if (collabEnabled) {
          templateResult = await pool.query(
            `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon,
               u.name as creator_name, u.avatar_color as creator_color, u.avatar_url as creator_avatar_url,
               NULL::text as last_editor_name,
               CASE WHEN t.user_id = $1 THEN true ELSE false END as is_owner,
               CASE
                 WHEN t.user_id = $1 THEN true
                 ELSE EXISTS (
                   SELECT 1 FROM task_permissions tp_edit
                   WHERE tp_edit.task_id = t.id AND tp_edit.user_id = $1 AND tp_edit.can_edit = true
                 )
               END as can_edit,
               gt.group_id, grp.name as group_name, grp.color as group_color, grp.image_url as group_image_url,
               gc.id as group_category_id, gc.name as group_category_name, gc.color as group_category_color,
               gtc.name as group_task_creator_name, gtc.avatar_color as group_task_creator_color,
               gtc.avatar_url as group_task_creator_avatar_url,
               COALESCE((
                 SELECT json_agg(
                   json_build_object('name', su.name, 'color', su.avatar_color, 'avatar_url', su.avatar_url)
                   ORDER BY su.name
                 )
                 FROM task_permissions tp2
                 JOIN users su ON su.id = tp2.user_id
                 WHERE tp2.task_id = t.id AND tp2.can_view = true
               ), '[]'::json) as shared_with_users
             FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
             LEFT JOIN users u ON u.id = t.user_id
             LEFT JOIN task_permissions tp ON tp.task_id = t.id AND tp.user_id = $1
             LEFT JOIN group_tasks gt ON gt.task_id = t.id
             LEFT JOIN groups grp ON grp.id = gt.group_id
             LEFT JOIN group_categories gc ON gc.id = gt.group_category_id
             LEFT JOIN users gtc ON gtc.id = gt.created_by
             WHERE (
               t.user_id = $1
               OR (t.visibility = 'shared' AND EXISTS (
                 SELECT 1 FROM friends f WHERE f.status = 'accepted'
                 AND ((f.user_id = t.user_id AND f.friend_id = $1) OR (f.user_id = $1 AND f.friend_id = t.user_id))
               ))
               OR (t.visibility = 'selected_users' AND tp.can_view = true)
               OR EXISTS (SELECT 1 FROM group_tasks gt2 JOIN group_members gm ON gm.group_id = gt2.group_id WHERE gt2.task_id = t.id AND gm.user_id = $1)
             )
             AND t.recurrence_rule IS NOT NULL
             AND t.recurrence_parent_id IS NULL
             AND t.date <= $3
             AND (t.recurrence_end IS NULL OR t.recurrence_end >= $2)`,
            [user.id, start, end]
          );
        } else {
          templateResult = await pool.query(
            `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon,
               gt.group_id, grp.name as group_name, grp.color as group_color, grp.image_url as group_image_url,
               gc.id as group_category_id, gc.name as group_category_name, gc.color as group_category_color
             FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
             LEFT JOIN group_tasks gt ON gt.task_id = t.id
             LEFT JOIN groups grp ON grp.id = gt.group_id
             LEFT JOIN group_categories gc ON gc.id = gt.group_category_id
             WHERE (t.user_id = $1
               OR EXISTS (SELECT 1 FROM group_tasks gt2 JOIN group_members gm ON gm.group_id = gt2.group_id WHERE gt2.task_id = t.id AND gm.user_id = $1))
             AND t.recurrence_rule IS NOT NULL
             AND t.recurrence_parent_id IS NULL
             AND t.date <= $3
             AND (t.recurrence_end IS NULL OR t.recurrence_end >= $2)`,
            [user.id, start, end]
          );
        }
      } catch (templateError) {
        console.warn('[TASKS-RANGE] Template query failed, using basic fallback:', templateError.message);
        // SAFE FALLBACK: Basic recurring templates query
        templateResult = await pool.query(
          `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
           FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
           WHERE t.user_id = $1
           AND t.recurrence_rule IS NOT NULL
           AND (t.recurrence_parent_id IS NULL OR t.recurrence_parent_id = 0)
           AND t.date <= $3
           AND (t.recurrence_end IS NULL OR t.recurrence_end >= $2)`,
          [user.id, start, end]
        );
      }

      // 3. Merge concrete + virtual, deduplicating overrides
      const merged = normalizeTaskRows(mergeWithVirtual(
        concreteResult.rows || [],
        templateResult.rows || [],
        start,
        end
      ));

      return res.json({ tasks: merged });
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
      
      // 🚀 STUFE 3: Event-driven invalidation on task reorder
      await cacheManager.invalidateByEvent(String(user.id), 'task_updated');
      
      return res.json({ success: true });
    } catch (err) {
      console.error('Reorder error:', err);
      return res.status(500).json({ error: 'Fehler beim Sortieren' });
    }
  }

  // GET /api/tasks/reminders/due
  if (segments[0] === 'reminders' && segments[1] === 'due' && req.method === 'GET') {
    try {
      // Simplified query: Get all tasks accessible to user with due reminders
      let result;
      
      // Try with collaboration visibility first
      try {
        result = await pool.query(
          `SELECT t.id, t.user_id, t.title, t.time, t.reminder_at, t.completed,
                  CASE
                    WHEN t.type = 'event' AND t.date IS NOT NULL
                      THEN ${EVENT_DUE_AT_SQL}
                    ELSE t.reminder_at
                  END AS due_at,
                  c.name as category_name, c.color as category_color
           FROM tasks t
           LEFT JOIN categories c ON t.category_id = c.id
           WHERE t.completed = false
             AND (
               (
                 t.type = 'event'
                 AND t.date IS NOT NULL
                 AND ${EVENT_DUE_AT_SQL} <= NOW()
                 AND ${EVENT_DUE_AT_SQL} > NOW() - INTERVAL '${REMINDER_GRACE_WINDOW}'
               )
               OR
               (
                 (t.type IS DISTINCT FROM 'event')
                 AND t.reminder_at IS NOT NULL
                 AND t.reminder_at <= NOW()
                 AND t.reminder_at > NOW() - INTERVAL '${REMINDER_GRACE_WINDOW}'
               )
             )
             AND NOT EXISTS (
               SELECT 1
               FROM notification_log nl
               WHERE nl.user_id = $1
                 AND nl.task_id = t.id
                 AND nl.type IN ('reminder', 'reminder_seen')
             )
             AND (
               t.user_id = $1
               OR (t.visibility = 'shared' AND EXISTS (
                 SELECT 1 FROM friends f WHERE f.status = 'accepted'
                 AND ((f.user_id = t.user_id AND f.friend_id = $1) OR (f.user_id = $1 AND f.friend_id = t.user_id))
               ))
               OR (t.visibility = 'selected_users' AND EXISTS (
                 SELECT 1 FROM task_permissions tp WHERE tp.task_id = t.id AND tp.user_id = $1 AND tp.can_view = true
               ))
               OR EXISTS (
                 SELECT 1 FROM group_tasks gt JOIN group_members gm ON gm.group_id = gt.group_id 
                 WHERE gt.task_id = t.id AND gm.user_id = $1
               )
             )
           ORDER BY due_at ASC NULLS LAST`,
          [user.id]
        );
      } catch (err) {
        console.log('Full query failed, trying fallback:', err.message);
        // Fallback: just user's own tasks
        result = await pool.query(
          `SELECT t.id, t.user_id, t.title, t.time, t.reminder_at, t.completed,
                  CASE
                    WHEN t.type = 'event' AND t.date IS NOT NULL
                      THEN ${EVENT_DUE_AT_SQL}
                    ELSE t.reminder_at
                  END AS due_at,
                  c.name as category_name, c.color as category_color
           FROM tasks t
           LEFT JOIN categories c ON t.category_id = c.id
           WHERE t.user_id = $1
             AND t.completed = false
             AND (
               (
                 t.type = 'event'
                 AND t.date IS NOT NULL
                 AND ${EVENT_DUE_AT_SQL} <= NOW()
                 AND ${EVENT_DUE_AT_SQL} > NOW() - INTERVAL '${REMINDER_GRACE_WINDOW}'
               )
               OR
               (
                 (t.type IS DISTINCT FROM 'event')
                 AND t.reminder_at IS NOT NULL
                 AND t.reminder_at <= NOW()
                 AND t.reminder_at > NOW() - INTERVAL '${REMINDER_GRACE_WINDOW}'
               )
             )
             AND NOT EXISTS (
               SELECT 1
               FROM notification_log nl
               WHERE nl.user_id = $1
                 AND nl.task_id = t.id
                 AND nl.type IN ('reminder', 'reminder_seen')
             )
           ORDER BY due_at ASC NULLS LAST`,
          [user.id]
        );
      }

      console.log(`[reminders/due] Found ${result.rows.length} due reminders for user ${user.id}`);
      return res.json({ tasks: normalizeTaskRows(result.rows) });
    } catch (err) {
      console.error('Reminders error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden der Erinnerungen', details: err.message });
    }
  }

  // PATCH /api/tasks/:id/toggle
  if (segments.length === 2 && segments[1] === 'toggle' && req.method === 'PATCH') {
    try {
      let taskId = segments[0];

      // ── Virtual occurrence: materialize before toggling ──────────────────
      const virtual = parseVirtualId(taskId);
      if (virtual) {
        const concreteRow = await materializeOccurrence(pool, virtual.parentId, virtual.date, user.id);
        if (!concreteRow) {
          return res.status(404).json({ error: 'Vorlage nicht gefunden' });
        }
        taskId = String(concreteRow.id);
      }
      // ─────────────────────────────────────────────────────────────────────

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

      // Virtual recurrence: the next occurrence is always shown automatically
      // via virtual expansion — no chain-creation needed for recurring tasks.
      // We only cache-invalidate so the dashboard refreshes.
      await cacheManager.invalidateByEvent(String(user.id), 'task_updated');

      return res.json({ task: normalizeTaskRow(toggled), nextTask: null });
    } catch (err) {
      console.error('Toggle error:', err);
      return res.status(500).json({ error: 'Fehler beim Umschalten' });
    }
  }

  // GET /api/tasks/:id
  if (segments.length === 1 && segments[0] !== 'range' && segments[0] !== 'reorder' && segments[0] !== 'summary' && segments[0] !== 'dashboard' && req.method === 'GET') {
    try {
      const taskId = Number(segments[0]);
      if (!Number.isFinite(taskId)) return res.status(400).json({ error: 'Ungültige ID' });
      const { rows } = await pool.query(
        `SELECT t.*, c.name AS category_name, c.color AS category_color
         FROM tasks t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.id = $1 AND t.user_id = $2
         LIMIT 1`,
        [taskId, user.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Nicht gefunden' });
      return res.json(rows[0]);
    } catch (err) {
      console.error('Get task error:', err);
      return res.status(500).json({ error: 'Fehler' });
    }
  }

  // PUT /api/tasks/:id
  if (segments.length === 1 && segments[0] !== 'range' && segments[0] !== 'reorder' && req.method === 'PUT') {
    try {
      let taskId = segments[0];
      const { title, description, date, date_end, time, time_end, priority, category_id, reminder_at,
              recurrence_rule, recurrence_interval, recurrence_end, type, enable_group_rsvp } = req.body;
      const taskType = type === 'event' ? 'event' : (type === 'task' ? 'task' : undefined);
      
      console.log(`[API Update] User ${user.id} updating task ${taskId} with:`, {
        title, date, time, priority, category_id, reminder_at, type: taskType
      });

      const virtual = parseVirtualId(taskId);
      if (virtual) {
        const concreteRow = await materializeOccurrence(pool, virtual.parentId, virtual.date, user.id);
        if (!concreteRow) {
          return res.status(404).json({ error: 'Vorlage nicht gefunden' });
        }
        taskId = String(concreteRow.id);
      }

      // Only update fields that were explicitly sent in the request body.
      const hasTitle = Object.prototype.hasOwnProperty.call(req.body, 'title');
      const hasDescription = Object.prototype.hasOwnProperty.call(req.body, 'description');
      const hasDate = Object.prototype.hasOwnProperty.call(req.body, 'date');
      const hasDateEnd = Object.prototype.hasOwnProperty.call(req.body, 'date_end');
      const hasTime = Object.prototype.hasOwnProperty.call(req.body, 'time');
      const hasTimeEnd = Object.prototype.hasOwnProperty.call(req.body, 'time_end');
      const hasPriority = Object.prototype.hasOwnProperty.call(req.body, 'priority');
      const hasCategoryId = Object.prototype.hasOwnProperty.call(req.body, 'category_id');
      const hasReminderAt = Object.prototype.hasOwnProperty.call(req.body, 'reminder_at');
      const hasRecurrenceRule = Object.prototype.hasOwnProperty.call(req.body, 'recurrence_rule');
      const hasRecurrenceInterval = Object.prototype.hasOwnProperty.call(req.body, 'recurrence_interval');
      const hasRecurrenceEnd = Object.prototype.hasOwnProperty.call(req.body, 'recurrence_end');
      const hasType = Object.prototype.hasOwnProperty.call(req.body, 'type');
      const hasEnableGroupRsvp = Object.prototype.hasOwnProperty.call(req.body, 'enable_group_rsvp');

      const runUpdate = async () => {
        const setClauses = [];
        const values = [];
        const addSet = (clause, value) => {
          values.push(value);
          setClauses.push(`${clause} = $${values.length}`);
        };

        if (hasTitle) addSet('title', title);
        if (hasDescription) addSet('description', description);
        if (hasDate) addSet('date', date);
        if (hasDateEnd) addSet('date_end', date_end || null);
        if (hasTime) addSet('time', time);
        if (hasTimeEnd) addSet('time_end', time_end || null);
        if (hasPriority) addSet('priority', priority);
        if (hasCategoryId) addSet('category_id', category_id);
        if (hasReminderAt) addSet('reminder_at', reminder_at);
        if (hasRecurrenceRule) addSet('recurrence_rule', recurrence_rule || null);
        if (hasRecurrenceInterval) addSet('recurrence_interval', recurrence_interval || 1);
        if (hasRecurrenceEnd) addSet('recurrence_end', recurrence_end || null);
        if (hasType) addSet('type', taskType || null);
        if (hasEnableGroupRsvp) addSet('enable_group_rsvp', enable_group_rsvp === true);

        setClauses.push('updated_at = NOW()');
        values.push(user.id);
        setClauses.push(`last_edited_by = $${values.length}`);

        values.push(taskId);
        values.push(user.id);
        const whereTaskIdx = values.length - 1;
        const whereUserIdx = values.length;

        return pool.query(
          `UPDATE tasks SET
           ${setClauses.join(',\n         ')}
           WHERE id = $${whereTaskIdx} AND user_id = $${whereUserIdx}
           RETURNING *`,
          values
        );
      };

      const result = await runUpdate();
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
      }
      
      const updatedTask = result.rows[0];
      console.log(`[API Update] SUCCESS: Task ${taskId} updated. New state:`, {
        title: updatedTask.title,
        date: updatedTask.date,
        time: updatedTask.time,
        priority: updatedTask.priority,
        updated_at: updatedTask.updated_at
      });
      
      // 🚀 Invalidate caches after update so calendar/dashboard refresh
      console.log(`[API Update] Invalidating cache for user ${user.id} after updating task ${taskId}`);
      await cacheManager.invalidateByEvent(String(user.id), 'task_updated');
      
      return res.json({ task: normalizeTaskRow(updatedTask) });
    } catch (err) {
      console.error('Update error:', err);
      return res.status(500).json({ error: 'Fehler beim Aktualisieren' });
    }
  }

  // DELETE /api/tasks/:id
  if (segments.length === 1 && req.method === 'DELETE') {
    try {
      const rawId = segments[0];

      // Virtual occurrence: nothing to delete in DB — it's generated on-the-fly.
      // We could mark it as skipped in future, but for now simply return success.
      const virtual = parseVirtualId(rawId);
      if (virtual) {
        // Optionally we could insert a "cancelled" marker here in the future.
        return res.json({ success: true, virtual: true });
      }

      const taskId = rawId;
      const result = await pool.query(
        'DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id',
        [taskId, user.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
      }
      await cacheManager.invalidateByEvent(String(user.id), 'task_deleted');
      return res.json({ success: true });
    } catch (err) {
      console.error('Delete error:', err);
      return res.status(500).json({ error: 'Fehler beim Löschen' });
    }
  }

  // GET /api/tasks/summary
  if (segments[0] === 'summary' && req.method === 'GET') {
    try {
      const collabEnabled = await getCollabEnabled(pool);

      let result;
      if (collabEnabled) {
        result = await pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE t.completed = false AND t.type != 'event') as open_count,
             COUNT(*) FILTER (WHERE t.completed = true AND t.type != 'event') as completed_count,
             COUNT(*) FILTER (WHERE t.completed = false AND t.date = CURRENT_DATE AND t.type != 'event') as today_count,
             COUNT(*) FILTER (WHERE t.completed = false AND t.priority IN ('urgent', 'high') AND t.type != 'event') as urgent_count
           FROM tasks t
           LEFT JOIN task_permissions tp ON tp.task_id = t.id AND tp.user_id = $1
           WHERE (t.user_id = $1
             OR (t.visibility = 'shared' AND EXISTS (
               SELECT 1 FROM friends f WHERE f.status = 'accepted'
               AND ((f.user_id = t.user_id AND f.friend_id = $1) OR (f.user_id = $1 AND f.friend_id = t.user_id))
             ))
             OR (t.visibility = 'selected_users' AND tp.can_view = true)
             OR EXISTS (SELECT 1 FROM group_tasks gt2 JOIN group_members gm ON gm.group_id = gt2.group_id WHERE gt2.task_id = t.id AND gm.user_id = $1))
             AND t.type != 'event'`,
          [user.id]
        );
      } else {
        result = await pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE t.completed = false AND t.type != 'event') as open_count,
             COUNT(*) FILTER (WHERE t.completed = true AND t.type != 'event') as completed_count,
             COUNT(*) FILTER (WHERE t.completed = false AND t.date = CURRENT_DATE AND t.type != 'event') as today_count,
             COUNT(*) FILTER (WHERE t.completed = false AND t.priority IN ('urgent', 'high') AND t.type != 'event') as urgent_count
           FROM tasks t
           WHERE (t.user_id = $1
             OR EXISTS (SELECT 1 FROM group_tasks gt2 JOIN group_members gm ON gm.group_id = gt2.group_id WHERE gt2.task_id = t.id AND gm.user_id = $1))
             AND t.type != 'event'`,
          [user.id]
        );
      }

      const s = result.rows[0] || {};
      return res.json({
        open: parseInt(s.open_count || 0),
        completed: parseInt(s.completed_count || 0),
        today: parseInt(s.today_count || 0),
        urgent: parseInt(s.urgent_count || 0),
      });
    } catch (err) {
      console.error('Tasks summary error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden der Zusammenfassung' });
    }
  }

  // GET /api/tasks and GET /api/tasks/dashboard
  if ((segments.length === 0 || (segments.length === 1 && segments[0] === 'dashboard')) && req.method === 'GET') {
    try {
      const isDashboardEndpoint = segments[0] === 'dashboard';
      const lite = isDashboardEndpoint || String(req.query?.lite || 'false') === 'true';
      const completedRaw = req.query?.completed;
      const completedFilter = completedRaw === 'true' ? true : (completedRaw === 'false' ? false : null);
      const requestedLimit = parseInt(req.query?.limit, 10);
      const requestedHorizonDays = parseInt(req.query?.horizon_days, 10);
      const requestedCompletedLookbackDays = parseInt(req.query?.completed_lookback_days, 10);
      const defaultLimit = lite ? 300 : 180;
      const maxLimit = lite ? 1000 : 400;
      const horizonDays = Number.isFinite(requestedHorizonDays)
        ? Math.max(14, Math.min(365, requestedHorizonDays))
        : 56;
      const completedLookbackDays = Number.isFinite(requestedCompletedLookbackDays)
        ? Math.max(7, Math.min(365, requestedCompletedLookbackDays))
        : 30;
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(20, Math.min(maxLimit, requestedLimit))
        : defaultLimit;
      const dashboardOrderBy = buildDashboardOrderByClause();

      // 🚀 CACHE: Check dashboard cache first
      if (lite) {
        const cacheKey = buildDashboardCacheKey(user.id, completedFilter, limit, horizonDays, completedLookbackDays);
        const cached = await cacheManager.get(cacheKey);
        if (cached) {
          res.setHeader('X-Dashboard-Cache', `${cacheManager.backendName}-hit`);
          return res.json(cached);
        }
      }

      // Check if collaboration columns exist
      const collabEnabled = await getCollabEnabled(pool);

      let result;
      if (lite) {
        if (collabEnabled) {
          // Optimized dashboard query: UNION ALL + lightweight joins for critical metadata
          result = await pool.query(
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
             ),
             ranked_tasks AS (
               SELECT t.id, t.user_id, t.title, t.description, t.date, t.date_end, t.time, t.time_end,
                 t.priority, t.completed, t.type, t.sort_order, t.created_at, t.updated_at, t.visibility,
                 t.recurrence_rule, t.recurrence_parent_id, t.enable_group_rsvp,
                 t.teams_join_url, t.teams_meeting_id,
                      t.category_id,
                      CASE WHEN t.user_id = $1 THEN true ELSE false END AS is_owner,
                      CASE
                        WHEN t.user_id = $1 THEN true
                        ELSE EXISTS (
                          SELECT 1 FROM task_permissions tp
                          WHERE tp.task_id = t.id AND tp.user_id = $1 AND tp.can_edit = true
                        )
                      END AS can_edit
               FROM task_ids ids
               JOIN tasks t ON t.id = ids.id
               WHERE ($2::boolean IS NULL OR t.completed = $2)
                 AND (
                   t.date IS NULL
                   OR (COALESCE(t.completed, false) = true AND t.date >= CURRENT_DATE - ($5::int * INTERVAL '1 day'))
                   OR (COALESCE(t.completed, false) = false AND t.date >= CURRENT_DATE AND t.date <= CURRENT_DATE + ($4::int * INTERVAL '1 day'))
                 )
               ${dashboardOrderBy}
               LIMIT $3
             ),
             shared_users AS (
               SELECT tp2.task_id,
                      COALESCE(
                        json_agg(
                          json_build_object('name', su.name, 'color', su.avatar_color, 'avatar_url', su.avatar_url)
                          ORDER BY su.name
                        ),
                        '[]'::json
                      ) AS shared_with_users
               FROM task_permissions tp2
               JOIN users su ON tp2.user_id = su.id
               JOIN ranked_tasks rt ON rt.id = tp2.task_id
               WHERE tp2.can_view = true
               GROUP BY tp2.task_id
             )
                  SELECT rt.id, rt.user_id, rt.title, rt.description, rt.date, rt.date_end, rt.time, rt.time_end,
                    rt.priority, rt.completed, rt.type, rt.sort_order, rt.created_at, rt.updated_at, rt.visibility,
                    rt.recurrence_rule, rt.recurrence_parent_id, rt.enable_group_rsvp,
                    rt.teams_join_url, rt.teams_meeting_id,
                    rt.category_id,
                    c.name as category_name,
                    c.color as category_color,
                    c.icon as category_icon,
                    u.name as creator_name,
                    u.avatar_color as creator_color,
                    u.avatar_url as creator_avatar_url,
                    NULL::text AS last_editor_name,
                    rt.is_owner,
                    rt.can_edit,
                    g.group_id,
                    g.group_name,
                    g.group_color,
                    g.group_image_url,
                    g.group_category_id,
                    g.group_category_name,
                    g.group_category_color,
                    0::int AS attachment_count,
                    COALESCE(sh.shared_with_users, '[]'::json) AS shared_with_users
             FROM ranked_tasks rt
             LEFT JOIN categories c ON rt.category_id = c.id
             LEFT JOIN users u ON rt.user_id = u.id
             LEFT JOIN shared_users sh ON sh.task_id = rt.id
             LEFT JOIN LATERAL (
               SELECT gt.group_id,
                      grp.name as group_name,
                      grp.color as group_color,
                      grp.image_url as group_image_url,
                      gt.group_category_id,
                      gc.name as group_category_name,
                      gc.color as group_category_color
               FROM group_tasks gt
               JOIN groups grp ON grp.id = gt.group_id
               LEFT JOIN group_categories gc ON gc.id = gt.group_category_id
               WHERE gt.task_id = rt.id
               ORDER BY gt.group_id
               LIMIT 1
             ) g ON true
             ORDER BY
               CASE WHEN rt.date IS NULL THEN 1 ELSE 0 END ASC,
               rt.date ASC NULLS LAST,
               rt.time ASC NULLS LAST,
               rt.sort_order ASC,
               rt.created_at DESC`,
            [user.id, completedFilter, limit, horizonDays, completedLookbackDays]
          );
        } else {
          // Simple lite query without collaboration features, but with group/category joins
          result = await pool.query(
            `WITH task_ids AS (
               SELECT t.id
               FROM tasks t
               WHERE t.user_id = $1

               UNION ALL

               SELECT gt.task_id AS id
               FROM group_tasks gt
               JOIN group_members gm ON gm.group_id = gt.group_id
               WHERE gm.user_id = $1
             ),
             uniq_ids AS (
               SELECT DISTINCT id FROM task_ids
             ),
             ranked_tasks AS (
               SELECT t.id, t.user_id, t.title, t.description, t.date, t.date_end, t.time, t.time_end,
                 t.priority, t.completed, t.type, t.sort_order, t.created_at, t.updated_at,
                 t.recurrence_rule, t.recurrence_parent_id, t.enable_group_rsvp,
                 t.teams_join_url, t.teams_meeting_id,
                      t.category_id
               FROM uniq_ids ids
               JOIN tasks t ON t.id = ids.id
               WHERE ($2::boolean IS NULL OR t.completed = $2)
                 AND (
                   t.date IS NULL
                   OR (COALESCE(t.completed, false) = true AND t.date >= CURRENT_DATE - ($5::int * INTERVAL '1 day'))
                   OR (COALESCE(t.completed, false) = false AND t.date >= CURRENT_DATE AND t.date <= CURRENT_DATE + ($4::int * INTERVAL '1 day'))
                 )
               ${dashboardOrderBy}
               LIMIT $3
             )
                  SELECT rt.id, rt.user_id, rt.title, rt.description, rt.date, rt.date_end, rt.time, rt.time_end,
                    rt.priority, rt.completed, rt.type, rt.sort_order, rt.created_at, rt.updated_at,
                    rt.recurrence_rule, rt.recurrence_parent_id, rt.enable_group_rsvp,
                    rt.teams_join_url, rt.teams_meeting_id,
                    rt.category_id,
                    c.name as category_name,
                    c.color as category_color,
                    c.icon as category_icon,
                    g.group_id,
                    g.group_name,
                    g.group_color,
                    g.group_image_url,
                    g.group_category_id,
                    g.group_category_name,
                    g.group_category_color,
                    0::int AS attachment_count,
                    '[]'::json AS shared_with_users,
                    true AS is_owner,
                    true AS can_edit,
                    u.name as creator_name,
                    u.avatar_color as creator_color,
                    u.avatar_url as creator_avatar_url,
                    NULL::text AS last_editor_name,
                    'private'::text AS visibility
             FROM ranked_tasks rt
             LEFT JOIN categories c ON rt.category_id = c.id
             LEFT JOIN users u ON rt.user_id = u.id
             LEFT JOIN LATERAL (
               SELECT gt.group_id,
                      grp.name as group_name,
                      grp.color as group_color,
                      grp.image_url as group_image_url,
                      gt.group_category_id,
                      gc.name as group_category_name,
                      gc.color as group_category_color
               FROM group_tasks gt
               JOIN groups grp ON grp.id = gt.group_id
               LEFT JOIN group_categories gc ON gc.id = gt.group_category_id
               WHERE gt.task_id = rt.id
               ORDER BY gt.group_id
               LIMIT 1
             ) g ON true
             ORDER BY
               CASE WHEN rt.date IS NULL THEN 1 ELSE 0 END ASC,
               rt.date ASC NULLS LAST,
               rt.time ASC NULLS LAST,
               rt.sort_order ASC,
               rt.created_at DESC`,
            [user.id, completedFilter, limit, horizonDays, completedLookbackDays]
          );
        }

        // 🚀 Virtual recurrence: expand recurring templates into the dashboard horizon
        const today = new Date().toISOString().split('T')[0];
        const horizonEnd = new Date();
        horizonEnd.setDate(horizonEnd.getDate() + horizonDays);
        const horizonEndStr = horizonEnd.toISOString().split('T')[0];
        const lookbackStart = new Date();
        lookbackStart.setDate(lookbackStart.getDate() - completedLookbackDays);
        const dashWindowStart = lookbackStart.toISOString().split('T')[0];

        // Fetch templates that are active within the dashboard window
        let mergedTasks = normalizeTaskRows(result.rows || []);
        try {
          let tplResult;
          if (collabEnabled) {
            tplResult = await pool.query(
              `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon,
                      u.name as creator_name, u.avatar_color as creator_color, u.avatar_url as creator_avatar_url,
                      NULL::text AS last_editor_name,
                      CASE WHEN t.user_id = $1 THEN true ELSE false END as is_owner,
                      CASE
                        WHEN t.user_id = $1 THEN true
                        ELSE EXISTS (
                          SELECT 1 FROM task_permissions tp
                          WHERE tp.task_id = t.id AND tp.user_id = $1 AND tp.can_edit = true
                        )
                      END as can_edit,
                      g.group_id, g.group_name, g.group_color, g.group_image_url,
                      g.group_category_id, g.group_category_name, g.group_category_color,
                      g.group_task_creator_name, g.group_task_creator_color, g.group_task_creator_avatar_url,
                      0::int as attachment_count,
                      COALESCE((
                        SELECT json_agg(
                          json_build_object('name', su.name, 'color', su.avatar_color, 'avatar_url', su.avatar_url)
                          ORDER BY su.name
                        )
                        FROM task_permissions tp2
                        JOIN users su ON tp2.user_id = su.id
                        WHERE tp2.task_id = t.id AND tp2.can_view = true
                      ), '[]'::json) as shared_with_users
               FROM tasks t
               LEFT JOIN categories c ON t.category_id = c.id
               LEFT JOIN users u ON t.user_id = u.id
               LEFT JOIN task_permissions tp ON tp.task_id = t.id AND tp.user_id = $1
               LEFT JOIN LATERAL (
                 SELECT gt.group_id,
                        grp.name as group_name,
                        grp.color as group_color,
                        grp.image_url as group_image_url,
                   gt.group_category_id,
                   gc.name as group_category_name,
                   gc.color as group_category_color,
                        gtc.name as group_task_creator_name,
                        gtc.avatar_color as group_task_creator_color,
                        gtc.avatar_url as group_task_creator_avatar_url
                 FROM group_tasks gt
                 JOIN groups grp ON grp.id = gt.group_id
                 LEFT JOIN group_categories gc ON gc.id = gt.group_category_id
                 LEFT JOIN users gtc ON gtc.id = gt.created_by
                 WHERE gt.task_id = t.id
                 ORDER BY gt.group_id
                 LIMIT 1
               ) g ON true
               WHERE (
                 t.user_id = $1
                 OR (t.visibility = 'shared' AND EXISTS (
                   SELECT 1 FROM friends f WHERE f.status = 'accepted'
                   AND ((f.user_id = t.user_id AND f.friend_id = $1) OR (f.user_id = $1 AND f.friend_id = t.user_id))
                 ))
                 OR (t.visibility = 'selected_users' AND tp.can_view = true)
                 OR EXISTS (
                   SELECT 1 FROM group_tasks gt2
                   JOIN group_members gm ON gm.group_id = gt2.group_id
                   WHERE gt2.task_id = t.id AND gm.user_id = $1
                 )
               )
                 AND t.recurrence_rule IS NOT NULL
                 AND t.recurrence_parent_id IS NULL
                 AND t.date <= $2
                 AND (t.recurrence_end IS NULL OR t.recurrence_end >= $3)`,
              [user.id, horizonEndStr, dashWindowStart]
            );
          } else {
            tplResult = await pool.query(
              `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon,
                      u.name as creator_name, u.avatar_color as creator_color, u.avatar_url as creator_avatar_url,
                      NULL::text AS last_editor_name,
                      true as is_owner,
                      true as can_edit,
                      g.group_id, g.group_name, g.group_color, g.group_image_url,
                      g.group_category_id, g.group_category_name, g.group_category_color,
                      g.group_task_creator_name, g.group_task_creator_color, g.group_task_creator_avatar_url,
                      0::int as attachment_count,
                      '[]'::json as shared_with_users,
                      'private'::text as visibility
               FROM tasks t
               LEFT JOIN categories c ON t.category_id = c.id
               LEFT JOIN users u ON t.user_id = u.id
               LEFT JOIN LATERAL (
                 SELECT gt.group_id,
                        grp.name as group_name,
                        grp.color as group_color,
                        grp.image_url as group_image_url,
                   gt.group_category_id,
                   gc.name as group_category_name,
                   gc.color as group_category_color,
                        gtc.name as group_task_creator_name,
                        gtc.avatar_color as group_task_creator_color,
                        gtc.avatar_url as group_task_creator_avatar_url
                 FROM group_tasks gt
                 JOIN groups grp ON grp.id = gt.group_id
                 LEFT JOIN group_categories gc ON gc.id = gt.group_category_id
                 LEFT JOIN users gtc ON gtc.id = gt.created_by
                 WHERE gt.task_id = t.id
                 ORDER BY gt.group_id
                 LIMIT 1
               ) g ON true
               WHERE t.user_id = $1
                 AND t.recurrence_rule IS NOT NULL
                 AND t.recurrence_parent_id IS NULL
                 AND t.date <= $2
                 AND (t.recurrence_end IS NULL OR t.recurrence_end >= $3)`,
              [user.id, horizonEndStr, dashWindowStart]
            );
          }
          // Merge concrete + virtual tasks
          mergedTasks = normalizeTaskRows(mergeWithVirtual(result.rows || [], tplResult.rows || [], dashWindowStart, horizonEndStr));
        } catch (mergeErr) {
          console.error('Virtual recurrence merge error:', mergeErr.message);
          // Fallback: use only concrete tasks
          mergedTasks = normalizeTaskRows(result.rows || []);
        }

        const enrichedTasks = await enrichTaskVoteStats(pool, mergedTasks);

        // 🚀 CACHE: Store result for 30 seconds
        const response = { tasks: enrichedTasks, lite: true };
        const cacheKey = buildDashboardCacheKey(user.id, completedFilter, limit, horizonDays, completedLookbackDays);
        try {
          await cacheManager.set(cacheKey, response, 120, String(user.id));
          res.setHeader('X-Dashboard-Cache-Store', 'ok');
        } catch (error) {
          console.error('Dashboard cache set failed:', error);
          res.setHeader('X-Dashboard-Cache-Store', 'failed');
        }

        res.setHeader('X-Dashboard-Cache', `${cacheManager.backendName}-miss`);
        return res.json(response);
      }

      // Full query with collaboration support (existing behaviour)
      let completedClause = '';
      if (completedRaw === 'true') completedClause = ' AND t.completed = true';
      if (completedRaw === 'false') completedClause = ' AND t.completed = false';

      if (collabEnabled) {
        result = await pool.query(
          `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon,
             u.name as creator_name, u.avatar_color as creator_color, u.avatar_url as creator_avatar_url,
             editor.name as last_editor_name,
             CASE WHEN t.user_id = $1 THEN true ELSE false END as is_owner,
             COALESCE(tp.can_edit, false) as can_edit,
             gt.group_id, grp.name as group_name, grp.color as group_color, grp.image_url as group_image_url,
             gc.id as group_category_id, gc.name as group_category_name, gc.color as group_category_color,
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
           LEFT JOIN group_categories gc ON gc.id = gt.group_category_id
           LEFT JOIN users gtc ON gtc.id = gt.created_by
           WHERE t.user_id = $1
             OR (t.visibility = 'shared' AND EXISTS (
               SELECT 1 FROM friends f WHERE f.status = 'accepted'
               AND ((f.user_id = t.user_id AND f.friend_id = $1) OR (f.user_id = $1 AND f.friend_id = t.user_id))
             ))
             OR (t.visibility = 'selected_users' AND tp.can_view = true)
             OR EXISTS (SELECT 1 FROM group_tasks gt2 JOIN group_members gm ON gm.group_id = gt2.group_id WHERE gt2.task_id = t.id AND gm.user_id = $1)
           ${completedClause}
           ORDER BY t.sort_order ASC, t.created_at DESC`,
          [user.id]
        );
      } else {
        result = await pool.query(
          `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon,
             gt.group_id, grp.name as group_name, grp.color as group_color, grp.image_url as group_image_url,
             gc.id as group_category_id, gc.name as group_category_name, gc.color as group_category_color,
             gtc.name as group_task_creator_name, gtc.avatar_color as group_task_creator_color, gtc.avatar_url as group_task_creator_avatar_url,
             (SELECT COUNT(*) FROM task_attachments ta WHERE ta.task_id = t.id)::int as attachment_count
           FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
           LEFT JOIN group_tasks gt ON gt.task_id = t.id
           LEFT JOIN groups grp ON grp.id = gt.group_id
           LEFT JOIN group_categories gc ON gc.id = gt.group_category_id
           LEFT JOIN users gtc ON gtc.id = gt.created_by
           WHERE t.user_id = $1
             OR EXISTS (SELECT 1 FROM group_tasks gt2 JOIN group_members gm ON gm.group_id = gt2.group_id WHERE gt2.task_id = t.id AND gm.user_id = $1)
           ${completedClause}
           ORDER BY t.sort_order ASC, t.created_at DESC`,
          [user.id]
        );
      }

      const normalized = normalizeTaskRows(result.rows);
      const enriched = await enrichTaskVoteStats(pool, normalized);
      return res.json({ tasks: enriched });
    } catch (err) {
      console.error('Tasks list error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden der Aufgaben' });
    }
  }

  // POST /api/tasks
  if (segments.length === 0 && req.method === 'POST') {
    try {
      const { title, description, date, date_end, time, time_end, priority, category_id, reminder_at,
              recurrence_rule, recurrence_interval, recurrence_end, group_id, group_category_id,
              visibility, permissions, type, enable_group_rsvp } = req.body;
      if (!title) {
        return res.status(400).json({ error: 'Titel ist erforderlich' });
      }

      const taskType = type === 'event' ? 'event' : 'task';

      const collabEnabled = await getCollabEnabled(pool);
      const finalVisibility = collabEnabled ? (visibility || 'private') : 'private';

      let groupInfo = null;
      let groupCategoryInfo = null;
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

        if (group_category_id !== undefined && group_category_id !== null && String(group_category_id) !== '') {
          const groupCategoryResult = await pool.query(
            `SELECT id, name, color
             FROM group_categories
             WHERE id = $1 AND group_id = $2
             LIMIT 1`,
            [group_category_id, group_id]
          );
          if (groupCategoryResult.rows.length === 0) {
            return res.status(400).json({ error: 'Ungültige Gruppenkategorie' });
          }
          groupCategoryInfo = groupCategoryResult.rows[0];
        }
      }

      const maxOrder = await pool.query(
        'SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM tasks WHERE user_id = $1',
        [user.id]
      );

      const recurrenceRule = recurrence_rule || null;
      const recurrenceInterval = Math.max(1, Number(recurrence_interval) || 1);
      // Wenn keine Enddatum für Wiederholung angegeben: Standard 5 Jahre
      let recurrenceEnd = recurrence_end || null;
      if (recurrenceRule && !recurrenceEnd && date) {
        const defaultEnd = new Date(date + 'T00:00:00');
        defaultEnd.setFullYear(defaultEnd.getFullYear() + 5);
        recurrenceEnd = defaultEnd.toISOString().split('T')[0];
      }

      // Virtual recurrence: store ONLY the template row.
      // Occurrences are generated on-the-fly in range/dashboard queries.
      // (No more bulk INSERT of hundreds of child rows.)

      const result = await pool.query(
        `INSERT INTO tasks (user_id, title, description, date, date_end, time, time_end, priority, category_id, reminder_at, sort_order,
        recurrence_rule, recurrence_interval, recurrence_end, visibility, type, enable_group_rsvp)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING *`,
        [user.id, title, description || null, date || null, date_end || null, time || null, time_end || null,
         priority || 'medium', category_id || null, reminder_at || null,
        maxOrder.rows[0].next_order, recurrenceRule, recurrenceInterval, recurrenceEnd, finalVisibility, taskType, enable_group_rsvp === true]
      );

      const firstTask = result.rows[0];

      if (collabEnabled && Array.isArray(permissions) && permissions.length > 0) {
        for (const perm of permissions) {
          if (!perm.user_id) continue;
          await pool.query(
            `INSERT INTO task_permissions (task_id, user_id, can_view, can_edit)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (task_id, user_id) DO UPDATE SET can_view = $3, can_edit = $4`,
            [firstTask.id, perm.user_id, perm.can_view !== false, perm.can_edit === true]
          );
        }
      }

      if (groupInfo) {
        await pool.query(
          `INSERT INTO group_tasks (group_id, task_id, created_by, group_category_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [groupInfo.id, firstTask.id, user.id, groupCategoryInfo?.id || null]
        );

        // Immediate team notification for other members (log + push best-effort)
        const memberRows = await pool.query(
          `SELECT gm.user_id
           FROM group_members gm
           WHERE gm.group_id = $1 AND gm.user_id != $2`,
          [groupInfo.id, user.id]
        );

        for (const member of memberRows.rows) {
          await sendPushToUser(
            member.user_id,
            {
              title: `Neue Gruppenaufgabe: ${groupInfo.name}`,
              body: `${title} wurde erstellt`,
              tag: `team-created-${firstTask.id}`,
              url: '/groups',
            },
            'team_task_created',
            firstTask.id,
            groupInfo.id
          ).catch(() => null);
        }
      }

      // Immediate in-app info when a reminder was scheduled
      if (reminder_at) {
        const formatted = formatReminderDateForLog(reminder_at);

        await pool.query(
          `INSERT INTO notification_log (user_id, type, task_id, title, body)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            user.id,
            'reminder_created',
            firstTask.id,
            'Erinnerung geplant',
            `${title} erinnert am ${formatted}`,
          ]
        ).catch(() => null);
      }

      const decoratedTask = normalizeTaskRow({
        ...firstTask,
        visibility: finalVisibility,
        group_id: groupInfo?.id || null,
        group_name: groupInfo?.name || null,
        group_color: groupInfo?.color || null,
        group_image_url: groupInfo?.image_url || null,
        group_category_id: groupCategoryInfo?.id || null,
        group_category_name: groupCategoryInfo?.name || null,
        group_category_color: groupCategoryInfo?.color || null,
      });

      // 🚀 STUFE 3: Event-driven invalidation (instead of pattern-based)
  await cacheManager.invalidateByEvent(String(user.id), 'task_created');

      return res.status(201).json({
        task: decoratedTask,
        created_tasks: [decoratedTask],
        created_count: 1,
        group: groupInfo,
      });
    } catch (err) {
      console.error('Create task error:', err);
      return res.status(500).json({ error: 'Fehler beim Erstellen der Aufgabe' });
    }
  }

  return res.status(404).json({ error: 'Route nicht gefunden' });
};
