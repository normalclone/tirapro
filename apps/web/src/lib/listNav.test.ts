import { describe, expect, it } from 'vitest';
import { navCurrentIndex, nextNavIndex } from './listNav';

describe('nextNavIndex', () => {
  it('chưa focus thẻ nào: j → đầu, k → cuối', () => {
    expect(nextNavIndex(5, -1, 1)).toBe(0);
    expect(nextNavIndex(5, -1, -1)).toBe(4);
  });
  it('đi tiếp / lùi, kẹp ở hai đầu (không vòng)', () => {
    expect(nextNavIndex(5, 2, 1)).toBe(3);
    expect(nextNavIndex(5, 4, 1)).toBe(4);
    expect(nextNavIndex(5, 0, -1)).toBe(0);
  });
  it('danh sách rỗng → -1', () => expect(nextNavIndex(0, -1, 1)).toBe(-1));
});

describe('navCurrentIndex', () => {
  const keys = ['A-1', 'A-2', 'A-3', null];
  it('focus đang ở một dòng → dùng dòng đó, bỏ qua peek', () => {
    expect(navCurrentIndex(keys, 2, 'A-1')).toBe(2);
  });
  it('focus nằm trong panel xem nhanh (không ở dòng nào) → dòng đang xem', () => {
    expect(navCurrentIndex(keys, -1, 'A-2')).toBe(1);
    // j từ dòng đang xem → dòng kế; k → dòng trước (không về đầu/cuối)
    expect(nextNavIndex(keys.length, navCurrentIndex(keys, -1, 'A-2'), 1)).toBe(2);
    expect(nextNavIndex(keys.length, navCurrentIndex(keys, -1, 'A-2'), -1)).toBe(0);
  });
  it('dòng đang xem không còn trong DOM, hoặc không có peek → -1', () => {
    expect(navCurrentIndex(keys, -1, 'A-9')).toBe(-1);
    expect(navCurrentIndex(keys, -1, null)).toBe(-1);
  });
});
