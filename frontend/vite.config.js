import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
