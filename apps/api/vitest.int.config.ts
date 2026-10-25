import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Spec tích hợp (cần Postgres thật, opt-in qua biến môi trường riêng của từng spec). KHÔNG nằm trong `vitest.config.ts`.
export default defineConfig({
  test: {
    include: ['src/**/*.int-spec.ts'],
    globals: true,
    root: './',
    fileParallelism: false,
    testTimeout: 60_000,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
