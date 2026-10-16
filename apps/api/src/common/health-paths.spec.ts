import { describe, expect, it } from 'vitest';
import { buildHealthPaths, isHealthPath } from './health-paths';

describe('buildHealthPaths / isHealthPath', () => {
  it('mặc định api/v1 → đúng ba đường probe', () => {
    expect([...buildHealthPaths('api', 'v1')].sort()).toEqual([
      '/api/v1/health',
      '/api/v1/health/live',
      '/api/v1/health/ready',
    ]);
  });
  it('đổi prefix/version theo config', () => {
    const p = buildHealthPaths('svc', 'v2');
    expect(isHealthPath('/svc/v2/health/live', p)).toBe(true);
    expect(isHealthPath('/api/v1/health/live', p)).toBe(false);
  });
  it('bỏ query string, chịu được / thừa ở prefix', () => {
    const p = buildHealthPaths('/api/', '/v1/');
    expect(isHealthPath('/api/v1/health/ready?probe=1', p)).toBe(true);
  });
  it('khớp chính xác: health/version, health/announcement, healthz không bị bỏ qua', () => {
    const p = buildHealthPaths('api', 'v1');
    for (const u of [
      '/api/v1/health/version',
      '/api/v1/health/announcement',
      '/api/v1/healthz',
      undefined,
    ]) {
      expect(isHealthPath(u, p)).toBe(false);
    }
  });
});
