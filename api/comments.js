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
function normalizeDate(value) {
  return value ? String(value).substring(0, 10) : null;
}

async function resolveTaskForComments(pool, rawTaskId, userId) {
  const virtual = parseVirtualId(rawTaskId);
  if (!virtual) {
    const task = await findAccessibleTask(pool, rawTaskId, userId);
    if (!task) return null;

    if (task.recurrence_parent_id) {
      return {
        task,
        commentTaskId: task.recurrence_parent_id,
        occurrenceDate: normalizeDate(task.date),
      };
    }

    if (task.recurrence_rule) {
      return {
        task,
        commentTaskId: task.id,
        occurrenceDate: normalizeDate(task.date),
      };
    }

    return {
      task,
      commentTaskId: task.id,
      occurrenceDate: null,
    };
  }

  const template = await findAccessibleTask(pool, virtual.parentId, userId);
  if (!template) return null;

  return {
    task: template,
    commentTaskId: parseInt(virtual.parentId, 10),
    occurrenceDate: virtual.date,
  };
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
          AND (($2::date IS NULL AND c.occurrence_date IS NULL) OR c.occurrence_date = $2::date)
        ORDER BY c.created_at ASC`,
        [resolved.commentTaskId, resolved.occurrenceDate]
      );

      return res.status(200).json({ comments: result.rows });
    }

    // POST /api/comments - Create a comment
    if (req.method === 'POST') {
      const { taskId, emoji = '💬', text } = req.body;

      if (!taskId || !text || !text.trim()) {
        return res.status(400).json({ error: 'taskId and text required' });
      }

      const resolved = await resolveTaskForComments(pool, taskId, userId);
      if (!resolved) {
        return res.status(404).json({ error: 'Task not found' });
      }

      // Create comment
      const result = await pool.query(
        `INSERT INTO task_comments (task_id, user_id, emoji, text, occurrence_date)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING 
           id,
           task_id,
           user_id,
           emoji,
           text,
           occurrence_date,
           created_at`,
          [resolved.commentTaskId, userId, emoji.slice(0, 10), text.trim(), resolved.occurrenceDate]
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
