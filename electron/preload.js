'use strict';
// Preload: läuft im Renderer-Kontext mit eingeschränkten Rechten.
// Kein Node-API wird an die Webseite übergeben – maximale Sicherheit.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronApp', {
  platform: process.platform,
  version: process.env.npm_package_version || '',
});
