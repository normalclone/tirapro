import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // App shell là 1 bundle lớn (>2 MiB) → nâng hạn precache để service worker cache trọn.
      workbox: { maximumFileSizeToCacheInBytes: 5 * 1024 * 1024 },
      manifest: {
        name: 'Tirapro',
        short_name: 'Tirapro',
        theme_color: '#3b5bdb',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [],
      },
    }),
  ],
  // Đọc .env ở root monorepo (single source) thay vì apps/web
  envDir: fileURLToPath(new URL('../../', import.meta.url)),
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
