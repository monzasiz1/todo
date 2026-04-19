const { getPool } = require('./_lib/db');
const { verifyToken, cors } = require('./_lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const subPath = req.query.__path || '';
  const segments = subPath.split('/').filter(Boolean);
  const pool = getPool();

  // GET /api/friends — list all friends (accepted + pending)
  if (segments.length === 0 && req.method === 'GET') {
    try {
      const result = await pool.query(
        `SELECT f.id, f.status, f.created_at,
           CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END as friend_user_id,
           CASE WHEN f.user_id = $1 THEN 'outgoing' ELSE 'incoming' END as direction,
           u.name, u.email, u.avatar_color, u.avatar_url
         FROM friends f
         JOIN users u ON u.id = CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
         WHERE (f.user_id = $1 OR f.friend_id = $1)
         AND f.status != 'declined'
         ORDER BY f.status ASC, u.name ASC`,
        [user.id]
      );
      return res.json({ friends: result.rows });
    } catch (err) {
      console.error('Friends list error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden der Freunde' });
    }
  }

  // POST /api/friends/invite — invite by email
  if (segments[0] === 'invite' && req.method === 'POST') {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'E-Mail erforderlich' });

      if (email.toLowerCase() === user.email?.toLowerCase()) {
        return res.status(400).json({ error: 'Du kannst dich nicht selbst einladen' });
      }

      // Find user by email
      const friendUser = await pool.query(
        'SELECT id, name, email, avatar_color, avatar_url FROM users WHERE LOWER(email) = LOWER($1)',
        [email]
      );
      if (friendUser.rows.length === 0) {
        return res.status(404).json({ error: 'Kein Nutzer mit dieser E-Mail gefunden' });
      }

      const friendId = friendUser.rows[0].id;

      // Check if already friends
      const existing = await pool.query(
        `SELECT id, status FROM friends
         WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
        [user.id, friendId]
      );

      if (existing.rows.length > 0) {
        const s = existing.rows[0].status;
        if (s === 'accepted') return res.status(400).json({ error: 'Ihr seid bereits befreundet' });
        if (s === 'pending') return res.status(400).json({ error: 'Anfrage bereits gesendet' });
      }

      // Generate invite code
      const code = Math.random().toString(36).substring(2, 10).toUpperCase();

      const result = await pool.query(
        `INSERT INTO friends (user_id, friend_id, status, invite_code)
         VALUES ($1, $2, 'pending', $3)
         RETURNING *`,
        [user.id, friendId, code]
      );

      return res.status(201).json({
        friend: {
          ...result.rows[0],
          friend_name: friendUser.rows[0].name,
          friend_email: friendUser.rows[0].email,
          avatar_color: friendUser.rows[0].avatar_color,
          avatar_url: friendUser.rows[0].avatar_url,
        },
      });
    } catch (err) {
      console.error('Friend invite error:', err);
      return res.status(500).json({ error: 'Fehler beim Einladen' });
    }
  }

  // POST /api/friends/invite-code — invite by code
  if (segments[0] === 'invite-code' && req.method === 'POST') {
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ error: 'Einladungscode erforderlich' });

      const invite = await pool.query(
        `SELECT f.*, u.name as inviter_name FROM friends f
         JOIN users u ON u.id = f.user_id
         WHERE f.invite_code = $1 AND f.status = 'pending'`,
        [code.toUpperCase()]
      );

      if (invite.rows.length === 0) {
        return res.status(404).json({ error: 'Ungültiger oder abgelaufener Code' });
      }

      const inv = invite.rows[0];
      if (inv.friend_id !== user.id && inv.user_id !== user.id) {
        return res.status(403).json({ error: 'Dieser Code ist nicht für dich' });
      }

      await pool.query(
        "UPDATE friends SET status = 'accepted' WHERE id = $1",
        [inv.id]
      );

      return res.json({ message: `Du bist jetzt mit ${inv.inviter_name} befreundet!` });
    } catch (err) {
      console.error('Invite code error:', err);
      return res.status(500).json({ error: 'Fehler beim Einlösen' });
    }
  }

  // PATCH /api/friends/:id/accept
  if (segments.length === 2 && segments[1] === 'accept' && req.method === 'PATCH') {
    try {
      const friendshipId = segments[0];
      const result = await pool.query(
        `UPDATE friends SET status = 'accepted'
         WHERE id = $1 AND friend_id = $2 AND status = 'pending'
         RETURNING *`,
        [friendshipId, user.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Anfrage nicht gefunden' });
      }
      return res.json({ friend: result.rows[0] });
    } catch (err) {
      console.error('Accept error:', err);
      return res.status(500).json({ error: 'Fehler beim Annehmen' });
    }
  }

  // PATCH /api/friends/:id/decline
  if (segments.length === 2 && segments[1] === 'decline' && req.method === 'PATCH') {
    try {
      const friendshipId = segments[0];
      const result = await pool.query(
        `UPDATE friends SET status = 'declined'
         WHERE id = $1 AND friend_id = $2 AND status = 'pending'
         RETURNING *`,
        [friendshipId, user.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Anfrage nicht gefunden' });
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('Decline error:', err);
      return res.status(500).json({ error: 'Fehler beim Ablehnen' });
    }
  }

  // DELETE /api/friends/:id — remove friend
  if (segments.length === 1 && req.method === 'DELETE') {
    try {
      const friendshipId = segments[0];
      const result = await pool.query(
        `DELETE FROM friends WHERE id = $1
         AND (user_id = $2 OR friend_id = $2)
         RETURNING id`,
        [friendshipId, user.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Freundschaft nicht gefunden' });
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('Delete friend error:', err);
      return res.status(500).json({ error: 'Fehler beim Entfernen' });
    }
  }

  return res.status(404).json({ error: 'Route nicht gefunden' });
};
