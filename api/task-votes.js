const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

function parseVirtualId(id) {
  if (typeof id !== 'string' || !id.startsWith('v_')) return null;
  const parts = id.split('_');
  if (parts.length < 3) return null;
  const date = parts[parts.length - 1];
  const parentId = parts.slice(1, -1).join('_');
  if (!parentId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { parentId, date };
}

async function findAccessibleTask(pool, taskId, userId) {
  const result = await pool.query(
    `SELECT t.id, t.user_id, t.date, t.visibility, t.recurrence_rule, t.recurrence_parent_id
       FROM tasks t
       LEFT JOIN task_permissions tp ON tp.task_id = t.id AND tp.user_id = $2
      WHERE t.id = $1
        AND (
          t.user_id = $2
          OR (t.visibility = 'shared' AND EXISTS (
            SELECT 1
              FROM friends f
             WHERE f.status = 'accepted'
               AND ((f.user_id = t.user_id AND f.friend_id = $2) OR (f.user_id = $2 AND f.friend_id = t.user_id))
          ))
          OR (t.visibility = 'selected_users' AND tp.can_view = true)
          OR EXISTS (
            SELECT 1
              FROM group_tasks gt
              JOIN group_members gm ON gm.group_id = gt.group_id
             WHERE gt.task_id = t.id AND gm.user_id = $2
          )
        )
      LIMIT 1`,
    [taskId, userId]
  );
  return result.rows[0] || null;
}

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().substring(0, 10);
  return String(value).substring(0, 10);
}

async function resolveTaskForVotes(pool, rawTaskId, userId) {
  const virtual = parseVirtualId(rawTaskId);
  if (!virtual) {
    const task = await findAccessibleTask(pool, rawTaskId, userId);
    if (!task) return null;

    if (task.recurrence_parent_id) {
      return {
        voteTaskId: task.recurrence_parent_id,
        occurrenceDate: normalizeDate(task.date),
      };
    }

    if (task.recurrence_rule) {
      return {
        voteTaskId: task.id,
        occurrenceDate: normalizeDate(task.date),
      };
    }

    return {
      voteTaskId: task.id,
      occurrenceDate: null,
    };
  }

  const template = await findAccessibleTask(pool, virtual.parentId, userId);
  if (!template) return null;

  return {
    voteTaskId: parseInt(virtual.parentId, 10),
    occurrenceDate: virtual.date,
  };
}

async function loadVotes(pool, voteTaskId, occurrenceDate, userId) {
  const result = await pool.query(
    `SELECT v.status, v.user_id, u.name, u.avatar_color, u.avatar_url
       FROM task_votes v
       JOIN users u ON u.id = v.user_id
      WHERE v.task_id = $1
        AND (($2::date IS NULL AND v.occurrence_date IS NULL) OR v.occurrence_date = $2::date)
      ORDER BY v.updated_at ASC`,
    [voteTaskId, occurrenceDate]
  );

  const yesUsers = [];
  const noUsers = [];
  const unansweredUsers = [];
  let myVote = null;

  for (const row of result.rows) {
    const user = {
      name: row.name,
      avatar_color: row.avatar_color,
      avatar_url: row.avatar_url,
    };
    if (row.status === 'yes') yesUsers.push(user);
    if (row.status === 'no') noUsers.push(user);
    if (Number(row.user_id) === Number(userId)) myVote = row.status;
  }

  const memberResult = await pool.query(
    `SELECT COUNT(DISTINCT gm.user_id) AS member_count
       FROM group_tasks gt
       JOIN group_members gm ON gm.group_id = gt.group_id
      WHERE gt.task_id = $1`,
    [voteTaskId]
  );

  const unansweredResult = await pool.query(
    `SELECT u.name, u.avatar_color, u.avatar_url
       FROM group_tasks gt
       JOIN group_members gm ON gm.group_id = gt.group_id
       JOIN users u ON u.id = gm.user_id
       LEFT JOIN task_votes v
         ON v.task_id = gt.task_id
        AND v.user_id = gm.user_id
        AND (($2::date IS NULL AND v.occurrence_date IS NULL) OR v.occurrence_date = $2::date)
      WHERE gt.task_id = $1
        AND v.id IS NULL
      ORDER BY LOWER(COALESCE(u.name, '')) ASC, u.id ASC`,
    [voteTaskId, occurrenceDate]
  );

  for (const row of unansweredResult.rows) {
    unansweredUsers.push({
      name: row.name,
      avatar_color: row.avatar_color,
      avatar_url: row.avatar_url,
    });
  }

  const memberCount = Number(memberResult.rows?.[0]?.member_count || 0);
  const unansweredCount = memberCount > 0 ? unansweredUsers.length : null;

  return {
    yes_count: yesUsers.length,
    no_count: noUsers.length,
    yes_users: yesUsers,
    no_users: noUsers,
    unanswered_users: unansweredUsers,
    my_vote: myVote,
    member_count: memberCount || null,
    unanswered_count: unansweredCount,
  };
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const user = verifyToken(req);
    if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

    const pool = getPool();

    if (req.method === 'GET') {
      const { taskId } = req.query;
      if (!taskId) return res.status(400).json({ error: 'taskId erforderlich' });

      const resolved = await resolveTaskForVotes(pool, taskId, user.id);
      if (!resolved) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });

      const votes = await loadVotes(pool, resolved.voteTaskId, resolved.occurrenceDate, user.id);
      return res.status(200).json(votes);
    }

    if (req.method === 'POST') {
      const { taskId, status } = req.body || {};
      if (!taskId) return res.status(400).json({ error: 'taskId erforderlich' });

      const nextStatus = status == null ? null : String(status).toLowerCase();
      if (nextStatus !== null && nextStatus !== 'yes' && nextStatus !== 'no') {
        return res.status(400).json({ error: 'Ungueltiger Status' });
      }

      const resolved = await resolveTaskForVotes(pool, taskId, user.id);
      if (!resolved) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });

      await pool.query(
        `DELETE FROM task_votes
         WHERE task_id = $1
           AND user_id = $2
           AND (($3::date IS NULL AND occurrence_date IS NULL) OR occurrence_date = $3::date)`,
        [resolved.voteTaskId, user.id, resolved.occurrenceDate]
      );

      if (nextStatus) {
        await pool.query(
          `INSERT INTO task_votes (task_id, user_id, status, occurrence_date)
           VALUES ($1, $2, $3, $4)`,
          [resolved.voteTaskId, user.id, nextStatus, resolved.occurrenceDate]
        );
      }

      const votes = await loadVotes(pool, resolved.voteTaskId, resolved.occurrenceDate, user.id);
      return res.status(200).json(votes);
    }

    return res.status(405).json({ error: 'Methode nicht erlaubt' });
  } catch (error) {
    console.error('Task votes endpoint error:', error);
    return res.status(500).json({ error: 'Serverfehler' });
  }
};
