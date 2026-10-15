import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/** Khớp `node_modules/<tên gói>/` kể cả đường dẫn kiểu pnpm (`.pnpm/x@1/node_modules/<tên gói>/`). */
const inPkg = (id: string, names: string) =>
  new RegExp(`[\\\\/]node_modules[\\\\/](?:${names})[\\\\/]`).test(id);

/**
 * Tách vendor thành chunk ổn định để cache lâu dài và để bundle đầu nhỏ lại. recharts và reactflow vẫn chỉ được nạp
 * khi vào trang dùng chúng (route đã lazy) — chunk riêng chỉ giúp đặt tên/cache, không kéo vào bundle đầu.
 */
function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  // clsx dùng chung với recharts: ghim vào đây, nếu không Rollup kéo nó vào chunk recharts và bundle đầu phải nạp recharts.
  if (
    inPkg(
      id,
      'react|react-dom|scheduler|react-router|react-router-dom|@remix-run[\\\\/]router|clsx',
    )
  )
    return 'react';
  if (inPkg(id, '@tanstack[\\\\/][^\\\\/]+')) return 'tanstack';
  if (inPkg(id, '@radix-ui[\\\\/][^\\\\/]+')) return 'radix';
  if (inPkg(id, '@dnd-kit[\\\\/][^\\\\/]+')) return 'dnd-kit';
  // d3-* dùng chung giữa recharts và reactflow: tách riêng, nếu không reactflow phải nạp luôn cả chunk recharts.
  if (inPkg(id, 'd3-[a-z-]+|internmap')) return 'd3';
  if (inPkg(id, 'recharts|recharts-scale|victory-vendor')) return 'recharts';
  if (inPkg(id, 'reactflow|@reactflow[\\\\/][^\\\\/]+')) return 'reactflow';
  return undefined;
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Tirapro',
        short_name: 'Tirapro',
        theme_color: '#3b5bdb',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
    }),
  ],
  // Đọc .env ở root monorepo (single source) thay vì apps/web
  envDir: fileURLToPath(new URL('../../', import.meta.url)),
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    rollupOptions: { output: { manualChunks } },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
