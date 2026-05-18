// ─────────────────────────────────────────────────────────────────────────
// Migration: Avatare aus users.avatar_url (Base64) -> Supabase Storage
// ─────────────────────────────────────────────────────────────────────────
// Liest alle User mit avatar_url LIKE 'data:image/%', laedt sie in den
// Storage-Bucket "avatars" hoch und schreibt die Public-URL zurueck.
//
// Lokale Ausfuehrung:
//   1) .env mit DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY anlegen
//   2) npm i -g dotenv-cli   (oder dotenv per "node --env-file=.env ...")
//   3) cd repo-root
//      node --env-file=.env scripts/migrate-avatars-to-storage.js
//
// Ohne --commit laeuft das Script im Dry-Run-Modus (zeigt was passieren wuerde).
// Mit  --commit werden Uploads + DB-Updates wirklich durchgefuehrt.
// ─────────────────────────────────────────────────────────────────────────

const path = require('path');
const { Pool } = require('pg');
const storage = require(path.join(__dirname, '..', 'api', '_lib', 'storage.js'));

const DRY_RUN = !process.argv.includes('--commit');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL fehlt. Abbruch.');
    process.exit(1);
  }
  if (!storage.isConfigured()) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlt. Abbruch.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  console.log(DRY_RUN ? '── DRY-RUN (kein Commit) ──' : '── COMMIT-MODUS ──');

  const { rows } = await pool.query(
    `SELECT id, length(avatar_url) AS bytes
       FROM users
      WHERE avatar_url LIKE 'data:image/%'
      ORDER BY id ASC`
  );
  console.log(`Gefunden: ${rows.length} User mit Base64-Avatar`);

  let totalSavedBytes = 0;
  let ok = 0;
  let fail = 0;

  for (const row of rows) {
    const userId = row.id;
    try {
      const { rows: r2 } = await pool.query(
        'SELECT avatar_url FROM users WHERE id = $1',
        [userId]
      );
      const dataUri = r2[0]?.avatar_url;
      if (!dataUri || !dataUri.startsWith('data:image/')) {
        console.log(`  [skip] user=${userId} (kein Base64 mehr)`);
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [dry] user=${userId}, ${(row.bytes / 1024).toFixed(0)} kB -> avatars/users/${userId}/avatar.*`);
        totalSavedBytes += row.bytes;
        ok++;
        continue;
      }

      const publicUrl = await storage.uploadAvatarFromDataUri(userId, dataUri);
      await pool.query('UPDATE users SET avatar_url = $2 WHERE id = $1', [userId, publicUrl]);
      console.log(`  [ok]  user=${userId} -> ${publicUrl}`);
      totalSavedBytes += row.bytes;
      ok++;
    } catch (e) {
      console.error(`  [err] user=${userId}: ${e?.message || e}`);
      fail++;
    }
  }

  console.log('────────────────────────────────────────────');
  console.log(`Erfolgreich:  ${ok}`);
  console.log(`Fehlgeschlagen: ${fail}`);
  console.log(`Eingesparte DB-Payload: ~${(totalSavedBytes / 1024 / 1024).toFixed(2)} MB pro Vollabfrage`);
  if (DRY_RUN) console.log('Hinweis: Mit --commit erneut starten, um wirklich zu migrieren.');

  await pool.end();
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
