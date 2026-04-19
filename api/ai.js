const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');
const { parseTaskWithAI, parsePermissionsWithAI } = require('./_lib/mistral');

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

      const parsed = await parseTaskWithAI(input);
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

      const parsed = await parseTaskWithAI(input);
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

      const result = await pool.query(
        `INSERT INTO tasks (user_id, title, description, date, date_end, time, time_end, priority, category_id, reminder_at, sort_order, visibility)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [user.id, parsed.title, parsed.description || null, parsed.date || null,
         parsed.date_end || null, parsed.time || null, parsed.time_end || null,
         parsed.priority || 'medium', categoryId,
         null, maxOrder.rows[0].next_order, finalVisibility]
      );

      const taskId = result.rows[0].id;

      // Set permissions
      if (permissions && Array.isArray(permissions) && permissions.length > 0) {
        for (const perm of permissions) {
          if (!perm.user_id) continue;
          await pool.query(
            `INSERT INTO task_permissions (task_id, user_id, can_view, can_edit)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (task_id, user_id) DO UPDATE SET can_view = $3, can_edit = $4`,
            [taskId, perm.user_id, perm.can_view !== false, perm.can_edit === true]
          );
        }
      }

      return res.status(201).json({
        task: result.rows[0],
        parsed,
        shared_with: sharedWithNames,
      });
    } catch (err) {
      console.error('AI parse-and-create error:', err);
      return res.status(500).json({ error: 'KI-Erstellung fehlgeschlagen' });
    }
  }

  return res.status(404).json({ error: 'Route nicht gefunden' });
};
