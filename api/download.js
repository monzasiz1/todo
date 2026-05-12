// GET /api/download?platform=windows
// Proxy zu GitHub Releases - zeigt beequ.de in der URL, lädt von GitHub

export default async function handler(req, res) {
  const { platform } = req.query;

  // GitHub Release URLs
  const downloads = {
    windows: 'https://github.com/monzasiz1/todo/releases/latest/download/BeeQu-Setup-1.0.0.exe',
    'windows-portable': 'https://github.com/monzasiz1/todo/releases/latest/download/BeeQu-1.0.0.exe',
    macos: 'https://github.com/monzasiz1/todo/releases/latest/download/BeeQu-1.0.0.dmg',
  };

  const url = downloads[platform];

  if (!url) {
    return res.status(400).json({ error: 'Invalid platform. Use: windows, windows-portable, or macos' });
  }

  try {
    // Fetch von GitHub
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'BeeQu-Download-Proxy/1.0',
      },
    });

    if (!response.ok) {
      return res.status(404).json({ error: 'Release not found' });
    }

    // Content-Disposition Header setzen (Dateiname im Download-Dialog)
    const filename = url.split('/').pop();
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    // Stream direkt zum Client
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
}

// Vercel Config - erhöhe Timeout für große Dateien
export const config = {
  maxDuration: 60, // 60 Sekunden für große .exe
};
