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

function toDateOnly(value) {
  if (!value) return null;
  const str = String(value).substring(0, 10);
  const d = new Date(`${str}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function shiftDate(dateValue, days) {
  const d = toDateOnly(dateValue);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
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

async function findAccessibleTask(pool, taskId, userId) {
  const result = await pool.query(
    `SELECT t.id, t.user_id, t.date, t.date_end, t.time, t.time_end, t.title, t.description,
            t.priority, t.category_id, t.visibility, t.type, t.recurrence_rule,
            t.recurrence_interval, t.recurrence_end, t.recurrence_parent_id
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

async function findMaterializedOccurrence(pool, parentId, date) {
  const result = await pool.query(
    `SELECT id, user_id
       FROM tasks
      WHERE recurrence_parent_id = $1
        AND date::text LIKE $2
      LIMIT 1`,
    [parentId, `${date}%`]
  );

  return result.rows[0] || null;
}

async function materializeOccurrenceForComments(pool, template, occurrenceDate) {
  const templateDate = String(template.date).substring(0, 10);
  const spanDays = template.date_end
    ? Math.max(0, Math.round(
        (new Date(`${String(template.date_end).substring(0, 10)}T00:00:00`) -
         new Date(`${templateDate}T00:00:00`)) / 86400000
      ))
    : 0;
  const dateEnd = spanDays > 0 ? shiftDate(occurrenceDate, spanDays) : null;

  const maxOrder = await pool.query(
    'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM tasks WHERE user_id = $1',
    [template.user_id]
  );

  const inserted = await pool.query(
    `INSERT INTO tasks
       (user_id, title, description, date, date_end, time, time_end, priority,
        category_id, reminder_at, sort_order, visibility, type,
        recurrence_rule, recurrence_interval, recurrence_end, recurrence_parent_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING id`,
    [
      template.user_id,
      template.title,
      template.description,
      occurrenceDate,
      dateEnd,
      template.time,
      template.time_end,
      template.priority,
      template.category_id,
      null,
      maxOrder.rows[0].next_order,
      template.visibility || 'private',
      template.type || 'task',
      template.recurrence_rule,
      template.recurrence_interval || 1,
      template.recurrence_end,
      template.id,
    ]
  );

  if (inserted.rows[0]?.id) {
    await inheritTaskRelations(pool, template.id, inserted.rows[0].id);
  }

  return inserted.rows[0] || null;
}

async function resolveTaskForComments(pool, rawTaskId, userId, materializeIfMissing = false) {
  const virtual = parseVirtualId(rawTaskId);
  if (!virtual) {
    const task = await findAccessibleTask(pool, rawTaskId, userId);
    return task ? { taskId: task.id, task } : null;
  }

  const template = await findAccessibleTask(pool, virtual.parentId, userId);
  if (!template) return null;

  const existingOccurrence = await findMaterializedOccurrence(pool, virtual.parentId, virtual.date);
  if (existingOccurrence) {
    return { taskId: existingOccurrence.id, task: template, virtual };
  }

  if (!materializeIfMissing) {
    return { taskId: null, task: template, virtual };
  }

  const createdOccurrence = await materializeOccurrenceForComments(pool, template, virtual.date);
  return createdOccurrence ? { taskId: createdOccurrence.id, task: template, virtual } : null;
}

module.exports = async (req, res) => {
  // CORS headers
  cors(res);
  
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const user = verifyToken(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = user.id;
    const pool = getPool();

    // GET /api/comments?taskId=123 - Fetch comments for a task
    if (req.method === 'GET') {
      const { taskId } = req.query;
      if (!taskId) {
        return res.status(400).json({ error: 'taskId required' });
      }

      const resolved = await resolveTaskForComments(pool, taskId, userId, false);
      if (!resolved) {
        return res.status(404).json({ error: 'Task not found' });
      }

      if (!resolved.taskId) {
        return res.status(200).json({ comments: [] });
      }

      // Fetch comments
      const result = await pool.query(
        `SELECT 
          c.id,
          c.task_id,
          c.user_id,
          c.emoji,
          c.text,
          c.created_at,
          u.name as author,
          u.avatar_color as author_color,
          u.avatar_url as author_avatar_url
        FROM task_comments c
        JOIN users u ON c.user_id = u.id
        WHERE c.task_id = $1
        ORDER BY c.created_at ASC`,
        [resolved.taskId]
      );

      return res.status(200).json({ comments: result.rows });
    }

    // POST /api/comments - Create a comment
    if (req.method === 'POST') {
      const { taskId, emoji = '💬', text } = req.body;

      if (!taskId || !text || !text.trim()) {
        return res.status(400).json({ error: 'taskId and text required' });
      }

      const resolved = await resolveTaskForComments(pool, taskId, userId, true);
      if (!resolved || !resolved.taskId) {
        return res.status(404).json({ error: 'Task not found' });
      }

      // Create comment
      const result = await pool.query(
        `INSERT INTO task_comments (task_id, user_id, emoji, text)
         VALUES ($1, $2, $3, $4)
         RETURNING 
           id,
           task_id,
           user_id,
           emoji,
           text,
           created_at`,
          [resolved.taskId, userId, emoji.slice(0, 10), text.trim()]
      );

      const comment = result.rows[0];

      // Get user info
      const userResult = await pool.query(
        `SELECT name, avatar_color, avatar_url FROM users WHERE id = $1`,
        [userId]
      );

      const user_data = userResult.rows[0] || {};

      return res.status(201).json({
        comment: {
          ...comment,
          author: user_data.name || 'Unknown',
          author_color: user_data.avatar_color || '#007AFF',
          author_avatar_url: user_data.avatar_url || null,
        },
      });
    }

    // DELETE /api/comments?commentId=123 - Delete a comment
    if (req.method === 'DELETE') {
      const { commentId } = req.query;
      if (!commentId) {
        return res.status(400).json({ error: 'commentId required' });
      }

      // Delete comment - RLS will ensure user is the author
      const result = await pool.query(
        `DELETE FROM task_comments WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [commentId, userId]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({ error: 'Comment not found or you are not the author' });
      }

      return res.status(200).json({ message: 'Comment deleted' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Comments endpoint error:', error);
    // Return error message to client for debugging
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      detail: error.code || error.detail || 'Unknown error'
    });
  }
};
