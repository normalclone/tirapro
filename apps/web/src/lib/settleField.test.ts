import { describe, expect, it } from 'vitest';
import { settleField } from './settleField';

describe('settleField — giá trị ô sau khi lưu xong', () => {
  it('không gõ thêm giữa chừng → về đúng giá trị đã gửi (đã cắt khoảng trắng)', () => {
    expect(settleField('  Dự án A  ', 'Dự án A')).toBe('Dự án A');
    expect(settleField('Dự án A', 'Dự án A')).toBe('Dự án A');
  });
  it('gõ thêm trong lúc lưu → giữ nguyên chữ đang gõ (không ghi đè)', () => {
    expect(settleField('Dự án A mới', 'Dự án A')).toBe('Dự án A mới');
  });
  it('xoá bớt/đổi hẳn trong lúc lưu cũng giữ nguyên', () => {
    expect(settleField('Dự', 'Dự án A')).toBe('Dự');
    expect(settleField('', 'Dự án A')).toBe('');
  });
  it('ô trống đã gửi, vẫn trống → trống', () => {
    expect(settleField('   ', '')).toBe('');
  });
});
