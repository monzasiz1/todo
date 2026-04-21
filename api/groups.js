const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');
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

  // Helper: generate unique invite code
  function generateInviteCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
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
      const result = await pool.query(
        `SELECT g.*, gm.role,
          (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count,
          (SELECT COUNT(*) FROM group_tasks WHERE group_id = g.id) as task_count
         FROM groups g
         JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
         ORDER BY g.updated_at DESC`,
        [user.id]
      );
      return res.json({ groups: result.rows });
    } catch (err) {
      console.error('List groups error:', err);
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
           u.name as creator_name, u.avatar_color as creator_color, u.avatar_url as creator_avatar_url,
           gt.created_at as added_to_group_at
         FROM group_tasks gt
         JOIN tasks t ON t.id = gt.task_id
         LEFT JOIN categories c ON t.category_id = c.id
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

      const { existing_task_id, title, description, date, date_end, time, time_end, priority, category_id, reminder_at } = req.body;

      let task;

      if (existing_task_id) {
        // Link an existing task to this group
        const existing = await pool.query('SELECT * FROM tasks WHERE id = $1 AND user_id = $2', [existing_task_id, user.id]);
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
            'INSERT INTO group_tasks (group_id, task_id, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [groupId, tid, user.id]
          );
        }
      } else {
        if (!title) return res.status(400).json({ error: 'Titel erforderlich' });

        // Create the task owned by the user
        const taskResult = await pool.query(
          `INSERT INTO tasks (user_id, title, description, date, date_end, time, time_end, priority, category_id, reminder_at, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             (SELECT COALESCE(MAX(sort_order),0)+1 FROM tasks WHERE user_id = $1))
           RETURNING *`,
          [user.id, title.trim(), description || null, date || null, date_end || null,
           time || null, time_end || null, priority || 'medium', category_id || null, reminder_at || null]
        );
        task = taskResult.rows[0];

        // Link to group
        await pool.query(
          'INSERT INTO group_tasks (group_id, task_id, created_by) VALUES ($1, $2, $3)',
          [groupId, task.id, user.id]
        );
      }

      await pool.query('UPDATE groups SET updated_at = NOW() WHERE id = $1', [groupId]);

      // Get creator info
      const creatorResult = await pool.query('SELECT name, avatar_color FROM users WHERE id = $1', [user.id]);
      const creator = creatorResult.rows[0];

      return res.status(201).json({
        task: { ...task, creator_name: creator.name, creator_color: creator.avatar_color, group_id: groupId }
      });
    } catch (err) {
      console.error('Add group task error:', err);
      return res.status(500).json({ error: 'Fehler beim Erstellen der Aufgabe' });
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
      if (!membership || membership.role === 'member') {
        return res.status(403).json({ error: 'Keine Berechtigung' });
      }

      const { role } = req.body;
      if (!['admin', 'member'].includes(role)) {
        return res.status(400).json({ error: 'Ungültige Rolle' });
      }
      // Only owner can change to admin
      if (role === 'admin' && membership.role !== 'owner') {
        return res.status(403).json({ error: 'Nur der Ersteller kann Admins ernennen' });
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
                m.edited_at, m.is_poll, m.poll_options,
                u.name as sender_name, u.avatar_color as sender_color, u.avatar_url as sender_avatar
         FROM group_messages m
         JOIN users u ON u.id = m.user_id
         WHERE m.group_id = $1
         ORDER BY m.created_at ASC
         LIMIT 200`,
        [groupId]
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
