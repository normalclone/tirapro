import { describe, expect, it } from 'vitest';
import { resolveCurrentProjectKey, safeDecode } from './currentProject';

const projects = [{ key: 'AAA' }, { key: 'BBB' }];
const r = (
  pathname: string,
  lastViewRaw: string | null = null,
  p: { key: string }[] | undefined = projects,
) => resolveCurrentProjectKey({ pathname, projects: p, lastViewRaw });

describe('resolveCurrentProjectKey', () => {
  it('lấy key từ /p/:key', () => expect(r('/p/BBB/board')).toBe('BBB'));
  it('giải mã %-escape hợp lệ', () => expect(r('/p/A%20B/board')).toBe('A B'));
  it('URL hỏng (%E0%A4%A) không ném lỗi, dùng nguyên chuỗi', () => {
    expect(() => r('/p/%E0%A4%A/board')).not.toThrow();
    expect(r('/p/%E0%A4%A/board')).toBe('%E0%A4%A');
  });
  it('ngoài /p → view gần nhất nếu dự án còn tồn tại', () =>
    expect(r('/issue/AAA-1', JSON.stringify({ key: 'BBB', view: 'board' }))).toBe('BBB'));
  it('view gần nhất trỏ dự án đã mất / JSON hỏng → dự án đầu', () => {
    expect(r('/', JSON.stringify({ key: 'ZZZ' }))).toBe('AAA');
    expect(r('/', '{hỏng')).toBe('AAA');
  });
  it('chưa có danh sách dự án → null', () =>
    expect(
      resolveCurrentProjectKey({ pathname: '/', projects: undefined, lastViewRaw: null }),
    ).toBeNull());
});

describe('safeDecode', () => {
  it('không ném lỗi', () => expect(safeDecode('%E0%A4%A')).toBe('%E0%A4%A'));
});
