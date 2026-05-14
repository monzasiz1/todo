'use strict';
// Preload: läuft im Renderer-Kontext mit eingeschränkten Rechten.
// Kein Node-API wird an die Webseite übergeben – maximale Sicherheit.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronApp', {
  platform: process.platform,
  version: process.env.npm_package_version || '',
  // Desktop-Einstellungen (Autostart usw.) – Bridge zum Main-Prozess
  getSettings: () => ipcRenderer.invoke('desktop-settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('desktop-settings:set', partial),
  onSettingsChanged: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('desktop-settings:changed', handler);
    return () => ipcRenderer.removeListener('desktop-settings:changed', handler);
  },
  // Auto-Update
  checkForUpdates: () => ipcRenderer.invoke('desktop-updates:check'),
  installUpdate: () => ipcRenderer.invoke('desktop-updates:install'),
  getUpdateState: () => ipcRenderer.invoke('desktop-updates:state'),
  onUpdateStateChanged: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('desktop-updates:state-changed', handler);
    return () => ipcRenderer.removeListener('desktop-updates:state-changed', handler);
  },
  // Navigation: Tray sendet "geh zu Route", Renderer (React Router) reagiert
  onNavigate: (cb) => {
    const handler = (_e, path) => cb(path);
    ipcRenderer.on('desktop-nav:goto', handler);
    return () => ipcRenderer.removeListener('desktop-nav:goto', handler);
  },
});
