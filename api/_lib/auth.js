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

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

module.exports = { verifyToken, generateToken, cors, getJwtSecret };
