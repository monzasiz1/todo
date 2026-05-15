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

// ─── Timezone-sichere Datums-Helfer ────────────────────────────────────────
// WICHTIG: Alle Recurrence-Berechnungen laufen rein über YYYY-MM-DD Strings
// und UTC-Arithmetik. `new Date('YYYY-MM-DD')` parst als UTC-Mitternacht,
// `setDate`/`getDate` nutzen Local-Time → bei Vercel-UTC kein Problem, aber
// bei lokalem Dev (Europe/Berlin) entstehen Off-by-One-Bugs. Lösung:
// nur UTC-Methoden und String-Parsing verwenden.

function parseYMD(value) {
  if (!value) return null;
  let str;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    str = value.toISOString().slice(0, 10);
  } else {
    str = String(value).slice(0, 10);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

function formatYMD(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addDaysYMD(ymd, days) {
  const d = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d));
  d.setUTCDate(d.getUTCDate() + (Number(days) || 0));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

function addMonthsYMD(ymd, months) {
  let y = ymd.y;
  let m = ymd.m + (Number(months) || 0);
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1)  { m += 12; y -= 1; }
  const d = Math.min(ymd.d, daysInMonth(y, m));
  return { y, m, d };
}

function calcNextDate(currentDate, rule, interval) {
  if (!currentDate || !rule) return null;
  const i = Math.max(1, Number(interval) || 1);
  const ymd = parseYMD(currentDate);
  if (!ymd) return null;

  switch (rule) {
    case 'daily': {
      const r = addDaysYMD(ymd, i);
      return formatYMD(r.y, r.m, r.d);
    }
    case 'weekly': {
      const r = addDaysYMD(ymd, 7 * i);
      return formatYMD(r.y, r.m, r.d);
    }
    case 'biweekly': {
      const r = addDaysYMD(ymd, 14 * i);
      return formatYMD(r.y, r.m, r.d);
    }
    case 'monthly': {
      const r = addMonthsYMD(ymd, i);
      return formatYMD(r.y, r.m, r.d);
    }
    case 'yearly': {
      const y = ymd.y + i;
      const d = Math.min(ymd.d, daysInMonth(y, ymd.m));
      return formatYMD(y, ymd.m, d);
    }
    case 'weekdays': {
      let cur = addDaysYMD(ymd, 1);
      let guard = 0;
      while (guard < 10) {
        const dow = new Date(Date.UTC(cur.y, cur.m - 1, cur.d)).getUTCDay();
        if (dow !== 0 && dow !== 6) break;
        cur = addDaysYMD(cur, 1);
        guard++;
      }
      return formatYMD(cur.y, cur.m, cur.d);
    }
    default:
      return null;
  }
}

function toDateOnly(value) {
  const ymd = parseYMD(value);
  if (!ymd) return null;
  return new Date(ymd.y, ymd.m - 1, ymd.d, 0, 0, 0, 0);
}

function formatDateOnly(dateObj) {
  if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return null;
  return formatYMD(dateObj.getFullYear(), dateObj.getMonth() + 1, dateObj.getDate());
}

function shiftDate(dateValue, days) {
  const ymd = parseYMD(dateValue);
  if (!ymd) return null;
  const r = addDaysYMD(ymd, Number(days) || 0);
  return formatYMD(r.y, r.m, r.d);
}

// ─── Virtual Recurrence ────────────────────────────────────────────────────
// Instead of storing hundreds of DB rows, we store only the template and
// generate virtual occurrences on-the-fly within a requested date window.
// A concrete row is created only when an occurrence is explicitly modified
// (completed, edited, deleted). Virtual IDs use format: "v_{parentId}_{date}"

function expandRecurringTemplate(template, rangeStart, rangeEnd) {
  if (!template || !template.recurrence_rule || !template.date) return [];

  try {
    const startYmd = parseYMD(rangeStart);
    const endYmd   = parseYMD(rangeEnd);
    if (!startYmd || !endYmd) {
      console.warn('[expandRecurringTemplate] ungültige Range:', { rangeStart, rangeEnd });
      return [];
    }
    const startStr = formatYMD(startYmd.y, startYmd.m, startYmd.d);
    const endStr   = formatYMD(endYmd.y, endYmd.m, endYmd.d);

    const templateYmd = parseYMD(template.date);
    if (!templateYmd) {
      console.warn(`[expandRecurringTemplate] template ${template.id}: ungültiges date`, template.date);
      return [];
    }
    const templateDate = formatYMD(templateYmd.y, templateYmd.m, templateYmd.d);

    const recurrenceEndYmd = template.recurrence_end ? parseYMD(template.recurrence_end) : null;
    const recurrenceEndStr = recurrenceEndYmd
      ? formatYMD(recurrenceEndYmd.y, recurrenceEndYmd.m, recurrenceEndYmd.d)
      : null;

    const effectiveEnd = recurrenceEndStr && recurrenceEndStr < endStr
      ? recurrenceEndStr
      : endStr;

    if (templateDate > endStr || effectiveEnd < startStr) return [];

    const interval = Math.max(1, Number(template.recurrence_interval) || 1);

    let cursor = calcNextDate(templateDate, template.recurrence_rule, interval);
    if (!cursor) {
      console.warn(`[expandRecurringTemplate] template ${template.id}: calcNextDate liefert null`,
        { rule: template.recurrence_rule, interval, templateDate });
      return [];
    }

    let guard = 0;
    while (cursor < startStr && guard < 10000) {
      const next = calcNextDate(cursor, template.recurrence_rule, interval);
      if (!next || next <= cursor) break;
      cursor = next;
      guard++;
    }

    const dateEndYmd = template.date_end ? parseYMD(template.date_end) : null;
    let spanDays = 0;
    if (dateEndYmd) {
      const a = Date.UTC(templateYmd.y, templateYmd.m - 1, templateYmd.d);
      const b = Date.UTC(dateEndYmd.y,  dateEndYmd.m - 1,  dateEndYmd.d);
      spanDays = Math.max(0, Math.round((b - a) / 86400000));
    }

    const result = [];
    guard = 0;
    while (cursor && cursor <= effectiveEnd && guard < 1000) {
      if (cursor >= startStr) {
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
      const next = calcNextDate(cursor, template.recurrence_rule, interval);
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

function mergeWithVirtual(concreteTasks, templates, rangeStart, rangeEnd, dismissedKeys = null) {
  if (!Array.isArray(concreteTasks)) concreteTasks = [];
  if (!Array.isArray(templates)) templates = [];

  // Set of (parentId:date) already covered by concrete rows OR durch
  // Dismissal vom Nutzer ausgeblendet (sonst würde Virtual Expansion die
  // ausgeblendete Instanz wieder rein-rendern, weil die konkrete Reihe
  // vom dismissalFilter aus concreteTasks gefiltert wurde).
  const concreteKeys = new Set();

  for (const t of concreteTasks) {
    if (t && t.recurrence_parent_id) {
      const dateStr = toIsoDateStr(t.date) || 'null';
      concreteKeys.add(`${t.recurrence_parent_id}:${dateStr}`);
    }
  }

  if (dismissedKeys instanceof Set) {
    for (const key of dismissedKeys) concreteKeys.add(key);
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
  const canSeePrivateShareInfo = row.can_see_private_share_info === undefined || row.can_see_private_share_info === null
    ? (!(row.group_id && row.visibility === 'selected_users') || row.is_owner === true)
    : row.can_see_private_share_info === true;

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
    last_editor_color: row.last_editor_color || null,
    last_editor_avatar_url: row.last_editor_avatar_url || null,
    group_id: row.group_id || null,
    group_name: row.group_name || null,
    group_color: row.group_color || null,
    group_image_url: row.group_image_url || null,
    group_category_id: row.group_category_id || null,
    group_category_name: row.group_category_name || null,
    group_category_color: row.group_category_color || null,
    subgroup_id: row.subgroup_id || null,
    subgroup_name: row.subgroup_name || null,
    subgroup_color: row.subgroup_color || null,
    subgroup_members: Array.isArray(row.subgroup_members) ? row.subgroup_members : [],
    group_task_creator_name: row.group_task_creator_name || null,
    group_task_creator_color: row.group_task_creator_color || null,
    group_task_creator_avatar_url: row.group_task_creator_avatar_url || null,
    can_see_private_share_info: canSeePrivateShareInfo,
    enable_group_rsvp: row.enable_group_rsvp === true,
    is_owner: row.is_owner === true,
    is_group_member: row.is_group_member === true,
    can_edit: row.can_edit === undefined || row.can_edit === null
      ? (row.is_owner === true)
      : row.can_edit === true,
  };
}

function normalizeTaskRows(rows) {
  return Array.isArray(rows) ? rows.map(normalizeTaskRow) : [];
}

function buildDashboardCacheKey(userId, completedFilter, limit, horizonDays, completedLookbackDays) {
  const completedScope = completedFilter === null ? 'all' : String(completedFilter);
  return `dashboard:v2:user:${userId}:${completedScope}:${limit}:h${horizonDays}:c${completedLookbackDays}`;
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

let dismissalsEnabledCache = null;
let dismissalsEnabledCacheAt = 0;

async function getDismissalsEnabled(pool) {
  const now = Date.now();
  if (dismissalsEnabledCache !== null && (now - dismissalsEnabledCacheAt) < COLLAB_CACHE_TTL_MS) {
    return dismissalsEnabledCache;
  }
  const result = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'task_dismissals') as has_dismissals`
  );
  dismissalsEnabledCache = result.rows[0]?.has_dismissals === true;
  dismissalsEnabledCacheAt = now;
  return dismissalsEnabledCache;
}

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
      const dismissalsEnabled = await getDismissalsEnabled(pool);
      const dismissalFilter = dismissalsEnabled
        ? 'AND NOT EXISTS (SELECT 1 FROM task_dismissals td WHERE td.task_id = t.id AND td.user_id = $1)'
        : '';

      // 1. Fetch all concrete rows in [start, end] (includes templates + any materialized overrides)
      let concreteResult;
      try {
        if (collabEnabled) {
          concreteResult = await pool.query(
            `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon,
               u.name as creator_name, u.avatar_color as creator_color, u.avatar_url as creator_avatar_url,
               editor.name as last_editor_name, editor.avatar_color as last_editor_color, editor.avatar_url as last_editor_avatar_url,
               CASE WHEN t.user_id = $1 THEN true ELSE false END as is_owner,
               CASE
                 WHEN t.user_id = $1 THEN true
                 ELSE EXISTS (
                   SELECT 1 FROM task_permissions tp_edit
                   WHERE tp_edit.task_id = t.id AND tp_edit.user_id = $1 AND tp_edit.can_edit = true
                 )
               END as can_edit,
               EXISTS (
                 SELECT 1 FROM group_tasks gt2
                 JOIN group_members gm ON gm.group_id = gt2.group_id AND gm.user_id = $1
                 LEFT JOIN group_subgroup_members gsm ON gsm.subgroup_id = gt2.subgroup_id AND gsm.user_id = $1
                 WHERE gt2.task_id = t.id
                   AND (gt2.subgroup_id IS NULL OR gm.role IN ('owner','admin') OR gsm.user_id IS NOT NULL)
               ) as is_group_member,
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
             LEFT JOIN users editor ON editor.id = t.last_edited_by
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
               OR EXISTS (
                 SELECT 1
                 FROM group_tasks gt2
                 JOIN group_members gm ON gm.group_id = gt2.group_id AND gm.user_id = $1
                 LEFT JOIN group_subgroup_members gsm ON gsm.subgroup_id = gt2.subgroup_id AND gsm.user_id = $1
                 WHERE gt2.task_id = t.id
                   AND (gt2.subgroup_id IS NULL OR gm.role IN ('owner','admin') OR gsm.user_id IS NOT NULL)
               )
             ) ${dismissalFilter} AND (
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
             OR EXISTS (
               SELECT 1
               FROM group_tasks gt2
               JOIN group_members gm ON gm.group_id = gt2.group_id AND gm.user_id = $1
               LEFT JOIN group_subgroup_members gsm ON gsm.subgroup_id = gt2.subgroup_id AND gsm.user_id = $1
               WHERE gt2.task_id = t.id
                 AND (gt2.subgroup_id IS NULL OR gm.role IN ('owner','admin') OR gsm.user_id IS NOT NULL)
             )) ${dismissalFilter}
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
               editor.name as last_editor_name, editor.avatar_color as last_editor_color, editor.avatar_url as last_editor_avatar_url,
               CASE WHEN t.user_id = $1 THEN true ELSE false END as is_owner,
               CASE
                 WHEN t.user_id = $1 THEN true
                 ELSE EXISTS (
                   SELECT 1 FROM task_permissions tp_edit
                   WHERE tp_edit.task_id = t.id AND tp_edit.user_id = $1 AND tp_edit.can_edit = true
                 )
               END as can_edit,
               EXISTS (
                 SELECT 1 FROM group_tasks gt2
                 JOIN group_members gm ON gm.group_id = gt2.group_id AND gm.user_id = $1
                 LEFT JOIN group_subgroup_members gsm ON gsm.subgroup_id = gt2.subgroup_id AND gsm.user_id = $1
                 WHERE gt2.task_id = t.id
                   AND (gt2.subgroup_id IS NULL OR gm.role IN ('owner','admin') OR gsm.user_id IS NOT NULL)
               ) as is_group_member,
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
             LEFT JOIN users editor ON editor.id = t.last_edited_by
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
               OR EXISTS (
                 SELECT 1
                 FROM group_tasks gt2
                 JOIN group_members gm ON gm.group_id = gt2.group_id AND gm.user_id = $1
                 LEFT JOIN group_subgroup_members gsm ON gsm.subgroup_id = gt2.subgroup_id AND gsm.user_id = $1
                 WHERE gt2.task_id = t.id
                   AND (gt2.subgroup_id IS NULL OR gm.role IN ('owner','admin') OR gsm.user_id IS NOT NULL)
               )
             )
             ${dismissalFilter}
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
               OR EXISTS (
                 SELECT 1
                 FROM group_tasks gt2
                 JOIN group_members gm ON gm.group_id = gt2.group_id AND gm.user_id = $1
                 LEFT JOIN group_subgroup_members gsm ON gsm.subgroup_id = gt2.subgroup_id AND gsm.user_id = $1
                 WHERE gt2.task_id = t.id
                   AND (gt2.subgroup_id IS NULL OR gm.role IN ('owner','admin') OR gsm.user_id IS NOT NULL)
               )) ${dismissalFilter}
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

      // 2b. Dismissed Recurring-Instanzen sammeln (parent:date) → werden in
      // mergeWithVirtual als "schon abgedeckt" markiert, damit die virtuelle
      // Expansion sie nicht wieder rein-rendert.
      const dismissedKeys = new Set();
      if (dismissalsEnabled) {
        try {
          const dRes = await pool.query(
            `SELECT t.recurrence_parent_id, t.date
               FROM tasks t
               JOIN task_dismissals td ON td.task_id = t.id AND td.user_id = $1
              WHERE t.recurrence_parent_id IS NOT NULL`,
            [user.id]
          );
          for (const row of dRes.rows) {
            const dateStr = toIsoDateStr(row.date) || 'null';
            dismissedKeys.add(`${row.recurrence_parent_id}:${dateStr}`);
          }
        } catch { /* ignore */ }
      }

      // 3. Merge concrete + virtual, deduplicating overrides
      const merged = normalizeTaskRows(mergeWithVirtual(
        concreteResult.rows || [],
        templateResult.rows || [],
        start,
        end,
        dismissedKeys
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
                 SELECT 1
                 FROM group_tasks gt
                 JOIN group_members gm ON gm.group_id = gt.group_id AND gm.user_id = $1
                 LEFT JOIN group_subgroup_members gsm ON gsm.subgroup_id = gt.subgroup_id AND gsm.user_id = $1
                 WHERE gt.task_id = t.id
                   AND (gt.subgroup_id IS NULL OR gm.role IN ('owner','admin') OR gsm.user_id IS NOT NULL)
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

      // Owner, has edit permission, or is a member of the group this task belongs to
      const result = await pool.query(
        `UPDATE tasks SET completed = NOT completed, updated_at = NOW(), last_edited_by = $3
         WHERE id = $1 AND (
           user_id = $2
           OR EXISTS (SELECT 1 FROM task_permissions WHERE task_id = $1 AND user_id = $2 AND can_edit = true)
           OR EXISTS (
             SELECT 1 FROM group_tasks gt
             JOIN group_members gm ON gm.group_id = gt.group_id AND gm.user_id = $2
             WHERE gt.task_id = $1
           )
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
      const rawId = segments[0];
      // Virtuelle Recurrence-Occurrence (v_{parentId}_{date}) → Vorlage laden
      // und Occurrence synthesieren, statt 404 zu liefern.
      const virtual = parseVirtualId(rawId);
      const lookupId = virtual ? Number(virtual.parentId) : Number(rawId);
      if (!Number.isFinite(lookupId)) return res.status(400).json({ error: 'Ungültige ID' });

      const dismissalsEnabled = await getDismissalsEnabled(pool);
      const dismissalFilterUser2 = dismissalsEnabled
        ? 'AND NOT EXISTS (SELECT 1 FROM task_dismissals td WHERE td.task_id = t.id AND td.user_id = $2)'
        : '';

      let rows = [];
      try {
        const result = await pool.query(
          `SELECT t.*, c.name AS category_name, c.color AS category_color, c.icon as category_icon,
             u.name as creator_name, u.avatar_color as creator_color, u.avatar_url as creator_avatar_url,
             editor.name as last_editor_name, editor.avatar_color as last_editor_color, editor.avatar_url as last_editor_avatar_url,
             CASE WHEN t.user_id = $2 THEN true ELSE false END as is_owner,
             CASE
               WHEN t.user_id = $2 THEN true
               ELSE EXISTS (
                 SELECT 1 FROM task_permissions tp_edit
                 WHERE tp_edit.task_id = t.id AND tp_edit.user_id = $2 AND tp_edit.can_edit = true
               )
             END as can_edit,
             g.group_id, g.group_name, g.group_color, g.group_image_url,
             g.group_category_id, g.group_category_name, g.group_category_color,
             g.subgroup_id, g.subgroup_name, g.subgroup_color,
             COALESCE(g.subgroup_members, '[]'::json) as subgroup_members,
             g.group_task_creator_name, g.group_task_creator_color, g.group_task_creator_avatar_url,
             g.my_group_role,
             (g.group_id IS NOT NULL) as is_group_member,
             CASE
               WHEN t.visibility = 'selected_users' AND (t.user_id = $2 OR EXISTS (
                 SELECT 1 FROM task_permissions tp_self
                 WHERE tp_self.task_id = t.id AND tp_self.user_id = $2 AND tp_self.can_view = true
               )) THEN COALESCE((
                 SELECT json_agg(
                   json_build_object('name', su.name, 'color', su.avatar_color, 'avatar_url', su.avatar_url)
                   ORDER BY su.name
                 )
                 FROM task_permissions tp2
                 JOIN users su ON tp2.user_id = su.id
                 WHERE tp2.task_id = t.id AND tp2.can_view = true
               ), '[]'::json)
               ELSE '[]'::json
             END as shared_with_users,
             CASE
               WHEN t.visibility = 'selected_users'
                 THEN (t.user_id = $2 OR EXISTS (
                   SELECT 1 FROM task_permissions tp_self
                   WHERE tp_self.task_id = t.id AND tp_self.user_id = $2 AND tp_self.can_view = true
                 ))
               ELSE true
             END as can_see_private_share_info
           FROM tasks t
           LEFT JOIN categories c ON c.id = t.category_id
           LEFT JOIN users u ON u.id = t.user_id
           LEFT JOIN users editor ON editor.id = t.last_edited_by
           LEFT JOIN LATERAL (
             SELECT gt.group_id,
                    grp.name as group_name,
                    grp.color as group_color,
                    grp.image_url as group_image_url,
                    gt.group_category_id,
                    gc.name as group_category_name,
                    gc.color as group_category_color,
                    gt.subgroup_id,
                    gs.name as subgroup_name,
                    gs.color as subgroup_color,
                    COALESCE((
                      SELECT json_agg(json_build_object('user_id', u2.id, 'name', u2.name, 'avatar_color', u2.avatar_color, 'avatar_url', u2.avatar_url))
                      FROM group_subgroup_members gsm2
                      JOIN users u2 ON u2.id = gsm2.user_id
                      WHERE gsm2.subgroup_id = gt.subgroup_id
                    ), '[]'::json) as subgroup_members,
                    gtc.name as group_task_creator_name,
                    gtc.avatar_color as group_task_creator_color,
                    gtc.avatar_url as group_task_creator_avatar_url,
                    gm.role as my_group_role
             FROM group_tasks gt
             JOIN groups grp ON grp.id = gt.group_id
             JOIN group_members gm ON gm.group_id = gt.group_id AND gm.user_id = $2
             LEFT JOIN group_categories gc ON gc.id = gt.group_category_id
             LEFT JOIN group_subgroups gs ON gs.id = gt.subgroup_id
             LEFT JOIN group_subgroup_members gsm ON gsm.subgroup_id = gt.subgroup_id AND gsm.user_id = $2
             LEFT JOIN users gtc ON gtc.id = gt.created_by
             WHERE gt.task_id = t.id
               AND (gt.subgroup_id IS NULL OR gm.role IN ('owner','admin') OR gsm.user_id IS NOT NULL)
             ORDER BY (gt.subgroup_id IS NOT NULL) DESC, gt.group_id
             LIMIT 1
           ) g ON true
           WHERE t.id = $1
             ${dismissalFilterUser2}
             AND (
               t.user_id = $2
               OR (t.visibility = 'shared' AND EXISTS (
                 SELECT 1 FROM friends f WHERE f.status = 'accepted'
                 AND ((f.user_id = t.user_id AND f.friend_id = $2) OR (f.user_id = $2 AND f.friend_id = t.user_id))
               ))
               OR (t.visibility = 'selected_users' AND EXISTS (
                 SELECT 1 FROM task_permissions tp_view
                 WHERE tp_view.task_id = t.id AND tp_view.user_id = $2 AND tp_view.can_view = true
               ))
               OR g.group_id IS NOT NULL
             )
           LIMIT 1`,
          [lookupId, user.id]
        );
        rows = result.rows || [];
      } catch {
        const fallback = await pool.query(
          `SELECT t.*, c.name AS category_name, c.color AS category_color
           FROM tasks t
           LEFT JOIN categories c ON c.id = t.category_id
           WHERE t.id = $1 AND t.user_id = $2
           LIMIT 1`,
          [lookupId, user.id]
        );
        rows = fallback.rows || [];
      }

      if (rows.length === 0) return res.status(404).json({ error: 'Nicht gefunden' });

      // Virtuelle Occurrence: aus Vorlage synthesieren (Datum + virtuelle ID).
      if (virtual) {
        const tpl = rows[0];
        if (!tpl.recurrence_rule) {
          return res.status(404).json({ error: 'Nicht gefunden' });
        }
        const occDate = virtual.date;
        const tplDateStr = tpl.date instanceof Date
          ? tpl.date.toISOString().split('T')[0]
          : String(tpl.date).substring(0, 10);
        const tplEndStr = tpl.date_end
          ? (tpl.date_end instanceof Date
              ? tpl.date_end.toISOString().split('T')[0]
              : String(tpl.date_end).substring(0, 10))
          : null;
        const spanDays = tplEndStr
          ? Math.max(0, Math.round(
              (new Date(tplEndStr + 'T00:00:00') -
               new Date(tplDateStr + 'T00:00:00')) / 86400000
            ))
          : 0;
        const synthesized = {
          ...tpl,
          id: rawId,
          date: occDate,
          date_end: spanDays > 0 ? shiftDate(occDate, spanDays) : null,
          completed: false,
          is_virtual: true,
          recurrence_parent_id: tpl.id,
        };
        return res.json(normalizeTaskRow(synthesized));
      }

      return res.json(normalizeTaskRow(rows[0]));
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
              recurrence_rule, recurrence_interval, recurrence_end, type, enable_group_rsvp, location } = req.body;
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
      const hasLocation = Object.prototype.hasOwnProperty.call(req.body, 'location');

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
        if (hasLocation) addSet('location', typeof location === 'string' ? location.trim() || null : null);

        setClauses.push('updated_at = NOW()');
        values.push(user.id);
        setClauses.push(`last_edited_by = $${values.length}`);

        values.push(taskId);
        const whereTaskIdx = values.length;
        values.push(user.id);
        const whereOwnerIdx = values.length;
        values.push(user.id);
        const wherePermissionIdx = values.length;
        values.push(user.id);
        const whereGroupMemberIdx = values.length;

        return pool.query(
          `UPDATE tasks SET
           ${setClauses.join(',\n         ')}
           WHERE id = $${whereTaskIdx}
             AND (
               user_id = $${whereOwnerIdx}
               OR EXISTS (
                 SELECT 1
                 FROM task_permissions tp
                 WHERE tp.task_id = $${whereTaskIdx}
                   AND tp.user_id = $${wherePermissionIdx}
                   AND tp.can_edit = true
               )
               OR EXISTS (
                 SELECT 1
                 FROM group_tasks gt
                 JOIN group_members gm ON gm.group_id = gt.group_id
                 WHERE gt.task_id = $${whereTaskIdx}
                   AND gm.user_id = $${whereGroupMemberIdx}
               )
             )
           RETURNING *`,
          values
        );
      };

      const result = await runUpdate();
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Aufgabe nicht gefunden oder keine Berechtigung' });
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

  // DELETE /api/tasks/:id/dismissal — eigene Dismissal entfernen (Task wieder in Kalender)
  if (segments.length === 2 && segments[1] === 'dismissal' && req.method === 'DELETE') {
    try {
      const rawId = segments[0];
      let taskId = Number(rawId);

      // Virtual ID: konkreten materialisierten Row auflösen
      // (matchen über recurrence_parent_id + date des Users).
      const virtual = parseVirtualId(rawId);
      if (virtual) {
        const existing = await pool.query(
          `SELECT id FROM tasks
             WHERE recurrence_parent_id = $1 AND date::text LIKE $2 AND user_id = $3
             LIMIT 1`,
          [virtual.parentId, virtual.date + '%', user.id]
        );
        if (existing.rows.length === 0) {
          // Keine konkrete Row → nichts zu restoren
          return res.json({ success: true, restored: false, virtual: true });
        }
        taskId = existing.rows[0].id;
      }

      if (!Number.isFinite(taskId)) return res.status(400).json({ error: 'Ungültige ID' });

      const dismissalsEnabled = await getDismissalsEnabled(pool);
      if (!dismissalsEnabled) {
        return res.json({ success: true, restored: false });
      }

      const result = await pool.query(
        'DELETE FROM task_dismissals WHERE user_id = $1 AND task_id = $2',
        [user.id, taskId]
      );

      await cacheManager.invalidateByEvent(String(user.id), 'task_restored');
      return res.json({ success: true, restored: result.rowCount > 0 });
    } catch (err) {
      console.error('Restore dismissal error:', err);
      return res.status(500).json({ error: 'Fehler beim Wiederherstellen' });
    }
  }

  // DELETE /api/tasks/:id
  // Query:
  //   ?mode=full    → komplette Löschung (erfordert Owner ODER Gruppen-Admin/Owner)
  //   ?mode=dismiss → nur aus eigenem Kalender entfernen (für ALLE erlaubt — auch Owner)
  //   ohne mode     → Legacy-Default: Owner=full, andere=dismiss
  if (segments.length === 1 && req.method === 'DELETE') {
    try {
      const rawId = segments[0];
      const mode = String(req.query?.mode || '').toLowerCase();

      // ── Virtuelle Recurring-Instanz ──────────────────────────────────────
      // Bei dismiss: materialisieren, dann dismissal-Eintrag setzen, damit die
      //   virtuelle Expansion die Instanz nicht wieder rein-rendert.
      // Bei full delete: würde die Task aus der gesamten Serie sofort
      //   wiedererscheinen (Virtual Expansion regeneriert). Ohne separate
      //   exception-Tabelle ist das nicht sicher implementierbar — wir geben
      //   no-op zurück und der Client wird darauf hingewiesen.
      let resolvedRawId = rawId;
      const virtual = parseVirtualId(rawId);
      if (virtual) {
        if (mode !== 'dismiss') {
          return res.status(400).json({
            error: 'Einzelne Wiederholungen können nur aus dem eigenen Kalender entfernt werden. Für endgültiges Löschen die Serie bearbeiten.',
          });
        }
        let concrete = null;
        try {
          concrete = await materializeOccurrence(pool, virtual.parentId, virtual.date, user.id);
        } catch {
          concrete = null;
        }
        if (!concrete) {
          return res.json({ success: true, virtual: true, action: 'noop' });
        }
        resolvedRawId = String(concrete.id);
      }

      const taskId = Number(resolvedRawId);
      if (!Number.isFinite(taskId)) return res.status(400).json({ error: 'Ungültige ID' });

      const ownerCheck = await pool.query(
        'SELECT user_id FROM tasks WHERE id = $1',
        [taskId]
      );
      if (ownerCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
      }

      const isOwner = Number(ownerCheck.rows[0].user_id) === Number(user.id);

      // Gruppen-Admin-Check: Ist user Admin/Owner einer Gruppe, in der die Task liegt?
      let isGroupAdmin = false;
      if (!isOwner) {
        const adminCheck = await pool.query(
          `SELECT 1 FROM group_tasks gt
             JOIN group_members gm ON gm.group_id = gt.group_id
            WHERE gt.task_id = $1 AND gm.user_id = $2 AND gm.role IN ('owner','admin')
            LIMIT 1`,
          [taskId, user.id]
        );
        isGroupAdmin = adminCheck.rowCount > 0;
      }

      const canFullDelete = isOwner || isGroupAdmin;

      // Entscheide finalen Action-Typ
      let action; // 'full' | 'dismiss'
      if (mode === 'dismiss') {
        action = 'dismiss';
      } else if (mode === 'full') {
        if (!canFullDelete) {
          return res.status(403).json({ error: 'Keine Berechtigung zum vollständigen Löschen' });
        }
        action = 'full';
      } else {
        // Legacy default
        action = isOwner ? 'full' : 'dismiss';
      }

      if (action === 'full') {
        // Cascade entfernt group_tasks, task_permissions, task_dismissals etc.
        await pool.query('DELETE FROM tasks WHERE id = $1', [taskId]);
      } else {
        // Dismiss: NUR Dismissal-Eintrag setzen. task_permissions bleibt erhalten,
        // sonst lässt sich der ursprüngliche Zugriff (selected_users) nicht
        // wiederherstellen. Der dismissalFilter in allen SELECT-Queries blendet
        // die Task korrekt aus, auch bei vorhandenem task_permissions-Eintrag.
        await pool.query(
          `INSERT INTO task_dismissals (user_id, task_id)
           VALUES ($1, $2)
           ON CONFLICT (user_id, task_id) DO NOTHING`,
          [user.id, taskId]
        );
      }

      await cacheManager.invalidateByEvent(String(user.id), 'task_deleted');
      return res.json({ success: true, action });
    } catch (err) {
      console.error('Delete error:', err);
      return res.status(500).json({ error: 'Fehler beim Löschen' });
    }
  }

  // GET /api/tasks/summary
  if (segments[0] === 'summary' && req.method === 'GET') {
    try {
      const collabEnabled = await getCollabEnabled(pool);
      const dismissalsEnabled = await getDismissalsEnabled(pool);
      const summaryDismissalFilter = dismissalsEnabled
        ? 'AND NOT EXISTS (SELECT 1 FROM task_dismissals td WHERE td.task_id = t.id AND td.user_id = $1)'
        : '';

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
             OR EXISTS (
               SELECT 1
               FROM group_tasks gt2
               JOIN group_members gm ON gm.group_id = gt2.group_id AND gm.user_id = $1
               LEFT JOIN group_subgroup_members gsm ON gsm.subgroup_id = gt2.subgroup_id AND gsm.user_id = $1
               WHERE gt2.task_id = t.id
                 AND (gt2.subgroup_id IS NULL OR gm.role IN ('owner','admin') OR gsm.user_id IS NOT NULL)
             ))
             ${summaryDismissalFilter}
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
             OR EXISTS (
               SELECT 1
               FROM group_tasks gt2
               JOIN group_members gm ON gm.group_id = gt2.group_id AND gm.user_id = $1
               LEFT JOIN group_subgroup_members gsm ON gsm.subgroup_id = gt2.subgroup_id AND gsm.user_id = $1
               WHERE gt2.task_id = t.id
                 AND (gt2.subgroup_id IS NULL OR gm.role IN ('owner','admin') OR gsm.user_id IS NOT NULL)
             ))
             ${summaryDismissalFilter}
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
      const dismissalsEnabled = await getDismissalsEnabled(pool);
      const dismissalCTEFilter = dismissalsEnabled
        ? 'WHERE id NOT IN (SELECT task_id FROM task_dismissals WHERE user_id = $1)'
        : '';

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
               JOIN group_members gm ON gm.group_id = gt.group_id AND gm.user_id = $1
               LEFT JOIN group_subgroup_members gsm ON gsm.subgroup_id = gt.subgroup_id AND gsm.user_id = $1
               WHERE (gt.subgroup_id IS NULL OR gm.role IN ('owner','admin') OR gsm.user_id IS NOT NULL)
             ),
             task_ids AS (
               SELECT DISTINCT id FROM visible_ids
               ${dismissalCTEFilter}
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
                      END AS can_edit,
                      EXISTS (
                        SELECT 1
                        FROM group_tasks gt2
                        JOIN group_members gm2 ON gm2.group_id = gt2.group_id AND gm2.user_id = $1
                        LEFT JOIN group_subgroup_members gsm2 ON gsm2.subgroup_id = gt2.subgroup_id AND gsm2.user_id = $1
                        WHERE gt2.task_id = t.id
                          AND (gt2.subgroup_id IS NULL OR gm2.role IN ('owner','admin') OR gsm2.user_id IS NOT NULL)
                      ) AS is_group_member
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
                      CASE
                        WHEN MAX(CASE WHEN rt.visibility = 'selected_users' AND NOT (rt.user_id = $1 OR EXISTS (
                          SELECT 1 FROM task_permissions tp_self
                          WHERE tp_self.task_id = rt.id AND tp_self.user_id = $1 AND tp_self.can_view = true
                        )) THEN 1 ELSE 0 END) = 1
                          THEN '[]'::json
                        ELSE COALESCE(
                          json_agg(
                            json_build_object('name', su.name, 'color', su.avatar_color, 'avatar_url', su.avatar_url)
                            ORDER BY su.name
                          ),
                          '[]'::json
                        )
                      END AS shared_with_users
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
                    rt.is_group_member,
                    CASE
                      WHEN rt.visibility = 'selected_users' THEN (rt.user_id = $1 OR EXISTS (
                        SELECT 1 FROM task_permissions tp_self
                        WHERE tp_self.task_id = rt.id AND tp_self.user_id = $1 AND tp_self.can_view = true
                      ))
                      ELSE true
                    END AS can_see_private_share_info,
                    g.group_id,
                    g.group_name,
                    g.group_color,
                    g.group_image_url,
                    g.group_category_id,
                    g.group_category_name,
                    g.group_category_color,
                    g.subgroup_id,
                    g.subgroup_name,
                    g.subgroup_color,
                    COALESCE(g.subgroup_members, '[]'::json) AS subgroup_members,
                    g.my_group_role,
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
                      gc.color as group_category_color,
                      gt.subgroup_id,
                      gs.name as subgroup_name,
                      gs.color as subgroup_color,
                      COALESCE((
                        SELECT json_agg(json_build_object('user_id', u2.id, 'name', u2.name, 'avatar_color', u2.avatar_color, 'avatar_url', u2.avatar_url))
                        FROM group_subgroup_members gsm2
                        JOIN users u2 ON u2.id = gsm2.user_id
                        WHERE gsm2.subgroup_id = gt.subgroup_id
                      ), '[]'::json) as subgroup_members,
                      (SELECT gm.role FROM group_members gm
                       WHERE gm.group_id = gt.group_id AND gm.user_id = $1
                       LIMIT 1) as my_group_role
               FROM group_tasks gt
               JOIN groups grp ON grp.id = gt.group_id
               LEFT JOIN group_categories gc ON gc.id = gt.group_category_id
               LEFT JOIN group_subgroups gs ON gs.id = gt.subgroup_id
               WHERE gt.task_id = rt.id
               ORDER BY (gt.subgroup_id IS NOT NULL) DESC, gt.group_id
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
               JOIN group_members gm ON gm.group_id = gt.group_id AND gm.user_id = $1
               LEFT JOIN group_subgroup_members gsm ON gsm.subgroup_id = gt.subgroup_id AND gsm.user_id = $1
               WHERE (gt.subgroup_id IS NULL OR gm.role IN ('owner','admin') OR gsm.user_id IS NOT NULL)
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
                    g.subgroup_id,
                    g.subgroup_name,
                    g.subgroup_color,
                    COALESCE(g.subgroup_members, '[]'::json) AS subgroup_members,
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
                      gc.color as group_category_color,
                      gt.subgroup_id,
                      gs.name as subgroup_name,
                      gs.color as subgroup_color,
                      COALESCE((
                        SELECT json_agg(json_build_object('user_id', u2.id, 'name', u2.name, 'avatar_color', u2.avatar_color, 'avatar_url', u2.avatar_url))
                        FROM group_subgroup_members gsm2
                        JOIN users u2 ON u2.id = gsm2.user_id
                        WHERE gsm2.subgroup_id = gt.subgroup_id
                      ), '[]'::json) as subgroup_members
               FROM group_tasks gt
               JOIN groups grp ON grp.id = gt.group_id
               LEFT JOIN group_categories gc ON gc.id = gt.group_category_id
               LEFT JOIN group_subgroups gs ON gs.id = gt.subgroup_id
               WHERE gt.task_id = rt.id
               ORDER BY (gt.subgroup_id IS NOT NULL) DESC, gt.group_id
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
                      g.subgroup_id, g.subgroup_name, g.subgroup_color,
                      COALESCE(g.subgroup_members, '[]'::json) as subgroup_members,
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
                        gt.subgroup_id,
                        gs.name as subgroup_name,
                        gs.color as subgroup_color,
                        COALESCE((
                          SELECT json_agg(json_build_object('user_id', u2.id, 'name', u2.name, 'avatar_color', u2.avatar_color, 'avatar_url', u2.avatar_url))
                          FROM group_subgroup_members gsm2
                          JOIN users u2 ON u2.id = gsm2.user_id
                          WHERE gsm2.subgroup_id = gt.subgroup_id
                        ), '[]'::json) as subgroup_members,
                        gtc.name as group_task_creator_name,
                        gtc.avatar_color as group_task_creator_color,
                        gtc.avatar_url as group_task_creator_avatar_url
                 FROM group_tasks gt
                 JOIN groups grp ON grp.id = gt.group_id
                 LEFT JOIN group_categories gc ON gc.id = gt.group_category_id
                 LEFT JOIN group_subgroups gs ON gs.id = gt.subgroup_id
                 LEFT JOIN users gtc ON gtc.id = gt.created_by
                 WHERE gt.task_id = t.id
                 ORDER BY (gt.subgroup_id IS NOT NULL) DESC, gt.group_id
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
                   SELECT 1
                   FROM group_tasks gt2
                   JOIN group_members gm ON gm.group_id = gt2.group_id AND gm.user_id = $1
                   LEFT JOIN group_subgroup_members gsm ON gsm.subgroup_id = gt2.subgroup_id AND gsm.user_id = $1
                   WHERE gt2.task_id = t.id
                     AND (gt2.subgroup_id IS NULL OR gm.role IN ('owner','admin') OR gsm.user_id IS NOT NULL)
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
                      g.subgroup_id, g.subgroup_name, g.subgroup_color,
                      COALESCE(g.subgroup_members, '[]'::json) as subgroup_members,
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
                        gt.subgroup_id,
                        gs.name as subgroup_name,
                        gs.color as subgroup_color,
                        COALESCE((
                          SELECT json_agg(json_build_object('user_id', u2.id, 'name', u2.name, 'avatar_color', u2.avatar_color, 'avatar_url', u2.avatar_url))
                          FROM group_subgroup_members gsm2
                          JOIN users u2 ON u2.id = gsm2.user_id
                          WHERE gsm2.subgroup_id = gt.subgroup_id
                        ), '[]'::json) as subgroup_members,
                        gtc.name as group_task_creator_name,
                        gtc.avatar_color as group_task_creator_color,
                        gtc.avatar_url as group_task_creator_avatar_url
                 FROM group_tasks gt
                 JOIN groups grp ON grp.id = gt.group_id
                 LEFT JOIN group_categories gc ON gc.id = gt.group_category_id
                 LEFT JOIN group_subgroups gs ON gs.id = gt.subgroup_id
                 LEFT JOIN users gtc ON gtc.id = gt.created_by
                 WHERE gt.task_id = t.id
                 ORDER BY (gt.subgroup_id IS NOT NULL) DESC, gt.group_id
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
          // Dismissed Recurring-Instanzen sammeln, damit Virtual Expansion
          // sie nicht wieder rein-rendert.
          const dashDismissedKeys = new Set();
          if (dismissalsEnabled) {
            try {
              const dRes = await pool.query(
                `SELECT t.recurrence_parent_id, t.date
                   FROM tasks t
                   JOIN task_dismissals td ON td.task_id = t.id AND td.user_id = $1
                  WHERE t.recurrence_parent_id IS NOT NULL`,
                [user.id]
              );
              for (const row of dRes.rows) {
                const dateStr = toIsoDateStr(row.date) || 'null';
                dashDismissedKeys.add(`${row.recurrence_parent_id}:${dateStr}`);
              }
            } catch { /* ignore */ }
          }

          // Merge concrete + virtual tasks
          mergedTasks = normalizeTaskRows(mergeWithVirtual(result.rows || [], tplResult.rows || [], dashWindowStart, horizonEndStr, dashDismissedKeys));
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

      // Dismissal-Filter für die volle /api/tasks Liste
      const dismissalAndFilter = dismissalsEnabled
        ? 'AND NOT EXISTS (SELECT 1 FROM task_dismissals td WHERE td.task_id = t.id AND td.user_id = $1)'
        : '';

      if (collabEnabled) {
        result = await pool.query(
          `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon,
             CASE
               WHEN t.user_id <> $1 AND t.visibility = 'selected_users' AND COALESCE(tp.can_view, false)
                 THEN COALESCE(editor.name, u.name)
               ELSE u.name
             END as creator_name,
             CASE
               WHEN t.user_id <> $1 AND t.visibility = 'selected_users' AND COALESCE(tp.can_view, false)
                 THEN COALESCE(editor.avatar_color, u.avatar_color)
               ELSE u.avatar_color
             END as creator_color,
             CASE
               WHEN t.user_id <> $1 AND t.visibility = 'selected_users' AND COALESCE(tp.can_view, false)
                 THEN COALESCE(editor.avatar_url, u.avatar_url)
               ELSE u.avatar_url
             END as creator_avatar_url,
             editor.name as last_editor_name,
             CASE WHEN t.user_id = $1 THEN true ELSE false END as is_owner,
             COALESCE(tp.can_edit, false) as can_edit,
             EXISTS (
               SELECT 1
               FROM group_tasks gt2
               JOIN group_members gm2 ON gm2.group_id = gt2.group_id AND gm2.user_id = $1
               LEFT JOIN group_subgroup_members gsm2 ON gsm2.subgroup_id = gt2.subgroup_id AND gsm2.user_id = $1
               WHERE gt2.task_id = t.id
                 AND (gt2.subgroup_id IS NULL OR gm2.role IN ('owner','admin') OR gsm2.user_id IS NOT NULL)
             ) as is_group_member,
             (SELECT gm3.role FROM group_members gm3
              JOIN group_tasks gt3 ON gt3.group_id = gm3.group_id AND gt3.task_id = t.id
              WHERE gm3.user_id = $1 LIMIT 1) as my_group_role,
             gt.group_id, grp.name as group_name, grp.color as group_color, grp.image_url as group_image_url,
             gc.id as group_category_id, gc.name as group_category_name, gc.color as group_category_color,
             gtc.name as group_task_creator_name, gtc.avatar_color as group_task_creator_color, gtc.avatar_url as group_task_creator_avatar_url,
             CASE
               WHEN t.visibility = 'selected_users' THEN (t.user_id = $1 OR COALESCE(tp.can_view, false))
               ELSE true
             END as can_see_private_share_info,
             (SELECT COUNT(*) FROM task_attachments ta WHERE ta.task_id = t.id)::int as attachment_count,
             (SELECT CASE
                      WHEN t.visibility = 'selected_users' AND NOT (t.user_id = $1 OR COALESCE(tp.can_view, false))
                        THEN '[]'::json
                      ELSE COALESCE(
                        json_agg(json_build_object('name', su.name, 'color', su.avatar_color, 'avatar_url', su.avatar_url)),
                        '[]'::json
                      )
                    END
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
           WHERE (t.user_id = $1
             OR (t.visibility = 'shared' AND EXISTS (
               SELECT 1 FROM friends f WHERE f.status = 'accepted'
               AND ((f.user_id = t.user_id AND f.friend_id = $1) OR (f.user_id = $1 AND f.friend_id = t.user_id))
             ))
             OR (t.visibility = 'selected_users' AND tp.can_view = true)
             OR EXISTS (
               SELECT 1
               FROM group_tasks gt2
               JOIN group_members gm ON gm.group_id = gt2.group_id AND gm.user_id = $1
               LEFT JOIN group_subgroup_members gsm ON gsm.subgroup_id = gt2.subgroup_id AND gsm.user_id = $1
               WHERE gt2.task_id = t.id
                 AND (gt2.subgroup_id IS NULL OR gm.role IN ('owner','admin') OR gsm.user_id IS NOT NULL)
             ))
             ${dismissalAndFilter}
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
             true as can_see_private_share_info,
             EXISTS (
               SELECT 1
               FROM group_tasks gt2
               JOIN group_members gm2 ON gm2.group_id = gt2.group_id AND gm2.user_id = $1
               LEFT JOIN group_subgroup_members gsm2 ON gsm2.subgroup_id = gt2.subgroup_id AND gsm2.user_id = $1
               WHERE gt2.task_id = t.id
                 AND (gt2.subgroup_id IS NULL OR gm2.role IN ('owner','admin') OR gsm2.user_id IS NOT NULL)
             ) as is_group_member,
             (SELECT gm3.role FROM group_members gm3
              JOIN group_tasks gt3 ON gt3.group_id = gm3.group_id AND gt3.task_id = t.id
              WHERE gm3.user_id = $1 LIMIT 1) as my_group_role,
             (SELECT COUNT(*) FROM task_attachments ta WHERE ta.task_id = t.id)::int as attachment_count
           FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
           LEFT JOIN group_tasks gt ON gt.task_id = t.id
           LEFT JOIN groups grp ON grp.id = gt.group_id
           LEFT JOIN group_categories gc ON gc.id = gt.group_category_id
           LEFT JOIN users gtc ON gtc.id = gt.created_by
           WHERE (t.user_id = $1
             OR EXISTS (
               SELECT 1
               FROM group_tasks gt2
               JOIN group_members gm ON gm.group_id = gt2.group_id AND gm.user_id = $1
               LEFT JOIN group_subgroup_members gsm ON gsm.subgroup_id = gt2.subgroup_id AND gsm.user_id = $1
               WHERE gt2.task_id = t.id
                 AND (gt2.subgroup_id IS NULL OR gm.role IN ('owner','admin') OR gsm.user_id IS NOT NULL)
             ))
             ${dismissalAndFilter}
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
              visibility, permissions, type, enable_group_rsvp, location } = req.body;
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
        recurrence_rule, recurrence_interval, recurrence_end, visibility, type, enable_group_rsvp, location)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING *`,
        [user.id, title, description || null, date || null, date_end || null, time || null, time_end || null,
         priority || 'medium', category_id || null, reminder_at || null,
        maxOrder.rows[0].next_order, recurrenceRule, recurrenceInterval, recurrenceEnd, finalVisibility, taskType, enable_group_rsvp === true,
        (typeof location === 'string' ? location.trim() || null : null)]
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
