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

function normalizeTaskId(rawTaskId) {
  const virtual = parseVirtualId(rawTaskId);
  return virtual ? parseInt(virtual.parentId, 10) : parseInt(rawTaskId, 10);
}

const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB (base64 = ~5.3MB, within Vercel's 6MB body limit)
const MAX_ATTACHMENTS = 10;
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Support token in query param (for file downloads in new tabs)
  let user = verifyToken(req);
  if (!user && req.query.token) {
    try {
      const jwt = require('jsonwebtoken');
      user = jwt.verify(req.query.token, process.env.JWT_SECRET || 'fallback-dev-secret');
    } catch {}
  }
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  const pool = getPool();
  const subPath = req.query.__path || '';
  const segments = subPath.split('/').filter(Boolean);

  // GET /api/attachments/:taskId – list attachments for a task
  if (segments.length === 1 && req.method === 'GET') {
    const taskId = normalizeTaskId(segments[0]);
    if (isNaN(taskId)) return res.status(400).json({ error: 'Ungültige Task-ID' });

    try {
      const { rows } = await pool.query(
        `SELECT id, task_id, file_name, file_type, file_size, created_at
         FROM task_attachments WHERE task_id = $1 ORDER BY created_at ASC`,
        [taskId]
      );
      return res.json({ attachments: rows });
    } catch (err) {
      console.error('Attachments list error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden' });
    }
  }

  // GET /api/attachments/:taskId/:attachmentId – download a single attachment
  if (segments.length === 2 && req.method === 'GET') {
    const taskId = normalizeTaskId(segments[0]);
    const attachmentId = parseInt(segments[1]);
    if (isNaN(taskId) || isNaN(attachmentId)) return res.status(400).json({ error: 'Ungültige ID' });

    try {
      const { rows } = await pool.query(
        'SELECT file_name, file_type, file_data FROM task_attachments WHERE id = $1 AND task_id = $2',
        [attachmentId, taskId]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Datei nicht gefunden' });

      const file = rows[0];
      const buffer = Buffer.from(file.file_data, 'base64');
      res.setHeader('Content-Type', file.file_type);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.file_name)}"`);
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } catch (err) {
      console.error('Attachment download error:', err);
      return res.status(500).json({ error: 'Fehler beim Laden' });
    }
  }

  // POST /api/attachments/:taskId – upload attachment
  if (segments.length === 1 && req.method === 'POST') {
    const taskId = normalizeTaskId(segments[0]);
    if (isNaN(taskId)) return res.status(400).json({ error: 'Ungültige Task-ID' });

    try {
      // Verify task ownership or edit permission
      const { rows: taskRows } = await pool.query(
        `SELECT id FROM tasks WHERE id = $1 AND (user_id = $2
          OR EXISTS (SELECT 1 FROM task_permissions WHERE task_id = $1 AND user_id = $2 AND can_edit = true))`,
        [taskId, user.id]
      );
      if (taskRows.length === 0) return res.status(403).json({ error: 'Keine Berechtigung' });

      // Check attachment count
      const { rows: countRows } = await pool.query(
        'SELECT COUNT(*) as cnt FROM task_attachments WHERE task_id = $1',
        [taskId]
      );
      if (parseInt(countRows[0].cnt) >= MAX_ATTACHMENTS) {
        return res.status(400).json({ error: `Maximal ${MAX_ATTACHMENTS} Dateien pro Aufgabe` });
      }

      const { file_name, file_type, file_data } = req.body;

      if (!file_name || !file_type || !file_data) {
        return res.status(400).json({ error: 'Datei-Daten unvollständig' });
      }

      // Validate MIME type
      if (!ALLOWED_TYPES.includes(file_type)) {
        return res.status(400).json({ error: 'Dateityp nicht erlaubt. Erlaubt: Bilder, PDF, Text, Word, Excel' });
      }

      // Validate file size (base64 is ~33% larger)
      const fileSize = Math.ceil(file_data.length * 0.75);
      if (fileSize > MAX_FILE_SIZE) {
        return res.status(400).json({ error: 'Datei zu groß (max. 5 MB)' });
      }

      // Sanitize file name
      const safeName = file_name.replace(/[^\w.\-äöüÄÖÜß ]/g, '_').substring(0, 100);

      const { rows } = await pool.query(
        `INSERT INTO task_attachments (task_id, user_id, file_name, file_type, file_size, file_data)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, task_id, file_name, file_type, file_size, created_at`,
        [taskId, user.id, safeName, file_type, fileSize, file_data]
      );

      return res.status(201).json({ attachment: rows[0] });
    } catch (err) {
      console.error('Attachment upload error:', err);
      return res.status(500).json({ error: 'Fehler beim Hochladen' });
    }
  }

  // DELETE /api/attachments/:taskId/:attachmentId – delete attachment
  if (segments.length === 2 && req.method === 'DELETE') {
    const taskId = normalizeTaskId(segments[0]);
    const attachmentId = parseInt(segments[1]);
    if (isNaN(taskId) || isNaN(attachmentId)) return res.status(400).json({ error: 'Ungültige ID' });

    try {
      const { rowCount } = await pool.query(
        `DELETE FROM task_attachments WHERE id = $1 AND task_id = $2
         AND (user_id = $3 OR EXISTS (SELECT 1 FROM tasks WHERE id = $2 AND user_id = $3))`,
        [attachmentId, taskId, user.id]
      );
      if (rowCount === 0) return res.status(404).json({ error: 'Datei nicht gefunden oder keine Berechtigung' });

      return res.json({ success: true });
    } catch (err) {
      console.error('Attachment delete error:', err);
      return res.status(500).json({ error: 'Fehler beim Löschen' });
    }
  }

  return res.status(404).json({ error: 'Nicht gefunden' });
};
