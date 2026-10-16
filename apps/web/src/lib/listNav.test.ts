import { describe, expect, it } from 'vitest';
import { nextNavIndex } from './listNav';

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
