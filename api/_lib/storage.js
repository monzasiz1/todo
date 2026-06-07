// ─────────────────────────────────────────────────────────────────────────
// Supabase Storage Helper (Backend, Service-Role)
// ─────────────────────────────────────────────────────────────────────────
// Wir benutzen die Storage-REST-API direkt mit fetch (kein @supabase/supabase-js
// im Backend noetig). Service-Role-Key umgeht RLS – Mutationen laufen weiterhin
// nur ueber unsere /api/* Routen, also kein Sicherheitsrisiko.
//
// Env-Variablen (Vercel):
//   SUPABASE_URL                   z.B. https://zgyhbynecxpoykpzshcp.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY      "service_role" JWT aus Project Settings → API
//
// Buckets (einmalig in Supabase Dashboard anzulegen):
//   - avatars     (Public, fuer User-Profilbilder)
//   - attachments (Privat, fuer Task-Anhaenge; Download nur via Signed-URL)
// ─────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CACHE_ONE_YEAR = 'public, max-age=31536000, immutable';

function isConfigured() {
  return !!(SUPABASE_URL && SERVICE_ROLE);
}

// Wandelt "data:image/png;base64,iVBOR..." in { buffer, mime, ext } um.
function parseDataUri(dataUri) {
  if (typeof dataUri !== 'string' || !dataUri.startsWith('data:')) {
    throw new Error('Kein gültiger Data-URI');
  }
  const m = dataUri.match(/^data:([^;,]+)(?:;base64)?,(.*)$/i);
  if (!m) throw new Error('Data-URI kann nicht geparst werden');
  const mime = m[1].toLowerCase();
  const buffer = Buffer.from(m[2], 'base64');
  const extMap = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
    'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic',
  };
  const ext = extMap[mime] || 'bin';
  return { buffer, mime, ext };
}

// PUT (upsert) eine Datei in einen Bucket. Pfad ist deterministisch
// (z.B. "users/3/avatar.jpg"), damit alte Versionen ueberschrieben werden
// und der Browser sie via Cache-Buster-Param refreshen kann.
async function uploadToBucket({ bucket, path, buffer, contentType, cacheControl }) {
  if (!isConfigured()) throw new Error('Supabase Storage nicht konfiguriert (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlt)');
  const url = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE}`,
      'apikey': SERVICE_ROLE,
      'Content-Type': contentType || 'application/octet-stream',
      'Cache-Control': cacheControl || CACHE_ONE_YEAR,
      'x-upsert': 'true',
    },
    body: buffer,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Storage-Upload fehlgeschlagen (${res.status}): ${text}`);
  }
  return res.json().catch(() => ({}));
}

async function deleteFromBucket({ bucket, path }) {
  if (!isConfigured()) return;
  const url = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;
  await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE}`,
      'apikey': SERVICE_ROLE,
    },
  });
}

function publicUrl({ bucket, path, bust }) {
  const base = `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;
  return bust ? `${base}?v=${bust}` : base;
}

async function createSignedUrl({ bucket, path, expiresIn = 60 * 60 }) {
  if (!isConfigured()) throw new Error('Supabase Storage nicht konfiguriert');
  const url = `${SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE}`,
      'apikey': SERVICE_ROLE,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) throw new Error(`Signed URL fehlgeschlagen (${res.status})`);
  const json = await res.json();
  return `${SUPABASE_URL}/storage/v1${json.signedURL || json.signedUrl}`;
}

// ─── Avatar-Helpers ──────────────────────────────────────────────────────

// Lade einen Base64-Avatar hoch, gib eine cache-bustbare Public-URL zurueck.
async function uploadAvatarFromDataUri(userId, dataUri) {
  const { buffer, mime, ext } = parseDataUri(dataUri);
  const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  if (!ALLOWED.has(mime)) throw new Error('Bildformat nicht unterstützt');
  if (buffer.length > 2 * 1024 * 1024) throw new Error('Bild zu gross (max. 2 MB)');

  const path = `users/${userId}/avatar.${ext}`;
  await uploadToBucket({
    bucket: 'avatars',
    path,
    buffer,
    contentType: mime,
    cacheControl: CACHE_ONE_YEAR,
  });
  // Cache-Buster ueber Timestamp damit Browser den neuen Avatar sofort sieht.
  return publicUrl({ bucket: 'avatars', path, bust: Date.now() });
}

async function deleteAvatar(userId) {
  for (const ext of ['jpg', 'png', 'webp', 'gif']) {
    try { await deleteFromBucket({ bucket: 'avatars', path: `users/${userId}/avatar.${ext}` }); } catch { /* ignore */ }
  }
}

module.exports = {
  isConfigured,
  parseDataUri,
  uploadToBucket,
  deleteFromBucket,
  publicUrl,
  createSignedUrl,
  uploadAvatarFromDataUri,
  deleteAvatar,
};
