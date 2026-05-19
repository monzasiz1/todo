// ─────────────────────────────────────────────────────────────────────────
// One-Shot Admin-Endpoint: Avatar-Migration Base64 -> Supabase Storage
// ─────────────────────────────────────────────────────────────────────────
// Vercel-only Migration: laeuft mit den ENV-Variablen aus der Vercel-Config,
// keine lokale .env noetig. Geschuetzt durch Shared-Secret im Header.
//
// Setup:
//   1) In Vercel ENV setzen: ADMIN_MIGRATION_SECRET=<eine_zufaellige_string>
//   2) Bucket "avatars" in Supabase Storage muss existieren (public).
//   3) Deployen (push to main triggert Vercel-Deploy).
//
// Aufruf (PowerShell):
//   $secret = "DEIN_SECRET"
//   # Dry-Run:
//   Invoke-RestMethod -Method GET -Uri "https://beequ.de/api/admin-migrate-avatars" `
//     -Headers @{ Authorization = "Bearer $secret" }
//   # Commit:
//   Invoke-RestMethod -Method POST -Uri "https://beequ.de/api/admin-migrate-avatars?commit=1" `
//     -Headers @{ Authorization = "Bearer $secret" }
//
// Aufruf (curl/bash):
//   curl -H "Authorization: Bearer $SECRET" https://beequ.de/api/admin-migrate-avatars
//   curl -X POST -H "Authorization: Bearer $SECRET" \
//     "https://beequ.de/api/admin-migrate-avatars?commit=1"
//
// Nach erfolgreicher Migration kann (sollte) dieser Endpoint wieder entfernt
// werden, oder das Secret in Vercel geloescht werden.
// ─────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { getPool } = require('./_lib/db');
const { cors } = require('./_lib/auth');
const storage = require('./_lib/storage');

// Timing-safe Vergleich von Strings (verhindert Timing-Attacken auf das Secret).
function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a || ''));
  const bBuf = Buffer.from(String(b || ''));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;

  // Auth: Bearer-Token gegen ENV-Secret.
  const expected = process.env.ADMIN_MIGRATION_SECRET || '';
  if (!expected) {
    return res.status(503).json({ error: 'ADMIN_MIGRATION_SECRET nicht konfiguriert' });
  }
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!safeEqual(token, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!storage.isConfigured()) {
    return res.status(503).json({
      error: 'Supabase Storage nicht konfiguriert (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlt)',
    });
  }

  // commit=1 als Query-Param ODER POST-Methode aktivieren den Schreibmodus.
  const commit = req.method === 'POST' || String(req.query?.commit || '') === '1';
  const pool = getPool();

  const results = [];
  let ok = 0;
  let fail = 0;
  let skipped = 0;
  let totalBytes = 0;

  try {
    const { rows } = await pool.query(
      `SELECT id, name, length(avatar_url) AS bytes
         FROM users
        WHERE avatar_url LIKE 'data:image/%'
        ORDER BY id ASC`
    );

    for (const row of rows) {
      const userId = row.id;
      const bytes = Number(row.bytes) || 0;

      try {
        const { rows: r2 } = await pool.query(
          'SELECT avatar_url FROM users WHERE id = $1',
          [userId]
        );
        const dataUri = r2[0]?.avatar_url;
        if (!dataUri || !dataUri.startsWith('data:image/')) {
          results.push({ id: userId, name: row.name, status: 'skipped', reason: 'not base64' });
          skipped++;
          continue;
        }

        if (!commit) {
          results.push({
            id: userId,
            name: row.name,
            status: 'dry-run',
            bytes,
            target: `avatars/users/${userId}/avatar.*`,
          });
          totalBytes += bytes;
          ok++;
          continue;
        }

        const publicUrl = await storage.uploadAvatarFromDataUri(userId, dataUri);
        await pool.query('UPDATE users SET avatar_url = $2 WHERE id = $1', [userId, publicUrl]);
        results.push({ id: userId, name: row.name, status: 'ok', bytes, url: publicUrl });
        totalBytes += bytes;
        ok++;
      } catch (e) {
        const msg = e?.message || String(e);
        results.push({ id: userId, name: row.name, status: 'error', error: msg });
        fail++;
      }
    }

    return res.json({
      mode: commit ? 'commit' : 'dry-run',
      found: rows.length,
      ok,
      fail,
      skipped,
      totalBytes,
      totalKB: Math.round(totalBytes / 1024),
      results,
    });
  } catch (err) {
    console.error('admin-migrate-avatars error:', err);
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
};
