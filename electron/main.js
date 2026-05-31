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
  app.setAppUserModelId('com.beequ.app');
}

// ─── Performance-Switches (müssen VOR app.ready laufen) ─────────────────────
// Nur die bewaehrten Drosselungs-Abschalter — keine aggressiven GPU-Flags,
// die auf manchen Windows-Treibern Stutter erzeugen.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

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
  autoUpdate: false,
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

  // Kein eigener Pre-Splash mehr. Das Fenster bleibt 'show:false', lädt im
  // Hintergrund (paintWhenInitiallyHidden:true) und wird erst sichtbar, sobald
  // die Seite bereit ist. Der animierte AppLaunchSplash der App selbst
  // übernimmt dann die Splash-Anzeige.
  if (!startedHidden) {
    win.loadURL(APP_START_URL).catch(() => {});
  } else {
    // Tray-Start: lädt im Hintergrund, ohne dass das Fenster auftaucht.
    win.loadURL(APP_START_URL).catch(() => {});
  }

  // Verhindere, dass Chromium den Renderer einfriert/throttled,
  // waehrend das Fenster im Tray versteckt ist. Das ist die Hauptursache
  // fuer den "white screen + nichts klickbar"-Effekt nach Tray-Restore.
  try { win.webContents.setBackgroundThrottling(false); } catch {}
  try { win.webContents.setFrameRate(60); } catch {}

  // Nach jedem show() einen Repaint erzwingen — Chromium markiert versteckte
  // Fenster als occluded und liefert sonst keinen Frame bis zu einer Interaktion.
  // Wichtig: NUR bei show/restore (nach Tray-Hide). Nicht bei focus, sonst
  // entsteht ein voller Repaint bei jedem Window-Focus -> spuerbares Stottern.
  win.on('show', () => {
    try { win.webContents.invalidate(); } catch {}
  });
  win.on('restore', () => {
    try { win.webContents.invalidate(); } catch {}
  });

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
let installAfterDownload = false; // true, wenn das Update nach Download-Ende
                                  // automatisch installiert werden soll.

// Sauberes Herunterfahren vor dem Installer.
// Wenn wir das nicht machen, laufen Tray-Prozess + Renderer noch waehrend NSIS
// die alten Dateien loeschen will -> Fehler "Die alten Anwendungsdateien
// konnten nicht deinstalliert werden" (NSIS-Code 2).
function performInstallNow() {
  isQuitting = true;
  installAfterDownload = false;
  try {
    // Tray-Icon freigeben (haelt sonst den Hauptprozess am Leben)
    if (tray) { try { tray.destroy(); } catch {} tray = null; }
  } catch {}
  try {
    // close-Handler haengen alle vom mainWindow ab und verhindern sonst das Quit
    if (mainWindow) {
      mainWindow.removeAllListeners('close');
      mainWindow.removeAllListeners('minimize');
      try { mainWindow.hide(); } catch {}
    }
  } catch {}
  // Alle Fenster destroyen (nicht nur close), damit kein Hide-Handler greift
  try {
    BrowserWindow.getAllWindows().forEach((w) => {
      try { w.removeAllListeners('close'); } catch {}
      try { w.destroy(); } catch {}
    });
  } catch {}
  // Etwas Luft geben, damit OS die Datei-Handles freigibt, dann installieren.
  setTimeout(() => {
    try {
      // (isSilent=true, isForceRunAfter=true)
      autoUpdater.quitAndInstall(true, true);
    } catch (e) {
      console.error('quitAndInstall fehlgeschlagen:', e);
      // Fallback: hart beenden, damit der naechste Start die Update-Datei nutzt
      app.exit(0);
    }
  }, 600);
}

function setupAutoUpdater() {
  // In Dev-Modus (kein gepacktes App-Bundle) gibt es keine Updates
  if (!app.isPackaged) return;

  // autoDownload haengt davon ab, ob "automatisch updaten" aktiviert ist.
  // Default = false → User-Click loest Download+Install in einem Schritt aus.
  autoUpdater.autoDownload = !!settings.autoUpdate;
  autoUpdater.autoInstallOnAppQuit = true;
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
    // Kein Dialog — Titlebar-Badge zeigt den Status.
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
    installAfterDownload = false;
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
    // Wenn der User den Vorgang ausgeloest hat (Klick auf Update-Badge),
    // installieren wir sofort silent und starten neu — kein zweiter Klick noetig.
    if (installAfterDownload) {
      performInstallNow();
    }
  });

  autoUpdater.on('error', (err) => {
    updateState = 'error';
    refreshTrayMenu();
    broadcastUpdateState();
    console.error('AutoUpdater-Fehler:', err);
    installAfterDownload = false;
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
  updateUserInitiated = userInitiated;
  // Periodische Pruefung laeuft immer (damit die Titlebar 'Update verfuegbar'
  // anzeigen kann). Nur das automatische Herunterladen wird durch die
  // Einstellung 'autoUpdate' gesteuert.
  autoUpdater.autoDownload = userInitiated ? true : !!settings.autoUpdate;
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
    try { mainWindow.webContents.setBackgroundThrottling(false); } catch {}
    if (mainWindow.isMinimized()) mainWindow.restore();
    // showInactive zuerst, damit Chromium den Compositor reaktiviert,
    // bevor wir das Fenster nach vorne holen — vermeidet weisse Frames.
    if (!mainWindow.isVisible()) {
      try { mainWindow.showInactive(); } catch { mainWindow.show(); }
    }
    try { mainWindow.moveTop(); } catch {}
    mainWindow.show();
    // Windows-Workaround: erzwingt korrekte Foreground-Aktivierung,
    // sonst bleibt das Fenster manchmal "tot" (sichtbar, aber nicht klickbar).
    if (process.platform === 'win32') {
      try {
        mainWindow.setAlwaysOnTop(true);
        mainWindow.setAlwaysOnTop(false);
      } catch {}
    }
    mainWindow.focus();
    try { mainWindow.webContents.invalidate(); } catch {}
    // Zweiter Repaint nach naechstem Frame fuer GPU-Compositor.
    setTimeout(() => {
      try { mainWindow && mainWindow.webContents.invalidate(); } catch {}
    }, 50);
  };

  // Tray-Schnellzugriff: Fenster zeigen + auf die gewuenschte Route navigieren.
  const navigateTo = (path) => {
    showWindow();
    const send = () => {
      try { mainWindow && mainWindow.webContents.send('desktop-nav:goto', path); } catch {}
    };
    // Falls die Seite noch nicht geladen ist, warten wir kurz.
    if (mainWindow && mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', () => setTimeout(send, 120));
    } else {
      setTimeout(send, 50);
    }
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
      // ── Header ────────────────────────────────────────────────────────────
      {
        label: `BeeQu  ·  v${app.getVersion()}`,
        enabled: false,
      },
      { type: 'separator' },

      // ── Hauptaktion ───────────────────────────────────────────────────────
      {
        label: 'Fenster öffnen',
        click: showWindow,
      },

      { type: 'separator' },

      // ── Schnellzugriff ────────────────────────────────────────────────────
      { label: 'Schnellzugriff', enabled: false },
      {
        label: 'Dashboard',
        accelerator: 'Alt+1',
        click: () => navigateTo('/app'),
      },
      {
        label: 'Kalender',
        accelerator: 'Alt+2',
        click: () => navigateTo('/app/calendar'),
      },
      {
        label: 'Notizen',
        accelerator: 'Alt+3',
        click: () => navigateTo('/app/notes'),
      },
      {
        label: 'Gruppen',
        accelerator: 'Alt+4',
        click: () => navigateTo('/app/groups'),
      },
      {
        label: 'Chat',
        accelerator: 'Alt+5',
        click: () => navigateTo('/app/chat'),
      },
      {
        label: 'Profil',
        click: () => navigateTo('/app/profile'),
      },

      { type: 'separator' },

      // ── Verhalten ─────────────────────────────────────────────────────────
      { label: 'Verhalten', enabled: false },
      {
        label: 'Beim Schließen in Tray minimieren',
        type: 'checkbox',
        checked: !!settings.closeToTray,
        click: (item) => updateSettings({ closeToTray: item.checked }),
      },
      {
        label: 'Beim Minimieren in Tray ablegen',
        type: 'checkbox',
        checked: !!settings.minimizeToTray,
        click: (item) => updateSettings({ minimizeToTray: item.checked }),
      },

      { type: 'separator' },

      // ── Autostart ────────────────────────────────────────────────────────
      { label: 'Autostart', enabled: false },
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

      // ── Updates ──────────────────────────────────────────────────────────
      {
        label: 'Updates',
        submenu: [
          {
            label: 'Automatisch nach Updates suchen',
            type: 'checkbox',
            checked: !!settings.autoUpdate,
            click: (item) => updateSettings({ autoUpdate: item.checked }),
          },
          { type: 'separator' },
          {
            label: updateLabel,
            enabled: updateState !== 'checking' && updateState !== 'downloading',
            click: () => {
              if (updateState === 'ready') {
                performInstallNow();
              } else if (updateState === 'available') {
                installAfterDownload = true;
                updateUserInitiated = true;
                try {
                  autoUpdater.autoDownload = true;
                  autoUpdater.downloadUpdate().catch(() => {});
                } catch {}
              } else {
                installAfterDownload = true;
                autoUpdater.autoDownload = true;
                checkForUpdates(true);
              }
            },
          },
        ],
      },

      { type: 'separator' },

      // ── Beenden ──────────────────────────────────────────────────────────
      {
        label: 'BeeQu beenden',
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
    // Bereits heruntergeladen → sofort silent installieren
    if (updateState === 'ready') {
      performInstallNow();
      return true;
    }
    // Update ist gefunden, aber noch nicht (komplett) geladen
    // → Download anstossen und nach Abschluss automatisch installieren.
    if (updateState === 'available' || updateState === 'downloading') {
      installAfterDownload = true;
      updateUserInitiated = true;
      try {
        autoUpdater.autoDownload = true;
        autoUpdater.downloadUpdate().catch(() => {});
      } catch {}
      return true;
    }
    // Idle / none / error → erst pruefen, dann automatisch alles durchziehen.
    installAfterDownload = true;
    updateUserInitiated = true;
    try {
      autoUpdater.autoDownload = true;
      checkForUpdates(true);
    } catch {}
    return true;
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
