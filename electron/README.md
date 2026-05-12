# BeeQu Desktop App

Desktop-Version der BeeQu-Anwendung für Windows und macOS, gebaut mit Electron.

## 📦 Download

Die fertigen Desktop-Apps werden automatisch bei jedem Release auf GitHub gebaut:

**[→ Releases auf GitHub](../../releases)**

- **Windows:** `BeeQu-Setup-*.exe` (Installer) oder `BeeQu-*.exe` (Portable)
- **macOS:** `BeeQu-*.dmg` (Intel + Apple Silicon)

## 🏗️ Lokale Entwicklung

```bash
cd electron
npm install
npm start
```

Die App lädt automatisch `https://beequ.de` – kein lokales Backend nötig.

## 🚀 Release erstellen

Neuen Release mit Git-Tag veröffentlichen:

```bash
git tag v1.0.0
git push --tags
```

GitHub Actions baut automatisch:
- Windows `.exe` (NSIS-Installer + Portable)
- macOS `.dmg` (Universal Binary: Intel + Apple Silicon)

Die fertigen Dateien erscheinen unter **Releases** zum Download.

## 🛠️ Manueller Build (optional)

**Windows:**
```bash
cd electron
npm run build:win
```

**macOS:**
```bash
cd electron
npm run build:mac
```

**Beide Plattformen:**
```bash
cd electron
npm run build:all
```

Build-Ausgabe: `electron/dist/`

## 📂 Struktur

```
electron/
├── main.js          # Electron Hauptprozess
├── preload.js       # Sicherheits-Sandbox
├── package.json     # Build-Konfiguration
├── icon.png         # App-Icon (512×512)
└── dist/            # Build-Output (nicht im Git)
```

## ⚙️ Konfiguration

Die App verbindet sich automatisch mit:
- **Produktions-URL:** `https://beequ.de`
- Alle API-Requests gehen an die Vercel-serverless-API

Ändern: `main.js` → `APP_URL` anpassen.

## 🔒 Sicherheit

- **Context Isolation:** ✅ Aktiviert
- **Node Integration:** ❌ Deaktiviert
- **Web Security:** ✅ Aktiviert
- Externe Links öffnen im System-Browser

## 📝 Lizenz

Copyright © 2026 BeeQu
