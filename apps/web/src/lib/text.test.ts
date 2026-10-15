import { describe, expect, it } from 'vitest';
import { matchesQuery, normalizeVi } from './text';

describe('normalizeVi', () => {
  it('bỏ dấu, đ→d, hạ chữ thường, dấu gạch thành khoảng trắng', () => {
    expect(normalizeVi('Đăng ký Tài-khoản')).toBe('dang ky tai khoan');
  });
});
describe('matchesQuery', () => {
  it('khớp không dấu, không phân biệt hoa thường, theo từng từ', () => {
    expect(matchesQuery('dang ky', 'Đăng ký tài khoản', 'PSL-STORY-1')).toBe(true);
    expect(matchesQuery('tai khoan dang', 'Đăng ký tài khoản')).toBe(true);
  });
  it('tìm theo mã (trường hint) kể cả gõ thiếu gạch', () => {
    expect(matchesQuery('psl-story-1', 'Đăng ký', 'PSL-STORY-1')).toBe(true);
    expect(matchesQuery('psl 1', 'Đăng ký', 'PSL-STORY-1')).toBe(true);
  });
  it('không khớp và rỗng', () => {
    expect(matchesQuery('zzz', 'Đăng ký', 'PSL-1')).toBe(false);
    expect(matchesQuery('   ', 'a')).toBe(true);
  });
});
