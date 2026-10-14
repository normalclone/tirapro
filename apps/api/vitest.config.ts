import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['src/**/*.spec.ts'], globals: true, root: './' },
  plugins: [swc.vite({ module: { type: 'es6' } })], // decorator metadata cho Nest
});
