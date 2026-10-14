import { describe, expect, it } from 'vitest';
import { DEFAULT_INTEGRATION_ENCRYPTION_KEY, validateEnv } from './env.validation';

const base = {
  DATABASE_URL: 'postgresql://x',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('validateEnv — khoá mã hoá', () => {
  it('dev: cho phép khoá mặc định', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'development' })).not.toThrow();
  });

  it('prod: thiếu khoá (dùng mặc định) → fail-fast', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/INTEGRATION_ENCRYPTION_KEY/);
  });

  it('prod: khoá mặc định đặt tường minh → fail-fast', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', INTEGRATION_ENCRYPTION_KEY: DEFAULT_INTEGRATION_ENCRYPTION_KEY }),
    ).toThrow(/INTEGRATION_ENCRYPTION_KEY/);
  });

  it('khoá ngắn hơn 32 ký tự → lỗi', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', INTEGRATION_ENCRYPTION_KEY: 'ngan' })).toThrow();
  });

  it('prod: khoá riêng đủ dài → ok', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', INTEGRATION_ENCRYPTION_KEY: 'k'.repeat(40) }),
    ).not.toThrow();
  });
});
