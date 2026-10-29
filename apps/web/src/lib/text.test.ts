import { describe, expect, it } from 'vitest';
import { filterByQuery, matchesQuery, normalizeVi } from './text';

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

describe('filterByQuery', () => {
  const cuid = (n: string) => `cmv9sr5k${n}0029wg9po74d1agc3`;
  const opts = [
    { value: cuid('a'), label: 'Đăng ký', hint: 'PSL-TASK-1' },
    { value: cuid('b'), label: 'Đăng nhập', hint: 'PSL-TASK-3' },
    { value: cuid('c'), label: 'Thanh toán', hint: 'PSL-STORY-13' },
    { value: cuid('d'), label: 'Bị khoá', hint: 'Đã đóng — không chọn được', disabled: true },
  ];
  it('"psl 3" chỉ khớp mã/nhãn thật, không bị id (CUID) làm nhiễu', () => {
    expect(filterByQuery(opts, 'psl 3').map((o) => o.hint)).toEqual(['PSL-TASK-3', 'PSL-STORY-13']);
  });
  it('gõ ký tự có trong id nhưng không có trong nhãn/mã → không khớp', () => {
    expect(filterByQuery(opts, 'wg9po')).toEqual([]);
  });
  it('hint của lựa chọn bị vô hiệu (câu giải thích) không dùng để tìm; nhãn vẫn tìm được', () => {
    expect(filterByQuery(opts, 'chon duoc')).toEqual([]);
    expect(filterByQuery(opts, 'khoa').map((o) => o.label)).toEqual(['Bị khoá']);
  });
  it('chuỗi rỗng → giữ nguyên danh sách', () => {
    expect(filterByQuery(opts, '  ')).toBe(opts);
  });
});
