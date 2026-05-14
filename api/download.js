// GET /api/download?platform=windows | windows-portable | macos
// Leitet auf den passenden Asset des **neuesten** GitHub-Releases um.

const REPO = 'monzasiz1/todo';
const CACHE_MS = 5 * 60 * 1000; // 5 Minuten
let cache = { ts: 0, data: null };

async function getLatestRelease() {
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_MS) return cache.data;

  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'User-Agent': 'beequ-download-api', 'Accept': 'application/vnd.github+json' },
  });
  if (!r.ok) throw new Error(`GitHub API ${r.status}`);
  const data = await r.json();
  cache = { ts: now, data };
  return data;
}

function pickAsset(assets, platform) {
  const list = assets || [];
  const find = (re) => list.find((a) => re.test(a.name));
  switch (platform) {
    case 'windows':
      // Installer: "BeeQu Setup 1.0.2.exe" oder "BeeQu-Setup-1.0.2.exe"
      return find(/^BeeQu[ -]Setup[ -].*\.exe$/i);
    case 'windows-portable':
      // Portable: "BeeQu 1.0.2.exe" oder "BeeQu-1.0.2.exe" (kein "Setup")
      return find(/^BeeQu[ -](?!Setup)\d.*\.exe$/i);
    case 'macos':
      return find(/^BeeQu[ -].*\.dmg$/i);
    default:
      return null;
  }
}

export default async function handler(req, res) {
  const { platform } = req.query;
  const valid = ['windows', 'windows-portable', 'macos'];
  if (!valid.includes(platform)) {
    return res.status(400).json({ error: `Invalid platform. Use: ${valid.join(', ')}` });
  }

  try {
    const release = await getLatestRelease();
    const asset = pickAsset(release.assets, platform);
    if (!asset) {
      return res.status(404).json({
        error: `No asset for platform "${platform}" found in release ${release.tag_name}`,
      });
    }
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.redirect(302, asset.browser_download_url);
  } catch (err) {
    console.error('Download error:', err);
    return res.status(502).json({ error: 'Could not resolve latest release' });
  }
}

export const config = { maxDuration: 10 };
