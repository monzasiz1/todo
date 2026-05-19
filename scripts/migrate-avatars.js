#!/usr/bin/env node
/**
 * One-shot Migrations-Script:
 *   Liest alle users.avatar_url die noch als "data:image/..." in der DB stehen,
 *   laedt sie in den Supabase-Storage-Bucket "avatars" hoch und ersetzt den
 *   DB-Wert durch die Public-URL.
 *
 * Benoetigt in .env (oder ENV):
 *   DATABASE_URL                 (Transaction Pooler 6543)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Aufruf:
 *   node scripts/migrate-avatars.js              # Dry-Run (nichts wird geaendert)
 *   node scripts/migrate-avatars.js --commit     # Echte Migration
 */

const fs = require('fs');
const path = require('path');

// Mini-.env-Loader (kein dotenv-Dependency noetig)
(function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const txt = fs.readFileSync(envPath, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
})();

// Reuse production helpers
const { getPool } = require(path.join(__dirname, '..', 'api', '_lib', 'db'));
const storage = require(path.join(__dirname, '..', 'api', '_lib', 'storage'));

const COMMIT = process.argv.includes('--commit');

(async () => {
  if (!storage.isConfigured()) {
    console.error('FEHLER: SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlt in .env');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('FEHLER: DATABASE_URL fehlt in .env');
    process.exit(1);
  }

  const pool = getPool();
  console.log(`Mode: ${COMMIT ? 'COMMIT (echte Migration)' : 'DRY-RUN (nichts wird geaendert)'}`);

  const { rows } = await pool.query(
    `SELECT id, name, length(avatar_url) AS bytes
       FROM users
      WHERE avatar_url LIKE 'data:image/%'
      ORDER BY id ASC`
  );

  console.log(`Gefunden: ${rows.length} User mit Base64-Avatar\n`);
  if (rows.length === 0) {
    await pool.end().catch(() => {});
    return;
  }

  let ok = 0, fail = 0;
  const results = [];

  for (const u of rows) {
    const tag = `  [${String(u.id).padStart(3)}] ${u.name || '(ohne Name)'} (${Math.round(u.bytes / 1024)} KB)`;
    if (!COMMIT) {
      console.log(`${tag} → wuerde hochgeladen werden`);
      results.push({ id: u.id, status: 'dry-run' });
      continue;
    }
    try {
      const { rows: [row] } = await pool.query(`SELECT avatar_url FROM users WHERE id = $1`, [u.id]);
      const dataUri = row && row.avatar_url;
      if (!dataUri || !dataUri.startsWith('data:image/')) {
        console.log(`${tag} → uebersprungen (kein data:image mehr)`);
        results.push({ id: u.id, status: 'skipped' });
        continue;
      }
      const { url } = await storage.uploadAvatarFromDataUri(u.id, dataUri);
      await pool.query(`UPDATE users SET avatar_url = $2 WHERE id = $1`, [u.id, url]);
      console.log(`${tag} → OK  ${url}`);
      results.push({ id: u.id, status: 'ok', url });
      ok++;
    } catch (e) {
      console.error(`${tag} → FEHLER  ${e.message}`);
      results.push({ id: u.id, status: 'error', error: e.message });
      fail++;
    }
  }

  console.log(`\nFertig. OK: ${ok}  Fehler: ${fail}  Gesamt: ${rows.length}`);
  if (!COMMIT) console.log('Hinweis: erneut mit --commit aufrufen, um echt zu migrieren.');

  await pool.end().catch(() => {});
})().catch((e) => {
  console.error('Unerwarteter Fehler:', e);
  process.exit(1);
});
