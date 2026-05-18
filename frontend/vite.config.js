import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Schreibt nach dem Build eine Liste aller statischen Asset-URLs in
 * dist/sw.js (ersetzt `self.__PRECACHE_MANIFEST__ || []`).
 *
 * Damit kennt der Service Worker alle gehashten Vite-Chunks (auch die
 * dynamisch importierten Page-Bundles) und kann sie schon beim ersten
 * Online-Besuch precachen. Resultat: nach einem einmaligen Online-Start
 * funktioniert die App vollstaendig offline – auch beim Navigieren in
 * Seiten, die noch nie geoeffnet wurden.
 */
function precacheManifestPlugin() {
  return {
    name: 'beequ-sw-precache-manifest',
    apply: 'build',
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      const swPath = path.join(distDir, 'sw.js');
      if (!fs.existsSync(swPath)) return;

      const urls = new Set();
      const walk = (dir, base) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, entry.name);
          const rel = base ? `${base}/${entry.name}` : entry.name;
          if (entry.isDirectory()) walk(abs, rel);
          else urls.add('/' + rel.replace(/\\/g, '/'));
        }
      };

      // Komplette Asset-Verzeichnisse wholesale precachen.
      for (const sub of ['assets', 'fonts', 'icons']) {
        walk(path.join(distDir, sub), sub);
      }
      // Wichtige Einzeldateien.
      for (const file of ['manifest.json']) {
        const abs = path.join(distDir, file);
        if (fs.existsSync(abs)) urls.add('/' + file);
      }

      const urlList = Array.from(urls).sort();
      const manifestJson = JSON.stringify(urlList);
      const sw = fs.readFileSync(swPath, 'utf8');
      const replaced = sw.replace(
        /self\.__PRECACHE_MANIFEST__\s*\|\|\s*\[\]/,
        manifestJson
      );
      if (replaced === sw) {
        console.warn('[sw-precache] Platzhalter self.__PRECACHE_MANIFEST__ nicht gefunden – SW nicht aktualisiert.');
        return;
      }
      fs.writeFileSync(swPath, replaced, 'utf8');
      console.log(`[sw-precache] ${urlList.length} URLs in dist/sw.js eingetragen.`);
    },
  };
}

export default defineConfig({
  plugins: [react(), precacheManifestPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Vendor-Splitting: grosse externe Libs in eigene, langfristig
    // cachebare Chunks aufteilen - so muss bei einem App-Update nicht
    // das gesamte JS-Bundle neu geladen werden.
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-motion': ['framer-motion'],
          'vendor-icons': ['lucide-react'],
          'vendor-date': ['date-fns'],
        },
      },
    },
    // 600 KB Bundle-Warnung ist mit unserem grossen Calendar/Notes-Page
    // nicht aussagekraeftig - nur Buildlog-Spam.
    chunkSizeWarningLimit: 900,
  },
});
