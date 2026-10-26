import { describe, expect, it } from 'vitest';
import { normalizeKeyPrefix } from './s3-key-prefix';

describe('normalizeKeyPrefix — S3_KEY_PREFIX', () => {
  it('rỗng → rỗng (không tiền tố)', () => {
    expect(normalizeKeyPrefix('')).toBe('');
    expect(normalizeKeyPrefix('   ')).toBe('');
  });

  it('chuẩn hoá: luôn kết thúc bằng "/" khi không rỗng; cắt khoảng trắng đầu/cuối', () => {
    expect(normalizeKeyPrefix('tirapro')).toBe('tirapro/');
    expect(normalizeKeyPrefix('tirapro/')).toBe('tirapro/');
    expect(normalizeKeyPrefix('  apps/tirapro  ')).toBe('apps/tirapro/');
    expect(normalizeKeyPrefix('tirapro-prod_1.v2/')).toBe('tirapro-prod_1.v2/');
  });

  it.each([
    ['/tirapro/', 'bắt đầu bằng "/"'],
    ['..', '".."'],
    ['a/../b', '".."'],
    ['../tirapro', '".."'],
    ['a/./b', '"."'],
    ['a\\b', 'dấu "\\"'],
    ['a//b', '"//"'],
    ['tira pro', 'ký tự'],
    ['tirapro/ünicode', 'ký tự'],
    ['a?b', 'ký tự'],
    ['a*b', 'ký tự'],
    ['a\0b', 'ký tự'],
    ['x'.repeat(201), 'dài'],
  ])('từ chối %j', (raw, why) => {
    expect(() => normalizeKeyPrefix(raw)).toThrow(/S3_KEY_PREFIX/);
    expect(() => normalizeKeyPrefix(raw)).toThrow(new RegExp(why.replace(/[\\"]/g, '.')));
  });
});
