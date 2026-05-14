'use strict';

const { app, BrowserWindow, Tray, shell, Menu, ipcMain, dialog, nativeTheme, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// ─── Globale Referenzen ──────────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let isQuitting = false;
let trayBalloonShown = false;
let refreshTrayMenu = () => {};

// Update-State für Tray-Menü
let updateState = 'idle'; // 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error'
let updateProgress = 0;
let updateUserInitiated = false;

function broadcastUpdateState() {
  const payload = { state: updateState, progress: updateProgress, version: app.getVersion() };
  BrowserWindow.getAllWindows().forEach((w) => {
    try { w.webContents.send('desktop-updates:state-changed', payload); } catch {}
  });
}

// ─── Produktions-URL ─────────────────────────────────────────────────────────
// Die Desktop-App öffnet niemals die Landing-Page, sondern direkt den Login.
const APP_URL = 'https://beequ.de';
const APP_START_URL = 'https://beequ.de/app/login';

// Windows-Taskbar/Notifications: konsistente App-ID
if (process.platform === 'win32') {
  app.setAppUserModelId('de.beequ.app');
}

// ─── Performance-Switches (müssen VOR app.ready laufen) ─────────────────────
// Verhindert Chromium-Hintergrund-Drosselung von Renderer-Prozessen, was die
// App beim Wiederfokussieren träge wirken ließ. Spart außerdem ein paar
// teure GPU-Features, die wir nicht brauchen.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,HardwareMediaKeyHandling');
// Schnelleres Window-Erscheinen: kein Frame-Throttling beim Boot
app.commandLine.appendSwitch('enable-zero-copy');

// ─── Launch-Flags ────────────────────────────────────────────────────────────
const launchArgs = process.argv.slice(1);
const startedHidden =
  launchArgs.includes('--hidden') ||
  launchArgs.includes('--start-minimized') ||
  (app.getLoginItemSettings && app.getLoginItemSettings().wasOpenedAsHidden);

// ─── Persistente Einstellungen ───────────────────────────────────────────────
const SETTINGS_PATH = path.join(app.getPath('userData'), 'desktop-settings.json');
const defaultSettings = {
  autoLaunch: false,
  startMinimized: false,
  minimizeToTray: true,
  closeToTray: true,
  autoUpdate: true,
};
function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return { ...defaultSettings };
  }
}
function saveSettings(s) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
  } catch (err) {
    console.error('Settings konnten nicht gespeichert werden:', err);
  }
}
let settings = loadSettings();

function applyAutoLaunch() {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    app.setLoginItemSettings({
      openAtLogin: !!settings.autoLaunch,
      openAsHidden: !!settings.startMinimized,
      args: settings.startMinimized ? ['--hidden'] : [],
    });
  }
}

function broadcastSettings() {
  BrowserWindow.getAllWindows().forEach((w) => {
    try { w.webContents.send('desktop-settings:changed', { ...settings }); } catch {}
  });
}

function updateSettings(partial) {
  if (!partial || typeof partial !== 'object') return { ...settings };
  const allowed = ['autoLaunch', 'startMinimized', 'minimizeToTray', 'closeToTray', 'autoUpdate'];
  let changedAutoLaunch = false;
  for (const key of allowed) {
    if (key in partial) {
      const next = !!partial[key];
      if (settings[key] !== next) {
        if (key === 'autoLaunch' || key === 'startMinimized') changedAutoLaunch = true;
        settings[key] = next;
      }
    }
  }
  if (!settings.autoLaunch && settings.startMinimized) {
    settings.startMinimized = false;
    changedAutoLaunch = true;
  }
  saveSettings(settings);
  if (changedAutoLaunch) applyAutoLaunch();
  refreshTrayMenu();
  broadcastSettings();
  return { ...settings };
}

// ─── Single-Instance Lock ─────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ─── Fenster erstellen ────────────────────────────────────────────────────────
function createWindow() {
  nativeTheme.themeSource = 'system';

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    icon: path.join(__dirname, 'icon.png'),
    title: 'BeeQu',
    backgroundColor: '#030812',
    show: false,
    paintWhenInitiallyHidden: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'win32'
      ? { color: '#030812', symbolColor: '#aad4ff', height: 40 }
      : false,
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
      spellcheck: false,
      v8CacheOptions: 'code',
      enableBlinkFeatures: '',
    },
  });

  if (process.platform === 'darwin') {
    buildMacMenu();
  } else {
    Menu.setApplicationMenu(null);
  }

  // Sofortiger lokaler Splash, damit der User nicht 1–3 s nichts sieht.
  // Wird automatisch durch loadURL() ersetzt, sobald die Web-App geöffnet ist.
  const splashHtml = encodeURIComponent(
    `<!doctype html><html><head><meta charset="utf-8"><title>BeeQu</title>` +
    `<style>html,body{margin:0;height:100%;background:#030812;color:#aad4ff;` +
    `font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:grid;place-items:center}` +
    `.l{width:40px;height:40px;border:3px solid rgba(170,212,255,.18);border-top-color:#3aa6ff;` +
    `border-radius:50%;animation:s 1s linear infinite}` +
    `@keyframes s{to{transform:rotate(360deg)}}` +
    `.t{margin-top:14px;font-size:13px;opacity:.55;letter-spacing:.04em}</style></head>` +
    `<body><div><div class="l"></div><div class="t">BeeQu wird geladen …</div></div></body></html>`
  );
  if (!startedHidden) {
    win.loadURL('data:text/html;charset=utf-8,' + splashHtml).catch(() => {});
    win.show();
  }
  // Direkt im Anschluss die Web-App laden (überschreibt den Splash sobald bereit)
  setImmediate(() => win.loadURL(APP_START_URL).catch(() => {}));

  win.once('ready-to-show', () => {
    if (startedHidden) return; // Beim Autostart in den Tray starten
    if (!win.isVisible()) win.show();
    win.focus();
  });

  // Fehler beim Laden → einfache Fehlerseite
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    win.loadURL(
      `data:text/html;charset=utf-8,<html style="background:%23030812;color:%23aad4ff;font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0">` +
      `<div style="text-align:center"><h1 style="font-size:2rem;margin-bottom:.5rem">BeeQu</h1>` +
      `<p style="opacity:.7">Keine Verbindung. Bitte Internetverbindung prüfen.</p>` +
      `<p style="font-size:.75rem;opacity:.4;margin-top:2rem">Fehler ${code}: ${desc}</p></div></html>`
    );
  });

  // Externe Links im System-Browser öffnen
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_URL)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Close → in Tray minimieren
  win.on('close', (event) => {
    if (!isQuitting && settings.closeToTray && process.platform !== 'darwin') {
      event.preventDefault();
      win.hide();
      notifyTrayBalloon();
    }
  });

  // Minimieren → in Tray
  win.on('minimize', (event) => {
    if (settings.minimizeToTray && process.platform !== 'darwin') {
      event.preventDefault();
      win.hide();
      notifyTrayBalloon();
    }
  });

  return win;
}

function notifyTrayBalloon() {
  if (trayBalloonShown || !tray || process.platform !== 'win32') return;
  trayBalloonShown = true;
  try {
    tray.displayBalloon({
      title: 'BeeQu läuft weiter',
      content: 'BeeQu ist weiterhin im Hintergrund aktiv. Über das Tray-Symbol unten rechts kannst du es jederzeit öffnen.',
      iconType: 'info',
    });
  } catch {
    // ignorieren
  }
}

// ─── Auto-Updater (electron-updater + GitHub Releases) ───────────────────────
function setupAutoUpdater() {
  // In Dev-Modus (kein gepacktes App-Bundle) gibt es keine Updates
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;            // sobald Update verfügbar → herunterladen
  autoUpdater.autoInstallOnAppQuit = true;    // beim Beenden installieren (Discord-Verhalten)
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    updateState = 'checking';
    refreshTrayMenu();
    broadcastUpdateState();
  });

  autoUpdater.on('update-available', (info) => {
    updateState = 'available';
    refreshTrayMenu();
    broadcastUpdateState();
    if (updateUserInitiated && mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update verfügbar',
        message: `Version ${info.version} wird im Hintergrund heruntergeladen.`,
        detail: 'Du kannst weiterarbeiten. Das Update wird beim nächsten Neustart automatisch installiert.',
        buttons: ['OK'],
      }).catch(() => {});
    }
  });

  autoUpdater.on('update-not-available', () => {
    updateState = 'none';
    refreshTrayMenu();
    broadcastUpdateState();
    if (updateUserInitiated && mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Kein Update verfügbar',
        message: 'Du nutzt bereits die neueste Version von BeeQu.',
        buttons: ['OK'],
      }).catch(() => {});
    }
    updateUserInitiated = false;
  });

  autoUpdater.on('download-progress', (p) => {
    updateState = 'downloading';
    updateProgress = Math.round(p.percent || 0);
    refreshTrayMenu();
    broadcastUpdateState();
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateState = 'ready';
    refreshTrayMenu();
    broadcastUpdateState();
    if (!mainWindow) return;
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update bereit',
        message: `BeeQu ${info.version} ist installationsbereit.`,
        detail: 'Soll die Anwendung neu gestartet werden, um das Update zu installieren?',
        buttons: ['Jetzt neu starten', 'Später'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((res) => {
        if (res.response === 0) {
          isQuitting = true;
          autoUpdater.quitAndInstall();
        }
      })
      .catch(() => {});
  });

  autoUpdater.on('error', (err) => {
    updateState = 'error';
    refreshTrayMenu();
    broadcastUpdateState();
    console.error('AutoUpdater-Fehler:', err);
    if (updateUserInitiated && mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Update-Prüfung fehlgeschlagen',
        message: 'Updates konnten gerade nicht geprüft werden.',
        detail: String(err && err.message ? err.message : err),
        buttons: ['OK'],
      }).catch(() => {});
    }
    updateUserInitiated = false;
  });
}

function checkForUpdates(userInitiated = false) {
  if (!app.isPackaged) return;
  if (!settings.autoUpdate && !userInitiated) return;
  updateUserInitiated = userInitiated;
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('checkForUpdates Fehler:', err);
  });
}

// ─── System-Tray ─────────────────────────────────────────────────────────────
function createTray() {
  if (tray) return tray;

  try {
    tray = new Tray(path.join(__dirname, 'icon.png'));
  } catch (err) {
    console.error('Tray-Icon konnte nicht geladen werden:', err);
    return null;
  }

  tray.setToolTip('BeeQu');

  const showWindow = () => {
    if (!mainWindow) {
      mainWindow = createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  };

  const updateMenu = () => {
    const updateLabel = (() => {
      switch (updateState) {
        case 'checking':    return 'Prüfe auf Updates…';
        case 'available':   return 'Update wird heruntergeladen…';
        case 'downloading': return `Update wird heruntergeladen (${updateProgress}%)`;
        case 'ready':       return 'Update bereit – jetzt neu starten';
        case 'none':        return 'Auf neueste Version (manuell prüfen)';
        case 'error':       return 'Update-Prüfung fehlgeschlagen';
        default:            return 'Nach Updates suchen';
      }
    })();

    const contextMenu = Menu.buildFromTemplate([
      { label: 'BeeQu öffnen', click: showWindow },
      { type: 'separator' },
      {
        label: 'Mit Windows starten',
        type: 'checkbox',
        checked: !!settings.autoLaunch,
        click: (item) => updateSettings({ autoLaunch: item.checked }),
      },
      {
        label: 'Beim Autostart minimiert starten',
        type: 'checkbox',
        checked: !!settings.startMinimized,
        enabled: !!settings.autoLaunch,
        click: (item) => updateSettings({ startMinimized: item.checked }),
      },
      { type: 'separator' },
      {
        label: 'Schließen minimiert in Tray',
        type: 'checkbox',
        checked: !!settings.closeToTray,
        click: (item) => updateSettings({ closeToTray: item.checked }),
      },
      {
        label: 'Minimieren in Tray',
        type: 'checkbox',
        checked: !!settings.minimizeToTray,
        click: (item) => updateSettings({ minimizeToTray: item.checked }),
      },
      { type: 'separator' },
      {
        label: 'Automatisch nach Updates suchen',
        type: 'checkbox',
        checked: !!settings.autoUpdate,
        click: (item) => updateSettings({ autoUpdate: item.checked }),
      },
      {
        label: updateLabel,
        enabled: updateState !== 'checking' && updateState !== 'downloading',
        click: () => {
          if (updateState === 'ready') {
            isQuitting = true;
            autoUpdater.quitAndInstall();
          } else {
            checkForUpdates(true);
          }
        },
      },
      {
        label: `Version ${app.getVersion()}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Beenden',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(contextMenu);
  };

  updateMenu();
  refreshTrayMenu = updateMenu;

  tray.on('click', showWindow);
  tray.on('double-click', showWindow);

  return tray;
}

// ─── App-Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  applyAutoLaunch();

  // Einmaliger Cache-Reset pro App-Version — sorgt nach Updates dafür,
  // dass veraltete Service-Worker-/HTTP-Caches die UI nicht blockieren.
  try {
    const currentVersion = app.getVersion();
    if (settings.lastCacheResetVersion !== currentVersion) {
      const ses = session.defaultSession;
      Promise.allSettled([
        ses.clearCache(),
        ses.clearStorageData({ storages: ['serviceworkers', 'shadercache', 'cachestorage'] })
      ]).finally(() => {
        settings.lastCacheResetVersion = currentVersion;
        saveSettings(settings);
      });
    }
  } catch (e) {
    console.warn('[cache-reset]', e?.message || e);
  }

  // IPC: Desktop-Einstellungen vom Renderer (Profil-Seite)
  ipcMain.handle('desktop-settings:get', () => ({ ...settings }));
  ipcMain.handle('desktop-settings:set', (_e, partial) => updateSettings(partial));
  ipcMain.handle('desktop-updates:check', () => {
    checkForUpdates(true);
    return { state: updateState, version: app.getVersion() };
  });
  ipcMain.handle('desktop-updates:install', () => {
    if (updateState === 'ready') {
      isQuitting = true;
      autoUpdater.quitAndInstall();
      return true;
    }
    return false;
  });
  ipcMain.handle('desktop-updates:state', () => ({
    state: updateState,
    progress: updateProgress,
    version: app.getVersion(),
  }));

  mainWindow = createWindow();
  if (process.platform !== 'darwin') {
    createTray();
  }

  setupAutoUpdater();
  // Erste Update-Prüfung nach kurzer Verzögerung, danach alle 4 Stunden
  setTimeout(() => checkForUpdates(false), 8000);
  setInterval(() => checkForUpdates(false), 4 * 60 * 60 * 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    } else if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  });
});

app.on('second-instance', () => {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length > 0) {
    const w = wins[0];
    if (!w.isVisible()) w.show();
    if (w.isMinimized()) w.restore();
    w.focus();
  }
});

app.on('window-all-closed', (event) => {
  if (process.platform === 'darwin') return;
  if (!isQuitting) {
    event.preventDefault();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

// ─── macOS Menü ───────────────────────────────────────────────────────────────
function buildMacMenu() {
  const template = [
    {
      label: 'BeeQu',
      submenu: [
        { label: 'Über BeeQu', role: 'about' },
        { type: 'separator' },
        { label: 'Dienste', role: 'services' },
        { type: 'separator' },
        { label: 'BeeQu ausblenden', role: 'hide' },
        { label: 'Andere ausblenden', role: 'hideOthers' },
        { label: 'Alle einblenden', role: 'unhide' },
        { type: 'separator' },
        { label: 'BeeQu beenden', role: 'quit' },
      ],
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { label: 'Rückgängig', role: 'undo' },
        { label: 'Wiederholen', role: 'redo' },
        { type: 'separator' },
        { label: 'Ausschneiden', role: 'cut' },
        { label: 'Kopieren', role: 'copy' },
        { label: 'Einfügen', role: 'paste' },
        { label: 'Alles auswählen', role: 'selectAll' },
      ],
    },
    {
      label: 'Ansicht',
      submenu: [
        { label: 'Neu laden', role: 'reload' },
        { type: 'separator' },
        { label: 'Zoom zurücksetzen', role: 'resetZoom' },
        { label: 'Vergrößern', role: 'zoomIn' },
        { label: 'Verkleinern', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Vollbild', role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Fenster',
      submenu: [
        { label: 'Minimieren', role: 'minimize' },
        { label: 'Zoomen', role: 'zoom' },
        { type: 'separator' },
        { label: 'Alle nach vorne', role: 'front' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
