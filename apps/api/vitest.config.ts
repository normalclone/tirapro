import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// swc để giữ decorator metadata của NestJS (esbuild mặc định không phát emitDecoratorMetadata).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
