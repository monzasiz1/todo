const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');
const { sendPushToUser } = require('./_lib/pushService');

function parseVirtualId(id) {
  if (typeof id !== 'string' || !id.startsWith('v_')) return null;
  const parts = id.split('_');
  if (parts.length < 3) return null;
  const date = parts[parts.length - 1];
  const parentId = parts.slice(1, -1).join('_');
  if (!parentId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { parentId, date };
}

function toIsoDateStr(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().substring(0, 10);
  return String(value).substring(0, 10);
}

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const iso = value.toISOString().split('T')[0];
    return new Date(`${iso}T00:00:00`);
  }
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
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const subPath = req.query.__path || '';
  const segments = subPath.split('/').filter(Boolean);
  const pool = getPool();

  // Helper: check if user is member of a group
  async function getMembership(groupId) {
    const r = await pool.query(
      'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, user.id]
    );
    return r.rows[0] || null;
  }

  async function isGroupNotificationEnabled(userId, type) {
    try {
      const { rows } = await pool.query('SELECT notification_prefs FROM users WHERE id = $1', [userId]);
      let prefs = rows[0]?.notification_prefs || {};
      if (typeof prefs === 'string') {
        try {
          prefs = JSON.parse(prefs);
        } catch {
          prefs = {};
        }
      }
      return prefs[type] !== false;
    } catch {
      return true;
    }
  }

  async function notifyGroupMembers(groupId, actorUserId, payloadBuilder) {
    const membersResult = await pool.query(
      `SELECT gm.user_id
       FROM group_members gm
       WHERE gm.group_id = $1 AND gm.user_id != $2`,
      [groupId, actorUserId]
    );

    for (const member of membersResult.rows) {
      const payload = payloadBuilder(member.user_id);
      if (!payload) continue;
      const enabled = await isGroupNotificationEnabled(member.user_id, payload.prefKey || payload.type);
      if (!enabled) continue;

      await sendPushToUser(
        member.user_id,
        {
          title: payload.title,
          body: payload.body,
          tag: payload.tag,
          url: payload.url || '/groups',
        },
        payload.type,
        payload.taskId || null,
        groupId
      ).catch(() => null);
    }
  }

  // Helper: generate unique invite code
  function generateInviteCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
  }

  async function loadMessageWithMeta(groupId, messageId) {
    const result = await pool.query(
      `SELECT m.id, m.group_id, m.user_id, m.content, m.is_pinned, m.pinned_at, m.created_at,
              m.edited_at, m.is_poll, m.poll_options, m.message_type, m.linked_task_id,
              m.responsible_user_id, m.responsible_role,
              u.name as sender_name, u.avatar_color as sender_color, u.avatar_url as sender_avatar,
              ru.name as responsible_name,
              t.title as linked_task_title, t.date as linked_task_date, t.time as linked_task_time,
              t.time_end as linked_task_time_end, t.description as linked_task_description, t.type as linked_task_type,
              (t.date + COALESCE(t.time_end, t.time, TIME '23:59')) as linked_task_ends_at,
              (COALESCE(t.date + COALESCE(t.time_end, t.time, TIME '23:59'), NOW() + INTERVAL '100 years') < NOW()) as linked_task_ended,
              (SELECT COUNT(*)::int FROM group_event_rsvps r WHERE r.message_id = m.id AND r.status = 'yes') as rsvp_yes_count,
              (SELECT COUNT(*)::int FROM group_event_rsvps r WHERE r.message_id = m.id AND r.status = 'maybe') as rsvp_maybe_count,
              (SELECT COUNT(*)::int FROM group_event_rsvps r WHERE r.message_id = m.id AND r.status = 'no') as rsvp_no_count,
              (SELECT status FROM group_event_rsvps r WHERE r.message_id = m.id AND r.user_id = $3 LIMIT 1) as my_rsvp,
              (SELECT COALESCE(json_agg(json_build_object('name', u2.name, 'avatar_color', u2.avatar_color, 'avatar_url', u2.avatar_url) ORDER BY r2.updated_at ASC), '[]'::json)
               FROM group_event_rsvps r2 JOIN users u2 ON u2.id = r2.user_id
               WHERE r2.message_id = m.id AND r2.status = 'yes') as rsvp_yes_users,
              (SELECT COALESCE(json_agg(json_build_object('name', u2.name, 'avatar_color', u2.avatar_color, 'avatar_url', u2.avatar_url) ORDER BY r2.updated_at ASC), '[]'::json)
               FROM group_event_rsvps r2 JOIN users u2 ON u2.id = r2.user_id
               WHERE r2.message_id = m.id AND r2.status = 'no') as rsvp_no_users
       FROM group_messages m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN users ru ON ru.id = m.responsible_user_id
       LEFT JOIN tasks t ON t.id = m.linked_task_id
       WHERE m.group_id = $1 AND m.id = $2
       LIMIT 1`,
      [groupId, messageId, user.id]
    );
    return result.rows[0] || null;
  }

  async function inheritTaskRelations(parentId, concreteTaskId) {
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

  async function materializeOccurrence(parentId, date) {
    const existing = await pool.query(
      `SELECT * FROM tasks WHERE recurrence_parent_id = $1 AND date::text LIKE $2 AND user_id = $3 LIMIT 1`,
      [parentId, `${date}%`, user.id]
    );
    if (existing.rows.length > 0) {
      await inheritTaskRelations(parentId, existing.rows[0].id);
      return existing.rows[0];
    }

    const parent = await pool.query(
      `SELECT * FROM tasks WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [parentId, user.id]
    );
    if (parent.rows.length === 0) return null;

    const template = parent.rows[0];
    const templateDate = template.date instanceof Date
      ? template.date.toISOString().split('T')[0]
      : String(template.date).substring(0, 10);

    const spanDays = template.date_end
      ? Math.max(0, Math.round(
          (new Date(toIsoDateStr(template.date_end) + 'T00:00:00') -
           new Date(templateDate + 'T00:00:00')) / 86400000
        ))
      : 0;
    const dateEnd = spanDays > 0 ? shiftDate(date, spanDays) : null;

    const maxOrder = await pool.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM tasks WHERE user_id = $1',
      [user.id]
    );

    const inserted = await pool.query(
      `INSERT INTO tasks
         (user_id, title, description, date, date_end, time, time_end, priority,
          category_id, reminder_at, sort_order, visibility, type,
          recurrence_rule, recurrence_interval, recurrence_end, recurrence_parent_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [template.user_id, template.title, template.description, date, dateEnd, template.time, template.time_end,
       template.priority, template.category_id, null, maxOrder.rows[0].next_order,
       template.visibility || 'private', template.type || 'task', template.recurrence_rule,
       template.recurrence_interval || 1, template.recurrence_end, parentId]
    );

    if (inserted.rows[0]?.id) {
      await inheritTaskRelations(parentId, inserted.rows[0].id);
    }
    return inserted.rows[0] || null;
  }

  // ============================================
  // POST /api/groups — Create group
  // ============================================
  if (segments.length === 0 && req.method === 'POST') {
    try {
      const { name, description, color, icon, image_url } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'Gruppenname erforderlich' });

      const inviteCode = generateInviteCode();
      const result = await pool.query(
        `INSERT INTO groups (name, description, color, icon, image_url, invite_code, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [name.trim(), description || '', color || '#007AFF', icon || 'users', image_url || null, inviteCode, user.id]
      );
      const group = result.rows[0];

      // Add creator as owner
      await pool.query(
        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
        [group.id, user.id, 'owner']
      );

      return res.status(201).json({ group: { ...group, role: 'owner', member_count: 1 } });
    } catch (err) {
      console.error('Create group error:', err);
      return res.status(500).json({ error: 'Fehler beim Erstellen der Gruppe' });
    }
  }

  // ============================================
  // GET /api/groups — List my groups
  // ============================================
  if (segments.length === 0 && req.method === 'GET') {
    try {
      const hasGroupTasks = await pool.query(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'group_tasks'
         ) as ok`
      );
      const hasUpdatedAt = await pool.query(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'groups' AND column_name = 'updated_at'
         ) as ok`
      );

      const taskCountExpr = hasGroupTasks.rows[0]?.ok
        ? `(SELECT COUNT(*) FROM group_tasks WHERE group_id = g.id) as task_count`
        : `0::bigint as task_count`;
      const orderExpr = hasUpdatedAt.rows[0]?.ok ? 'g.updated_at DESC' : 'g.id DESC';

      const result = await pool.query(
        `SELECT g.*, gm.role,
          (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count,
          ${taskCountExpr}
         FROM groups g
         JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
         ORDER BY ${orderExpr}`,
        [user.id]
      );
      return res.json({ groups: result.rows });
    } catch (err) {
      console.error('List groups error:', err);
      // Fail-open for partial/missing schema in production:
      // if essential relation is missing, return empty list instead of 500.
      if (err?.code === '42P01' || err?.code === '42703') {
        return res.status(200).json({
          groups: [],
          warning: 'Gruppen-Schema unvollstaendig in DB. Bitte Migration ausfuehren.',
          db_code: err.code,
        });
      }
      return res.status(500).json({ error: 'Fehler beim Laden der Gruppen' });
    }
  }

  // ============================================
  // POST /api/groups/join — Join via invite code
  // ============================================
  if (segments[0] === 'join' && req.method === 'POST') {
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ error: 'Einladungscode erforderlich' });

      const groupResult = await pool.query(
        'SELECT * FROM groups WHERE invite_code = $1',
        [code.trim().toUpperCase()]
      );
      if (groupResult.rows.length === 0) {
        return res.status(404).json({ error: 'Ungültiger Einladungscode' });
      }
      const group = groupResult.rows[0];

      // Check if already member
      const existing = await pool.query(
        'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
        [group.id, user.id]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'Du bist bereits Mitglied dieser Gruppe' });
      }

      await pool.query(
        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
        [group.id, user.id, 'member']
      );

      await pool.query('UPDATE groups SET updated_at = NOW() WHERE id = $1', [group.id]);

      return res.json({ group: { ...group, role: 'member' }, message: `Du bist "${group.name}" beigetreten!` });
    } catch (err) {
      console.error('Join group error:', err);
      return res.status(500).json({ error: 'Fehler beim Beitreten' });
    }
  }

  // ============================================
  // GET /api/groups/:id — Group detail
  // ============================================
  if (segments.length === 1 && req.method === 'GET') {
    try {
      const groupId = segments[0];
      const membership = await getMembership(groupId);
      if (!membership) return res.status(403).json({ error: 'Kein Zugriff auf diese Gruppe' });

      const groupResult = await pool.query('SELECT * FROM groups WHERE id = $1', [groupId]);
      if (groupResult.rows.length === 0) return res.status(404).json({ error: 'Gruppe nicht gefunden' });

      const membersResult = await pool.query(
        `SELECT gm.role, gm.joined_at, u.id as user_id, u.name, u.email, u.avatar_color, u.avatar_url
         FROM group_members gm JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = $1
         ORDER BY CASE gm.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, gm.joined_at`,
        [groupId]
      );

      const tasksResult = await pool.query(
        `SELECT t.*, c.name as category_name, c.color as category_color,
           gt.group_category_id, gc.name as group_category_name, gc.color as group_category_color,
           u.name as creator_name, u.avatar_color as creator_color, u.avatar_url as creator_avatar_url,
           gt.created_at as added_to_group_at
         FROM group_tasks gt
         JOIN tasks t ON t.id = gt.task_id
         LEFT JOIN categories c ON t.category_id = c.id
         LEFT JOIN group_categories gc ON gc.id = gt.group_category_id
         LEFT JOIN users u ON gt.created_by = u.id
         WHERE gt.group_id = $1
         ORDER BY gt.created_at DESC`,
        [groupId]
      );

      return res.json({
        group: groupResult.rows[0],
        members: membersResult.rows,
        tasks: tasksResult.rows,
        myRole: membership.role,
      });
    } catch (err) {
      console.error('Group detail error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden der Gruppe' });
    }
  }

  // ============================================
  // PUT /api/groups/:id — Update group (admin/owner)
  // ============================================
  if (segments.length === 1 && req.method === 'PUT') {
    try {
      const groupId = segments[0];
      const membership = await getMembership(groupId);
      if (!membership || membership.role === 'member') {
        return res.status(403).json({ error: 'Nur Admins können die Gruppe bearbeiten' });
      }
      const { name, description, color, icon, image_url } = req.body;
      const result = await pool.query(
        `UPDATE groups SET name = COALESCE($1, name), description = COALESCE($2, description),
         color = COALESCE($3, color), icon = COALESCE($4, icon), image_url = $5, updated_at = NOW()
         WHERE id = $6 RETURNING *`,
        [name, description, color, icon, image_url || null, groupId]
      );
      return res.json({ group: result.rows[0] });
    } catch (err) {
      console.error('Update group error:', err);
      return res.status(500).json({ error: 'Fehler beim Aktualisieren' });
    }
  }

  // ============================================
  // DELETE /api/groups/:id — Delete group (owner only)
  // ============================================
  if (segments.length === 1 && req.method === 'DELETE') {
    try {
      const groupId = segments[0];
      const membership = await getMembership(groupId);
      if (!membership || membership.role !== 'owner') {
        return res.status(403).json({ error: 'Nur der Ersteller kann die Gruppe löschen' });
      }
      await pool.query('DELETE FROM groups WHERE id = $1', [groupId]);
      return res.json({ success: true });
    } catch (err) {
      console.error('Delete group error:', err);
      return res.status(500).json({ error: 'Fehler beim Löschen' });
    }
  }

  // ============================================
  // GET /api/groups/:id/categories — Shared categories for this group
  // ============================================
  if (segments.length === 2 && segments[1] === 'categories' && req.method === 'GET') {
    try {
      const groupId = segments[0];
      const membership = await getMembership(groupId);
      if (!membership) return res.status(403).json({ error: 'Kein Zugriff auf diese Gruppe' });

      const result = await pool.query(
        `SELECT id, group_id, name, color, created_by, created_at
         FROM group_categories
         WHERE group_id = $1
         ORDER BY name ASC`,
        [groupId]
      );

      return res.json({ categories: result.rows });
    } catch (err) {
      console.error('List group categories error:', err);
      if (err?.code === '42P01' || err?.code === '42703') {
        return res.status(200).json({ categories: [], warning: 'group_categories table fehlt in DB' });
      }
      return res.status(500).json({ error: 'Fehler beim Laden der Gruppenkategorien' });
    }
  }

  // ============================================
  // POST /api/groups/:id/categories — Create shared category (admin/owner)
  // ============================================
  if (segments.length === 2 && segments[1] === 'categories' && req.method === 'POST') {
    try {
      const groupId = segments[0];
      const membership = await getMembership(groupId);
      if (!membership || membership.role === 'member') {
        return res.status(403).json({ error: 'Nur Admins können Gruppenkategorien erstellen' });
      }

      const name = String(req.body?.name || '').trim();
      const color = String(req.body?.color || '#8E8E93').trim() || '#8E8E93';
      if (!name) return res.status(400).json({ error: 'Name erforderlich' });

      const result = await pool.query(
        `INSERT INTO group_categories (group_id, name, color, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (group_id, name) DO UPDATE SET color = EXCLUDED.color
         RETURNING id, group_id, name, color, created_by, created_at`,
        [groupId, name, color, user.id]
      );

      await pool.query('UPDATE groups SET updated_at = NOW() WHERE id = $1', [groupId]);
      return res.status(201).json({ category: result.rows[0] });
    } catch (err) {
      console.error('Create group category error:', err);
      return res.status(500).json({ error: 'Fehler beim Erstellen der Gruppenkategorie' });
    }
  }

  // ============================================
  // PUT /api/groups/:id/categories/:categoryId — Update shared category (admin/owner)
  // ============================================
  if (segments.length === 3 && segments[1] === 'categories' && req.method === 'PUT') {
    try {
      const groupId = segments[0];
      const categoryId = segments[2];
      const membership = await getMembership(groupId);
      if (!membership || membership.role === 'member') {
        return res.status(403).json({ error: 'Nur Admins können Gruppenkategorien bearbeiten' });
      }

      const name = String(req.body?.name || '').trim();
      const color = String(req.body?.color || '#8E8E93').trim() || '#8E8E93';
      if (!name) return res.status(400).json({ error: 'Name erforderlich' });

      const result = await pool.query(
        `UPDATE group_categories SET name = $1, color = $2
         WHERE id = $3 AND group_id = $4
         RETURNING id, group_id, name, color, created_by, created_at`,
        [name, color, categoryId, groupId]
      );

      if (result.rows.length === 0) return res.status(404).json({ error: 'Kategorie nicht gefunden' });
      await pool.query('UPDATE groups SET updated_at = NOW() WHERE id = $1', [groupId]);
      return res.json({ category: result.rows[0] });
    } catch (err) {
      console.error('Update group category error:', err);
      return res.status(500).json({ error: 'Fehler beim Aktualisieren der Gruppenkategorie' });
    }
  }

  // ============================================
  // DELETE /api/groups/:id/categories/:categoryId — Delete shared category (admin/owner)
  // ============================================
  if (segments.length === 3 && segments[1] === 'categories' && req.method === 'DELETE') {
    try {
      const groupId = segments[0];
      const categoryId = segments[2];
      const membership = await getMembership(groupId);
      if (!membership || membership.role === 'member') {
        return res.status(403).json({ error: 'Nur Admins können Gruppenkategorien löschen' });
      }

      await pool.query(
        'DELETE FROM group_categories WHERE id = $1 AND group_id = $2',
        [categoryId, groupId]
      );

      await pool.query('UPDATE groups SET updated_at = NOW() WHERE id = $1', [groupId]);
      return res.json({ success: true });
    } catch (err) {
      console.error('Delete group category error:', err);
      return res.status(500).json({ error: 'Fehler beim Löschen der Gruppenkategorie' });
    }
  }

  // ============================================
  // POST /api/groups/:id/tasks — Add task to group
  // ============================================
  if (segments.length === 2 && segments[1] === 'tasks' && req.method === 'POST') {
    try {
      const groupId = segments[0];
      const membership = await getMembership(groupId);
      if (!membership) return res.status(403).json({ error: 'Kein Zugriff' });
      if (membership.role === 'member') {
        // Members can only add tasks, not restricted further for now
      }

      const { existing_task_id, title, description, date, date_end, time, time_end, priority, category_id, reminder_at, type, group_category_id } = req.body;
      const entryType = type === 'event' ? 'event' : 'task';

      let selectedGroupCategory = null;
      if (group_category_id !== undefined && group_category_id !== null && String(group_category_id) !== '') {
        const gcResult = await pool.query(
          `SELECT id, name, color
           FROM group_categories
           WHERE id = $1 AND group_id = $2
           LIMIT 1`,
          [group_category_id, groupId]
        );
        if (gcResult.rows.length === 0) {
          return res.status(400).json({ error: 'Ungültige Gruppenkategorie' });
        }
        selectedGroupCategory = gcResult.rows[0];
      }

      let task;

      if (existing_task_id) {
        // Link an existing task to this group
        const virtual = parseVirtualId(existing_task_id);
        const resolvedTaskId = virtual ? virtual.parentId : existing_task_id;
        const existing = await pool.query('SELECT * FROM tasks WHERE id = $1 AND user_id = $2', [resolvedTaskId, user.id]);
        if (existing.rows.length === 0) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
        task = existing.rows[0];

        // If recurring: link all instances (parent + children)
        const parentId = task.recurrence_parent_id || task.id;
        const allTaskIds = task.recurrence_rule || task.recurrence_parent_id
          ? (await pool.query(
              'SELECT id FROM tasks WHERE (id = $1 OR recurrence_parent_id = $1) AND user_id = $2',
              [parentId, user.id]
            )).rows.map((r) => r.id)
          : [task.id];

        for (const tid of allTaskIds) {
          await pool.query(
            `INSERT INTO group_tasks (group_id, task_id, created_by, group_category_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (group_id, task_id)
             DO UPDATE SET group_category_id = EXCLUDED.group_category_id`,
            [groupId, tid, user.id, selectedGroupCategory?.id || null]
          );
        }
      } else {
        if (!title) return res.status(400).json({ error: 'Titel erforderlich' });

        // Create the entry (task or event) owned by the user
        const taskResult = await pool.query(
          `INSERT INTO tasks (user_id, title, description, date, date_end, time, time_end, priority, category_id, reminder_at, sort_order, type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             (SELECT COALESCE(MAX(sort_order),0)+1 FROM tasks WHERE user_id = $1), $11)
           RETURNING *`,
          [user.id, title.trim(), description || null, date || null, date_end || null,
           time || null, time_end || null, priority || 'medium', category_id || null, reminder_at || null, entryType]
        );
        task = taskResult.rows[0];

        // Link to group
        await pool.query(
          'INSERT INTO group_tasks (group_id, task_id, created_by, group_category_id) VALUES ($1, $2, $3, $4)',
          [groupId, task.id, user.id, selectedGroupCategory?.id || null]
        );
      }

      await pool.query('UPDATE groups SET updated_at = NOW() WHERE id = $1', [groupId]);

      // Get creator info
      const creatorResult = await pool.query('SELECT name, avatar_color FROM users WHERE id = $1', [user.id]);
      const creator = creatorResult.rows[0];

      let categoryMeta = null;
      if (task?.category_id) {
        const categoryResult = await pool.query(
          'SELECT id, name, color FROM categories WHERE id = $1 LIMIT 1',
          [task.category_id]
        );
        categoryMeta = categoryResult.rows[0] || null;
      }

      return res.status(201).json({
        task: {
          ...task,
          creator_name: creator.name,
          creator_color: creator.avatar_color,
          group_id: groupId,
          group_category_id: selectedGroupCategory?.id || null,
          group_category_name: selectedGroupCategory?.name || null,
          group_category_color: selectedGroupCategory?.color || null,
          category_name: categoryMeta?.name || null,
          category_color: categoryMeta?.color || null,
        }
      });
    } catch (err) {
      console.error('Add group task error:', err);
      return res.status(500).json({ error: 'Fehler beim Erstellen des Eintrags' });
    }
  }

  // ============================================
  // DELETE /api/groups/:id/tasks/:taskId — Remove task from group
  // ============================================
  if (segments.length === 3 && segments[1] === 'tasks' && req.method === 'DELETE') {
    try {
      const groupId = segments[0];
      const taskId = segments[2];
      const membership = await getMembership(groupId);
      if (!membership) return res.status(403).json({ error: 'Kein Zugriff' });

      // Members can only remove their own tasks, admins/owners can remove any
      if (membership.role === 'member') {
        const check = await pool.query(
          'SELECT created_by FROM group_tasks WHERE group_id = $1 AND task_id = $2',
          [groupId, taskId]
        );
        if (check.rows[0]?.created_by !== user.id) {
          return res.status(403).json({ error: 'Du kannst nur eigene Aufgaben entfernen' });
        }
      }

      // If recurring: remove all instances of the series from group
      const taskRow = await pool.query('SELECT recurrence_rule, recurrence_parent_id FROM tasks WHERE id = $1', [taskId]);
      if (taskRow.rows.length > 0) {
        const row = taskRow.rows[0];
        if (row.recurrence_rule || row.recurrence_parent_id) {
          const parentId = row.recurrence_parent_id || taskId;
          const allIds = (await pool.query(
            'SELECT id FROM tasks WHERE id = $1 OR recurrence_parent_id = $1',
            [parentId]
          )).rows.map((r) => r.id);
          await pool.query(
            'DELETE FROM group_tasks WHERE group_id = $1 AND task_id = ANY($2::int[])',
            [groupId, allIds]
          );
          return res.json({ success: true, removed_count: allIds.length });
        }
      }

      await pool.query('DELETE FROM group_tasks WHERE group_id = $1 AND task_id = $2', [groupId, taskId]);
      return res.json({ success: true });
    } catch (err) {
      console.error('Remove group task error:', err);
      return res.status(500).json({ error: 'Fehler beim Entfernen' });
    }
  }

  // ============================================
  // PATCH /api/groups/:id/members/:userId — Change role
  // ============================================
  if (segments.length === 3 && segments[1] === 'members' && req.method === 'PATCH') {
    try {
      const groupId = segments[0];
      const targetUserId = segments[2];
      const membership = await getMembership(groupId);
      if (!membership || membership.role !== 'owner') {
        return res.status(403).json({ error: 'Nur der Ersteller kann Rollen ändern' });
      }

      const { role } = req.body;
      if (!['admin', 'member'].includes(role)) {
        return res.status(400).json({ error: 'Ungültige Rolle' });
      }
      // Can't change owner role
      const target = await pool.query(
        'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, targetUserId]
      );
      if (!target.rows[0]) return res.status(404).json({ error: 'Mitglied nicht gefunden' });
      if (target.rows[0].role === 'owner') return res.status(400).json({ error: 'Owner-Rolle kann nicht geändert werden' });

      await pool.query(
        'UPDATE group_members SET role = $1 WHERE group_id = $2 AND user_id = $3',
        [role, groupId, targetUserId]
      );
      return res.json({ success: true, role });
    } catch (err) {
      console.error('Change role error:', err);
      return res.status(500).json({ error: 'Fehler beim Ändern der Rolle' });
    }
  }

  // ============================================
  // DELETE /api/groups/:id/members/:userId — Remove member or leave
  // ============================================
  if (segments.length === 3 && segments[1] === 'members' && req.method === 'DELETE') {
    try {
      const groupId = segments[0];
      const targetUserId = segments[2];
      const membership = await getMembership(groupId);
      if (!membership) return res.status(403).json({ error: 'Kein Zugriff' });

      const isSelf = targetUserId === user.id;
      const target = await pool.query(
        'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, targetUserId]
      );
      if (!target.rows[0]) return res.status(404).json({ error: 'Mitglied nicht gefunden' });

      // Owner can't be removed
      if (target.rows[0].role === 'owner' && !isSelf) {
        return res.status(400).json({ error: 'Der Ersteller kann nicht entfernt werden' });
      }
      // Owner leaving = delete group
      if (target.rows[0].role === 'owner' && isSelf) {
        await pool.query('DELETE FROM groups WHERE id = $1', [groupId]);
        return res.json({ success: true, dissolved: true });
      }
      // Members can only remove themselves
      if (membership.role === 'member' && !isSelf) {
        return res.status(403).json({ error: 'Keine Berechtigung' });
      }

      // Admins can remove members, but not other admins/owner
      if (membership.role === 'admin' && !isSelf && target.rows[0].role !== 'member') {
        return res.status(403).json({ error: 'Admins können nur Mitglieder entfernen' });
      }

      await pool.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, targetUserId]);
      return res.json({ success: true });
    } catch (err) {
      console.error('Remove member error:', err);
      return res.status(500).json({ error: 'Fehler beim Entfernen' });
    }
  }

  // ============================================
  // GET /api/groups/:id/messages — Load chat messages
  // ============================================
  if (segments.length === 2 && segments[1] === 'messages' && req.method === 'GET') {
    try {
      const groupId = segments[0];
      const membership = await getMembership(groupId);
      if (!membership) return res.status(403).json({ error: 'Kein Zugriff' });

      const result = await pool.query(
        `SELECT m.id, m.group_id, m.user_id, m.content, m.is_pinned, m.pinned_at, m.created_at,
                m.edited_at, m.is_poll, m.poll_options, m.message_type, m.linked_task_id,
                m.responsible_user_id, m.responsible_role,
                u.name as sender_name, u.avatar_color as sender_color, u.avatar_url as sender_avatar,
                ru.name as responsible_name,
                t.title as linked_task_title, t.date as linked_task_date, t.time as linked_task_time,
          t.time_end as linked_task_time_end, t.description as linked_task_description, t.type as linked_task_type,
          (t.date + COALESCE(t.time_end, t.time, TIME '23:59')) as linked_task_ends_at,
          (COALESCE(t.date + COALESCE(t.time_end, t.time, TIME '23:59'), NOW() + INTERVAL '100 years') < NOW()) as linked_task_ended,
                (SELECT COUNT(*)::int FROM group_event_rsvps r WHERE r.message_id = m.id AND r.status = 'yes') as rsvp_yes_count,
                (SELECT COUNT(*)::int FROM group_event_rsvps r WHERE r.message_id = m.id AND r.status = 'maybe') as rsvp_maybe_count,
                (SELECT COUNT(*)::int FROM group_event_rsvps r WHERE r.message_id = m.id AND r.status = 'no') as rsvp_no_count,
                (SELECT status FROM group_event_rsvps r WHERE r.message_id = m.id AND r.user_id = $2 LIMIT 1) as my_rsvp,
                (SELECT COALESCE(json_agg(json_build_object('name', u2.name, 'avatar_color', u2.avatar_color, 'avatar_url', u2.avatar_url) ORDER BY r2.updated_at ASC), '[]'::json)
                 FROM group_event_rsvps r2 JOIN users u2 ON u2.id = r2.user_id
                 WHERE r2.message_id = m.id AND r2.status = 'yes') as rsvp_yes_users,
                (SELECT COALESCE(json_agg(json_build_object('name', u2.name, 'avatar_color', u2.avatar_color, 'avatar_url', u2.avatar_url) ORDER BY r2.updated_at ASC), '[]'::json)
                 FROM group_event_rsvps r2 JOIN users u2 ON u2.id = r2.user_id
                 WHERE r2.message_id = m.id AND r2.status = 'no') as rsvp_no_users
         FROM group_messages m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN users ru ON ru.id = m.responsible_user_id
         LEFT JOIN tasks t ON t.id = m.linked_task_id
         WHERE m.group_id = $1
         ORDER BY m.created_at ASC
         LIMIT 200`,
        [groupId, user.id]
      );

      const messages = result.rows;

      // Enrich poll messages with vote counts + current user's votes
      const pollIds = messages.filter(m => m.is_poll).map(m => m.id);
      if (pollIds.length > 0) {
        const votesRes = await pool.query(
          `SELECT message_id, option_id, COUNT(*) as vote_count,
                  BOOL_OR(user_id = $2) as user_voted
           FROM group_poll_votes
           WHERE message_id = ANY($1::bigint[])
           GROUP BY message_id, option_id`,
          [pollIds, user.id]
        );
        const voteMap = {};
        for (const row of votesRes.rows) {
          if (!voteMap[row.message_id]) voteMap[row.message_id] = {};
          voteMap[row.message_id][row.option_id] = {
            count: parseInt(row.vote_count, 10),
            user_voted: row.user_voted,
          };
        }
        for (const msg of messages) {
          if (msg.is_poll) msg.vote_data = voteMap[msg.id] || {};
        }
      }

      return res.json({ messages });
    } catch (err) {
      console.error('Get messages error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden der Nachrichten' });
    }
  }

  // ============================================
  // POST /api/groups/:id/messages/share-task — Share event/task card to chat
  // ============================================
  if (segments.length === 3 && segments[1] === 'messages' && segments[2] === 'share-task' && req.method === 'POST') {
    try {
      const groupId = segments[0];
      const membership = await getMembership(groupId);
      if (!membership) return res.status(403).json({ error: 'Kein Zugriff' });

      let { task_id, with_rsvp } = req.body;
      if (!task_id) return res.status(400).json({ error: 'task_id fehlt' });

      const virtual = parseVirtualId(task_id);
      if (virtual) {
        const concreteTask = await materializeOccurrence(virtual.parentId, virtual.date);
        if (!concreteTask) return res.status(404).json({ error: 'Termin nicht gefunden' });
        task_id = String(concreteTask.id);
      }

      const taskResult = await pool.query(
        `SELECT t.id, t.title, t.date, t.time, t.time_end, t.description, t.type, t.enable_group_rsvp,
                gt.group_id
         FROM tasks t
         LEFT JOIN group_tasks gt ON gt.task_id = t.id AND gt.group_id = $2
         WHERE t.id = $1
         LIMIT 1`,
        [task_id, groupId]
      );
      if (taskResult.rows.length === 0) return res.status(404).json({ error: 'Termin nicht gefunden' });

      const task = taskResult.rows[0];
      if (task.group_id !== Number(groupId)) {
        return res.status(403).json({ error: 'Dieser Termin gehoert nicht zu dieser Gruppe' });
      }

      const isEventTask = String(task.type || '').toLowerCase() === 'event';
      const messageType = isEventTask
        ? 'group_event'
        : ((with_rsvp === true || task.enable_group_rsvp === true) ? 'group_task_rsvp' : 'group_task');
      const content = task.title || (messageType === 'group_event' ? 'Gruppen-Termin' : 'Gruppen-Aufgabe');
      const ins = await pool.query(
        `INSERT INTO group_messages (group_id, user_id, content, message_type, linked_task_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [groupId, user.id, content, messageType, task.id]
      );

      await pool.query('UPDATE groups SET updated_at = NOW() WHERE id = $1', [groupId]);

      const message = await loadMessageWithMeta(groupId, ins.rows[0].id);

      const groupMeta = await pool.query('SELECT name FROM groups WHERE id = $1 LIMIT 1', [groupId]);
      const groupName = groupMeta.rows[0]?.name || 'Gruppe';
      await notifyGroupMembers(groupId, user.id, () => ({
        type: 'group_message',
        prefKey: 'group_message',
        title: `Neue Nachricht in ${groupName}`,
        body: content.slice(0, 120),
        tag: `group-msg-${groupId}-${message.id}`,
        url: '/groups',
        taskId: task.id,
      }));

      return res.status(201).json({ message });
    } catch (err) {
      console.error('Share task to chat error:', err);
      return res.status(500).json({ error: 'Fehler beim Teilen in den Chat' });
    }
  }

  // ============================================
  // POST /api/groups/:id/messages/:msgId/claim — Take responsibility
  // ============================================
  if (segments.length === 4 && segments[1] === 'messages' && segments[3] === 'claim' && req.method === 'POST') {
    try {
      const groupId = segments[0];
      const msgId = segments[2];
      const membership = await getMembership(groupId);
      if (!membership) return res.status(403).json({ error: 'Kein Zugriff' });

      const role = String(req.body?.role || 'organizer').toLowerCase();
      const allowed = ['organizer', 'participant', 'watcher'];
      const finalRole = allowed.includes(role) ? role : 'organizer';

      const endedCheck = await pool.query(
        `SELECT (COALESCE(t.date + COALESCE(t.time_end, t.time, TIME '23:59'), NOW() + INTERVAL '100 years') < NOW()) as is_ended
         FROM group_messages m
         LEFT JOIN tasks t ON t.id = m.linked_task_id
         WHERE m.id = $1 AND m.group_id = $2 AND m.message_type = 'group_event'
         LIMIT 1`,
        [msgId, groupId]
      );
      if (endedCheck.rows.length === 0) return res.status(404).json({ error: 'Termin-Nachricht nicht gefunden' });
      if (endedCheck.rows[0].is_ended) {
        return res.status(400).json({ error: 'Termin ist bereits beendet' });
      }

      const updated = await pool.query(
        `UPDATE group_messages
         SET responsible_user_id = $1, responsible_role = $2
         WHERE id = $3 AND group_id = $4 AND message_type = 'group_event'
         RETURNING id`,
        [user.id, finalRole, msgId, groupId]
      );
      if (updated.rows.length === 0) return res.status(404).json({ error: 'Termin-Nachricht nicht gefunden' });

      const message = await loadMessageWithMeta(groupId, msgId);
      return res.json({ message });
    } catch (err) {
      console.error('Claim event error:', err);
      return res.status(500).json({ error: 'Fehler beim Uebernehmen' });
    }
  }

  // ============================================
  // POST /api/groups/:id/messages/:msgId/rsvp — RSVP toggle
  // ============================================
  if (segments.length === 4 && segments[1] === 'messages' && segments[3] === 'rsvp' && req.method === 'POST') {
    try {
      const groupId = segments[0];
      const msgId = segments[2];
      const membership = await getMembership(groupId);
      if (!membership) return res.status(403).json({ error: 'Kein Zugriff' });

      const status = String(req.body?.status || 'yes').toLowerCase();
      const allowed = ['yes', 'maybe', 'no'];
      if (!allowed.includes(status)) return res.status(400).json({ error: 'Ungueltiger RSVP-Status' });

      const msgCheck = await pool.query(
        `SELECT m.id,
                (COALESCE(t.date + COALESCE(t.time_end, t.time, TIME '23:59'), NOW() + INTERVAL '100 years') < NOW()) as is_ended
         FROM group_messages m
         LEFT JOIN tasks t ON t.id = m.linked_task_id
         WHERE m.id = $1 AND m.group_id = $2 AND m.message_type IN ('group_event', 'group_task_rsvp')
         LIMIT 1`,
        [msgId, groupId]
      );
      if (msgCheck.rows.length === 0) return res.status(404).json({ error: 'Abstimmungs-Nachricht nicht gefunden' });
      if (msgCheck.rows[0].is_ended) {
        return res.status(400).json({ error: 'Termin ist bereits beendet' });
      }

      await pool.query(
        `INSERT INTO group_event_rsvps (message_id, group_id, user_id, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (message_id, user_id)
         DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
        [msgId, groupId, user.id, status]
      );

      const message = await loadMessageWithMeta(groupId, msgId);
      return res.json({ message });
    } catch (err) {
      console.error('RSVP event error:', err);
      return res.status(500).json({ error: 'Fehler bei der Zusage' });
    }
  }

  // ============================================
  // POST /api/groups/:id/polls — Create a poll message
  // ============================================
  if (segments.length === 2 && segments[1] === 'polls' && req.method === 'POST') {
    try {
      const groupId = segments[0];
      const membership = await getMembership(groupId);
      if (!membership) return res.status(403).json({ error: 'Kein Zugriff' });

      const { question, options } = req.body;
      if (!question || typeof question !== 'string' || !question.trim()) {
        return res.status(400).json({ error: 'Frage fehlt' });
      }
      if (!Array.isArray(options) || options.length < 2 || options.length > 6) {
        return res.status(400).json({ error: 'Bitte 2–6 Optionen angeben' });
      }
      const cleanOptions = options
        .map((o, i) => ({ id: String(i + 1), label: String(o).trim() }))
        .filter(o => o.label.length > 0);
      if (cleanOptions.length < 2) return res.status(400).json({ error: 'Mindestens 2 gültige Optionen erforderlich' });

      const result = await pool.query(
        `INSERT INTO group_messages (group_id, user_id, content, is_poll, poll_options)
         VALUES ($1, $2, $3, true, $4)
         RETURNING *`,
        [groupId, user.id, question.trim(), JSON.stringify(cleanOptions)]
      );
      const sender = await pool.query('SELECT name, avatar_color, avatar_url FROM users WHERE id = $1', [user.id]);
      const s = sender.rows[0] || {};
      return res.status(201).json({
        message: {
          ...result.rows[0],
          sender_name: s.name,
          sender_color: s.avatar_color,
          sender_avatar: s.avatar_url,
          vote_data: {},
        },
      });
    } catch (err) {
      console.error('Create poll error:', err);
      return res.status(500).json({ error: 'Fehler beim Erstellen der Umfrage' });
    }
  }

  // ============================================
  // POST /api/groups/:id/polls/:msgId/vote — Toggle vote
  // ============================================
  if (segments.length === 4 && segments[1] === 'polls' && segments[3] === 'vote' && req.method === 'POST') {
    try {
      const groupId = segments[0];
      const msgId = segments[2];
      const membership = await getMembership(groupId);
      if (!membership) return res.status(403).json({ error: 'Kein Zugriff' });

      const { optionId } = req.body;
      if (!optionId) return res.status(400).json({ error: 'optionId fehlt' });

      // Toggle: if already voted, remove; else insert
      const existing = await pool.query(
        'SELECT id FROM group_poll_votes WHERE message_id = $1 AND user_id = $2 AND option_id = $3',
        [msgId, user.id, optionId]
      );
      if (existing.rows.length > 0) {
        await pool.query('DELETE FROM group_poll_votes WHERE id = $1', [existing.rows[0].id]);
      } else {
        await pool.query(
          'INSERT INTO group_poll_votes (message_id, group_id, user_id, option_id) VALUES ($1, $2, $3, $4)',
          [msgId, groupId, user.id, optionId]
        );
      }

      // Return updated vote counts
      const votes = await pool.query(
        `SELECT option_id, COUNT(*) as vote_count, BOOL_OR(user_id = $2) as user_voted
         FROM group_poll_votes WHERE message_id = $1 GROUP BY option_id`,
        [msgId, user.id]
      );
      const voteData = {};
      for (const row of votes.rows) {
        voteData[row.option_id] = { count: parseInt(row.vote_count, 10), user_voted: row.user_voted };
      }
      return res.json({ vote_data: voteData });
    } catch (err) {
      console.error('Vote error:', err);
      return res.status(500).json({ error: 'Fehler beim Abstimmen' });
    }
  }

  // ============================================
  // POST /api/groups/:id/messages — Send a message
  // ============================================
  if (segments.length === 2 && segments[1] === 'messages' && req.method === 'POST') {
    try {
      const groupId = segments[0];
      const membership = await getMembership(groupId);
      if (!membership) return res.status(403).json({ error: 'Kein Zugriff' });

      const { content } = req.body;
      if (!content || !content.trim()) return res.status(400).json({ error: 'Nachricht darf nicht leer sein' });
      if (content.trim().length > 2000) return res.status(400).json({ error: 'Nachricht zu lang (max. 2000 Zeichen)' });

      const result = await pool.query(
        `INSERT INTO group_messages (group_id, user_id, content)
         VALUES ($1, $2, $3) RETURNING *`,
        [groupId, user.id, content.trim()]
      );
      const msg = result.rows[0];

      const senderResult = await pool.query(
        'SELECT name, avatar_color, avatar_url FROM users WHERE id = $1',
        [user.id]
      );
      const sender = senderResult.rows[0];

      await pool.query('UPDATE groups SET updated_at = NOW() WHERE id = $1', [groupId]);

      const groupMeta = await pool.query('SELECT name FROM groups WHERE id = $1 LIMIT 1', [groupId]);
      const groupName = groupMeta.rows[0]?.name || 'Gruppe';
      const preview = content.trim().slice(0, 120);

      await notifyGroupMembers(groupId, user.id, () => ({
        type: 'group_message',
        prefKey: 'group_message',
        title: `Neue Nachricht in ${groupName}`,
        body: `${sender.name}: ${preview}`,
        tag: `group-msg-${groupId}-${msg.id}`,
        url: '/groups',
      }));
      // Note: no taskId for plain text messages - only group_id is passed via notifyGroupMembers

      return res.status(201).json({
        message: {
          ...msg,
          sender_name: sender.name,
          sender_color: sender.avatar_color,
          sender_avatar: sender.avatar_url,
        },
      });
    } catch (err) {
      console.error('Send message error:', err);
      return res.status(500).json({ error: 'Fehler beim Senden der Nachricht' });
    }
  }

  // ============================================
  // PATCH /api/groups/:id/messages/:msgId — Edit own message
  // ============================================
  if (segments.length === 3 && segments[1] === 'messages' && req.method === 'PATCH') {
    try {
      const groupId = segments[0];
      const msgId = segments[2];
      const membership = await getMembership(groupId);
      if (!membership) return res.status(403).json({ error: 'Kein Zugriff' });

      const { content } = req.body;
      if (!content || typeof content !== 'string' || content.trim().length === 0 || content.length > 2000) {
        return res.status(400).json({ error: 'Ungültiger Nachrichteninhalt' });
      }

      // Only the author can edit
      const result = await pool.query(
        `UPDATE group_messages
         SET content = $1, edited_at = NOW()
         WHERE id = $2 AND group_id = $3 AND user_id = $4
         RETURNING *`,
        [content.trim(), msgId, groupId, user.id]
      );

      if (result.rows.length === 0) return res.status(403).json({ error: 'Nachricht nicht gefunden oder kein Zugriff' });

      return res.json({ message: result.rows[0] });
    } catch (err) {
      console.error('Edit message error:', err);
      return res.status(500).json({ error: 'Fehler beim Bearbeiten der Nachricht' });
    }
  }

  // ============================================
  // DELETE /api/groups/:id/messages/:msgId — Delete own message
  // ============================================
  if (segments.length === 3 && segments[1] === 'messages' && req.method === 'DELETE') {
    try {
      const groupId = segments[0];
      const msgId = segments[2];
      const membership = await getMembership(groupId);
      if (!membership) return res.status(403).json({ error: 'Kein Zugriff' });

      // Only the author can delete
      const result = await pool.query(
        `DELETE FROM group_messages WHERE id = $1 AND group_id = $2 AND user_id = $3 RETURNING id`,
        [msgId, groupId, user.id]
      );

      if (result.rows.length === 0) return res.status(403).json({ error: 'Nachricht nicht gefunden oder kein Zugriff' });

      return res.json({ success: true });
    } catch (err) {
      console.error('Delete message error:', err);
      return res.status(500).json({ error: 'Fehler beim Löschen der Nachricht' });
    }
  }

  // ============================================
  // PATCH /api/groups/:id/messages/:msgId/pin — Pin/unpin message
  // ============================================
  if (segments.length === 4 && segments[1] === 'messages' && segments[3] === 'pin' && req.method === 'PATCH') {
    try {
      const groupId = segments[0];
      const msgId = segments[2];
      const membership = await getMembership(groupId);
      if (!membership) return res.status(403).json({ error: 'Kein Zugriff' });

      const { pinned } = req.body;

      const result = await pool.query(
        `UPDATE group_messages
         SET is_pinned = $1, pinned_at = $2, pinned_by = $3
         WHERE id = $4 AND group_id = $5
         RETURNING *`,
        [pinned, pinned ? new Date() : null, pinned ? user.id : null, msgId, groupId]
      );

      if (result.rows.length === 0) return res.status(404).json({ error: 'Nachricht nicht gefunden' });

      return res.json({ message: result.rows[0] });
    } catch (err) {
      console.error('Pin message error:', err);
      return res.status(500).json({ error: 'Fehler beim Anpinnen' });
    }
  }

  return res.status(404).json({ error: 'Route nicht gefunden' });
};
