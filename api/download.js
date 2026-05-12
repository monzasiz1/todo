// GET /api/download?platform=windows
// Direkte Downloads von GitHub Releases (öffentliches Repository)

export default async function handler(req, res) {
  const { platform } = req.query;

  // GitHub Release URLs (Repository ist jetzt öffentlich!)
  const downloads = {
    windows: 'https://github.com/monzasiz1/todo/releases/download/v1.0.0/BeeQu-Setup-1.0.0.exe',
    'windows-portable': 'https://github.com/monzasiz1/todo/releases/download/v1.0.0/BeeQu-1.0.0.exe',
    macos: 'https://github.com/monzasiz1/todo/releases/download/v1.0.0/BeeQu-1.0.0.dmg',
  };

  const url = downloads[platform];

  if (!url) {
    return res.status(400).json({ 
      error: 'Invalid platform. Use: windows, windows-portable, or macos' 
    });
  }

  try {
    // Redirect zu GitHub Release
    res.redirect(302, url);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
}

// Vercel Config
export const config = {
  maxDuration: 10,
};
