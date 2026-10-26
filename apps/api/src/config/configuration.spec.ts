import { afterEach, describe, expect, it } from 'vitest';
import { configuration } from './configuration';

const KEYS = [
  'NODE_ENV',
  'STORAGE_STARTUP_STRICT',
  'INTEGRATION_ENCRYPTION_KEY',
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function withEnv(env: Record<string, string | undefined>) {
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://x',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    INTEGRATION_ENCRYPTION_KEY: 'k'.repeat(40),
  });
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return configuration().storage.startupStrict;
}

describe('configuration.storage.startupStrict', () => {
  it('mặc định: production → true, còn lại → false', () => {
    expect(withEnv({ NODE_ENV: 'production', STORAGE_STARTUP_STRICT: undefined })).toBe(true);
    expect(withEnv({ NODE_ENV: 'development', STORAGE_STARTUP_STRICT: undefined })).toBe(false);
    expect(withEnv({ NODE_ENV: 'test', STORAGE_STARTUP_STRICT: undefined })).toBe(false);
  });

  it('đặt tường minh thắng mặc định (chữa cháy: false ở production)', () => {
    expect(withEnv({ NODE_ENV: 'production', STORAGE_STARTUP_STRICT: 'false' })).toBe(false);
    expect(withEnv({ NODE_ENV: 'development', STORAGE_STARTUP_STRICT: 'true' })).toBe(true);
  });
});
