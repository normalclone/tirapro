import { describe, expect, it } from 'vitest';
import { assertLocalS3Endpoint } from './local-endpoint-guard.testutil';

describe('assertLocalS3Endpoint — chỉ MinIO cục bộ', () => {
  it.each(['http://127.0.0.1:9100', 'http://localhost:9000', 'http://[::1]:9000'])(
    'cho phép %s',
    (u) => {
      expect(() => assertLocalS3Endpoint(u)).not.toThrow();
    },
  );

  it.each([
    'http://172.20.20.100:9000',
    'http://172.20.20.128:9000',
    'http://minio.company.vn:9000',
    'https://s3.amazonaws.com',
    'http://127.0.0.1.evil.com:9000',
  ])('từ chối %s', (u) => {
    expect(() => assertLocalS3Endpoint(u)).toThrow(/TỪ CHỐI/);
  });

  it('endpoint rác → lỗi', () => {
    expect(() => assertLocalS3Endpoint('không-phải-url')).toThrow(/không hợp lệ/);
  });
});
