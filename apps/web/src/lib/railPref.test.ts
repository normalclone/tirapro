import { describe, expect, it } from 'vitest';
import {
  railAutoKey,
  railEffectiveCollapsed,
  railStorageKey,
  railToggleOutcome,
  resolveRailCollapsed,
} from './railPref';

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

describe('resolveRailCollapsed — kết quả tự động lần trước (không nháy khi cache trống)', () => {
  it('chưa biết số dự án: dùng kết quả tự động lần trước', () => {
    expect(resolveRailCollapsed(null, undefined, true)).toBe(true);
    expect(resolveRailCollapsed(null, undefined, false)).toBe(false);
  });
  it('đã biết số dự án thì số thật thắng kết quả cũ', () => {
    expect(resolveRailCollapsed(null, 10, true)).toBe(false);
    expect(resolveRailCollapsed(null, 2, false)).toBe(true);
  });
  it('lựa chọn của người dùng thắng mọi thứ', () =>
    expect(resolveRailCollapsed('0', 1, true)).toBe(false));
});
describe('railAutoKey', () => {
  it('khác khoá lựa chọn và khác nhau theo người', () => {
    expect(railAutoKey('u1')).not.toBe(railStorageKey('u1'));
    expect(railAutoKey('u1')).not.toBe(railAutoKey('u2'));
  });
});

describe('railEffectiveCollapsed — panel Epic loại trừ rail dự án (F2)', () => {
  it('Epic đang mở → rail thu TẠM dù đã lưu mở / chưa chọn', () => {
    expect(railEffectiveCollapsed(false, true)).toBe(true);
  });
  it('Epic đóng (hoặc không có panel Epic) → rail theo lựa chọn đã lưu', () => {
    expect(railEffectiveCollapsed(false, false)).toBe(false);
    expect(railEffectiveCollapsed(true, false)).toBe(true);
  });
  it('rail đã lưu thu + Epic mở → vẫn thu; đóng Epic → về thu như cũ', () => {
    expect(railEffectiveCollapsed(true, true)).toBe(true);
    expect(railEffectiveCollapsed(true, false)).toBe(true);
  });
});

describe('railToggleOutcome — bấm nút thu/mở rail', () => {
  it('không có panel Epic chặn: đảo như U9, Epic giữ nguyên', () => {
    expect(railToggleOutcome(false, false)).toEqual({ pref: '1', closeEpic: false });
    expect(railToggleOutcome(true, false)).toEqual({ pref: '0', closeEpic: false });
  });
  it('rail đang thu tạm vì Epic mở: bấm mở rail → lưu "mở" + thu panel Epic', () => {
    expect(railToggleOutcome(true, true)).toEqual({ pref: '0', closeEpic: true });
  });
  it('rail đang mở thì Epic không thể đang chặn (rail thu tạm); bấm → thu rail bình thường', () => {
    expect(railToggleOutcome(false, true)).toEqual({ pref: '1', closeEpic: false });
  });
});
