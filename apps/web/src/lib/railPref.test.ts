import { describe, expect, it } from 'vitest';
import { railStorageKey, resolveRailCollapsed } from './railPref';

describe('railStorageKey', () => {
  it('khác nhau theo người dùng', () => {
    expect(railStorageKey('u1')).not.toBe(railStorageKey('u2'));
    expect(railStorageKey(undefined)).toContain('anon');
  });
});
describe('resolveRailCollapsed', () => {
  it('người dùng đã chọn thì giữ lựa chọn', () => {
    expect(resolveRailCollapsed('1', 20)).toBe(true);
    expect(resolveRailCollapsed('0', 1)).toBe(false);
  });
  it('chưa chọn: tự thu khi ≤ 3 dự án, mở khi nhiều hơn', () => {
    expect(resolveRailCollapsed(null, 3)).toBe(true);
    expect(resolveRailCollapsed(null, 4)).toBe(false);
  });
  it('chưa biết số dự án → mở (không nháy)', () =>
    expect(resolveRailCollapsed(null, undefined)).toBe(false));
});
