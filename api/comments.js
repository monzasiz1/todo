const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

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

      // Check if task exists and user has access
      const taskResult = await pool.query(
        'SELECT user_id FROM tasks WHERE id = $1',
        [taskId]
      );
      
      if (taskResult.rows.length === 0) {
        return res.status(404).json({ error: 'Task not found' });
      }

      const task = taskResult.rows[0];

      // Quick check: user owns it
      let hasAccess = task.user_id === userId;

      // If not owner, check if in same group
      if (!hasAccess) {
        const groupResult = await pool.query(
          `SELECT gt.task_id FROM group_tasks gt
           JOIN group_members gm ON gm.group_id = gt.group_id
           WHERE gt.task_id = $1 AND gm.user_id = $2`,
          [taskId, userId]
        );
        hasAccess = groupResult.rows.length > 0;
      }

      if (!hasAccess) {
        return res.status(403).json({ error: 'No access to this task' });
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
        [taskId]
      );

      return res.status(200).json({ comments: result.rows });
    }

    // POST /api/comments - Create a comment
    if (req.method === 'POST') {
      const { taskId, emoji = '💬', text } = req.body;

      if (!taskId || !text || !text.trim()) {
        return res.status(400).json({ error: 'taskId and text required' });
      }

      // Check if task exists and user has access
      const taskResult = await pool.query(
        'SELECT user_id FROM tasks WHERE id = $1',
        [taskId]
      );
      
      if (taskResult.rows.length === 0) {
        return res.status(404).json({ error: 'Task not found' });
      }

      const task = taskResult.rows[0];

      // Quick check: user owns it
      let hasAccess = task.user_id === userId;

      // If not owner, check if in same group
      if (!hasAccess) {
        const groupResult = await pool.query(
          `SELECT gt.task_id FROM group_tasks gt
           JOIN group_members gm ON gm.group_id = gt.group_id
           WHERE gt.task_id = $1 AND gm.user_id = $2`,
          [taskId, userId]
        );
        hasAccess = groupResult.rows.length > 0;
      }

      if (!hasAccess) {
        return res.status(403).json({ error: 'No access to this task' });
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
        [taskId, userId, emoji.slice(0, 10), text.trim()]
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
