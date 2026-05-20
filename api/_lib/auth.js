const jwt = require('jsonwebtoken');

// JWT_SECRET MUSS gesetzt sein. Ein Fallback waere ein Auth-Bypass:
// jeder mit Kenntnis des Fallback-Werts koennte Tokens fuer beliebige
// Accounts faelschen. In Production wird sofort gecrasht, in Dev wird
// laut gewarnt.
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[auth] JWT_SECRET ist nicht gesetzt oder zu kurz (>=32 Zeichen erforderlich).');
  }
  if (!getJwtSecret._warned) {
    // eslint-disable-next-line no-console
    console.warn('[auth] WARN: JWT_SECRET fehlt/zu kurz — benutze unsicheren Dev-Fallback. NIEMALS in Production!');
    getJwtSecret._warned = true;
  }
  return secret || 'insecure-dev-only-secret-do-not-use-in-prod-32chars';
}

function verifyToken(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }
  try {
    return jwt.verify(header.split(' ')[1], getJwtSecret());
  } catch {
    return null;
  }
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    getJwtSecret(),
    { expiresIn: '90d' }
  );
}

// CORS: erlaubt entweder einen konfigurierten Origin-Whitelist
// (ALLOWED_ORIGINS oder APP_BASE_URL als comma-separierte Liste).
// Faellt nur in Dev oder wenn nichts konfiguriert ist auf '*' zurueck.
// req wird ueber res.req gelesen (Node http verlinkt das automatisch),
// damit kein Call-Site-Refactor noetig ist.
function cors(res) {
  const allowList = String(process.env.ALLOWED_ORIGINS || process.env.APP_BASE_URL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = res && res.req && res.req.headers && res.req.headers.origin;
  let allowOrigin;
  if (allowList.length === 0) {
    if (process.env.NODE_ENV === 'production' && !cors._warned) {
      // eslint-disable-next-line no-console
      console.warn('[cors] WARN: Keine ALLOWED_ORIGINS/APP_BASE_URL gesetzt — falle auf wildcard zurueck.');
      cors._warned = true;
    }
    allowOrigin = origin || '*';
  } else if (origin && allowList.includes(origin)) {
    allowOrigin = origin;
  } else {
    // Nicht in Whitelist: setze ersten Eintrag — Browser blockiert dann
    // den Cross-Origin-Zugriff, weil der zurueckgegebene Origin nicht
    // mit dem Request-Origin uebereinstimmt.
    allowOrigin = allowList[0];
  }
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

// Kurzlebiges Token (15 Min) ausschliesslich fuer Datei-Downloads.
// Bindet User-ID, Task-ID und Attachment-ID, damit das Token nicht
// fuer andere Endpoints oder andere Dateien wiederverwendbar ist.
function signDownloadToken({ userId, taskId, attachmentId }) {
  return jwt.sign(
    { sub: userId, t: taskId, a: attachmentId },
    getJwtSecret(),
    { expiresIn: '15m', audience: 'download' }
  );
}

function verifyDownloadToken(token, { taskId, attachmentId }) {
  try {
    const claims = jwt.verify(token, getJwtSecret(), { audience: 'download' });
    if (Number(claims.t) !== Number(taskId)) return null;
    if (Number(claims.a) !== Number(attachmentId)) return null;
    return { id: claims.sub };
  } catch {
    return null;
  }
}

module.exports = {
  verifyToken,
  generateToken,
  cors,
  getJwtSecret,
  signDownloadToken,
  verifyDownloadToken,
};
