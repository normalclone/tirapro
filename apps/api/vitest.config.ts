import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.spec.ts'],
  },
  // swc để giữ decorator metadata của NestJS
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
