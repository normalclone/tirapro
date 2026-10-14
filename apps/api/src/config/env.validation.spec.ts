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

describe('validateEnv — email', () => {
  it('mặc định: driver console, web URL localhost', () => {
    const env = validateEnv({ ...base, NODE_ENV: 'development' });
    expect(env.MAIL_DRIVER).toBe('console');
    expect(env.APP_WEB_URL).toBe('http://localhost:5173');
  });

  it('driver lạ hoặc APP_WEB_URL không phải URL → lỗi', () => {
    expect(() => validateEnv({ ...base, MAIL_DRIVER: 'sendgrid' })).toThrow(/MAIL_DRIVER/);
    expect(() => validateEnv({ ...base, APP_WEB_URL: 'không-phải-url' })).toThrow(/APP_WEB_URL/);
  });
});
