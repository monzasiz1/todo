'use strict';

const { app, BrowserWindow, shell, Menu, nativeTheme } = require('electron');
const path = require('path');

// ─── Produktions-URL ─────────────────────────────────────────────────────────
const APP_URL = 'https://beequ.de';

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
    // macOS: Ampel-Buttons beibehalten
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // Kein lokaler Dateizugriff nötig
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Eigenes Menü (nur macOS braucht es für Tastenkürzel wie Cmd+C/V)
  if (process.platform === 'darwin') {
    buildMacMenu();
  } else {
    Menu.setApplicationMenu(null);
  }

  // Splash-Hintergrundfarbe bis Seite geladen
  win.loadURL(APP_URL);

  win.once('ready-to-show', () => {
    win.show();
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

  // Externe Links im System-Browser öffnen, nicht im App-Fenster
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_URL)) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Navigation auf externe Seiten abfangen
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  return win;
}

// ─── App-Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();

  // macOS: Dock-Klick öffnet neues Fenster wenn keines offen
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Zweite Instanz → bestehendes Fenster nach vorne
app.on('second-instance', () => {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length > 0) {
    if (wins[0].isMinimized()) wins[0].restore();
    wins[0].focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
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
