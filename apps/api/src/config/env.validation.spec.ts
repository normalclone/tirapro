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
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(
      /INTEGRATION_ENCRYPTION_KEY/,
    );
  });

  it('prod: khoá mặc định đặt tường minh → fail-fast', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        INTEGRATION_ENCRYPTION_KEY: DEFAULT_INTEGRATION_ENCRYPTION_KEY,
      }),
    ).toThrow(/INTEGRATION_ENCRYPTION_KEY/);
  });

  it('khoá ngắn hơn 32 ký tự → lỗi', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', INTEGRATION_ENCRYPTION_KEY: 'ngan' }),
    ).toThrow();
  });

  it('prod: khoá riêng đủ dài → ok', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', INTEGRATION_ENCRYPTION_KEY: 'k'.repeat(40) }),
    ).not.toThrow();
  });
});

describe('validateEnv — khoá mã hoá cũ', () => {
  it('prod: khoá mới + khoá cũ (khoá mặc định) → ok', () => {
    const env = validateEnv({
      ...base,
      NODE_ENV: 'production',
      INTEGRATION_ENCRYPTION_KEY: 'k'.repeat(40),
      INTEGRATION_ENCRYPTION_KEY_PREVIOUS: DEFAULT_INTEGRATION_ENCRYPTION_KEY,
    });
    expect(env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS).toBe(DEFAULT_INTEGRATION_ENCRYPTION_KEY);
  });

  it('không đặt / để trống → ok; có đặt nhưng ngắn hơn 32 ký tự → lỗi', () => {
    expect(validateEnv({ ...base }).INTEGRATION_ENCRYPTION_KEY_PREVIOUS).toBe('');
    expect(
      validateEnv({ ...base, INTEGRATION_ENCRYPTION_KEY_PREVIOUS: '' })
        .INTEGRATION_ENCRYPTION_KEY_PREVIOUS,
    ).toBe('');
    expect(() => validateEnv({ ...base, INTEGRATION_ENCRYPTION_KEY_PREVIOUS: 'ngan' })).toThrow(
      /INTEGRATION_ENCRYPTION_KEY_PREVIOUS/,
    );
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

describe('validateEnv — STORAGE_DRIVER=s3', () => {
  const s3 = {
    ...base,
    STORAGE_DRIVER: 's3',
    S3_ENDPOINT: 'http://127.0.0.1:9000',
    S3_BUCKET: 'tirapro',
    S3_ACCESS_KEY: 'ak',
    S3_SECRET_KEY: 'sk',
  };

  it('đủ 4 biến → ok, forcePathStyle mặc định true', () => {
    const env = validateEnv(s3);
    expect(env.STORAGE_DRIVER).toBe('s3');
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it.each(['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'])(
    'thiếu %s → lỗi tiếng Việt nêu đúng tên biến',
    (name) => {
      const env = { ...s3, [name]: '' };
      expect(() => validateEnv(env)).toThrow(new RegExp(`${name}.*STORAGE_DRIVER=s3`));
    },
  );

  it('báo đủ mọi biến thiếu trong một lần', () => {
    expect(() => validateEnv({ ...base, STORAGE_DRIVER: 's3' })).toThrow(
      /S3_ENDPOINT[\s\S]*S3_BUCKET[\s\S]*S3_ACCESS_KEY[\s\S]*S3_SECRET_KEY/,
    );
  });

  it('S3_ENDPOINT phải là URL http(s)', () => {
    expect(() => validateEnv({ ...s3, S3_ENDPOINT: '172.20.20.100:9000' })).toThrow(/S3_ENDPOINT/);
    expect(() => validateEnv({ ...s3, S3_ENDPOINT: 'http://172.20.20.100:9000' })).not.toThrow();
    expect(() => validateEnv({ ...s3, S3_ENDPOINT: 'https://s3.example.com' })).not.toThrow();
  });

  it('thông báo lỗi không in giá trị khoá bí mật', () => {
    try {
      validateEnv({ ...s3, S3_SECRET_KEY: '', S3_ENDPOINT: 'sai', S3_ACCESS_KEY: 'AKIA-LEAK' });
    } catch (e) {
      expect((e as Error).message).not.toContain('AKIA-LEAK');
    }
  });

  it('driver local: không đòi biến S3', () => {
    expect(() => validateEnv({ ...base, STORAGE_DRIVER: 'local' })).not.toThrow();
  });
});

describe('validateEnv — STORAGE_STARTUP_STRICT', () => {
  it('không đặt → undefined (mặc định tính theo NODE_ENV ở configuration)', () => {
    expect(validateEnv(base).STORAGE_STARTUP_STRICT).toBeUndefined();
    expect(
      validateEnv({ ...base, STORAGE_STARTUP_STRICT: '' }).STORAGE_STARTUP_STRICT,
    ).toBeUndefined();
  });

  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
    [false, false],
  ])('đặt %s → %s', (v, want) => {
    expect(validateEnv({ ...base, STORAGE_STARTUP_STRICT: v }).STORAGE_STARTUP_STRICT).toBe(want);
  });

  it('M9: thông báo thiếu S3_ENDPOINT không khẳng định cổng 9000', () => {
    try {
      validateEnv({ ...base, STORAGE_DRIVER: 's3' });
      throw new Error('phải ném');
    } catch (e) {
      expect((e as Error).message).not.toMatch(/9000/);
      expect((e as Error).message).toMatch(/cổng API/);
    }
  });
});

describe('validateEnv — S3_KEY_PREFIX', () => {
  it('mặc định rỗng', () => {
    expect(validateEnv(base).S3_KEY_PREFIX).toBe('');
  });

  it('chuẩn hoá về dạng kết thúc bằng "/"', () => {
    expect(validateEnv({ ...base, S3_KEY_PREFIX: 'tirapro' }).S3_KEY_PREFIX).toBe('tirapro/');
    expect(validateEnv({ ...base, S3_KEY_PREFIX: 'tirapro/' }).S3_KEY_PREFIX).toBe('tirapro/');
  });

  it.each(['/tirapro', '../x', 'a/../b', 'a\\b', 'tira pro', 'a//b'])(
    'từ chối %j (không khởi động)',
    (v) => {
      expect(() => validateEnv({ ...base, S3_KEY_PREFIX: v })).toThrow(/S3_KEY_PREFIX/);
    },
  );
});
