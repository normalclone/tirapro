import { describe, expect, it } from 'vitest';
import {
  filterOptions,
  nextActiveIndex,
  shouldShowSearch,
  typeaheadIndex,
} from './searchSelectNav';

const it3 = [{ label: 'Cao' }, { label: 'Trung bình', disabled: true }, { label: 'Thấp' }];

describe('nextActiveIndex', () => {
  it('xuống bỏ qua mục disabled và vòng tròn', () => {
    expect(nextActiveIndex(it3, 0, 'ArrowDown')).toBe(2);
    expect(nextActiveIndex(it3, 2, 'ArrowDown')).toBe(0);
  });
  it('lên từ -1 về mục bật cuối', () => {
    expect(nextActiveIndex(it3, -1, 'ArrowUp')).toBe(2);
  });
  it('Home/End', () => {
    expect(nextActiveIndex(it3, 2, 'Home')).toBe(0);
    expect(nextActiveIndex(it3, 0, 'End')).toBe(2);
  });
  it('không có mục bật → -1; phím lạ → null', () => {
    expect(nextActiveIndex([{ label: 'a', disabled: true }], -1, 'ArrowDown')).toBe(-1);
    expect(nextActiveIndex(it3, 0, 'a')).toBeNull();
  });
  it('xuống từ -1 vào mục bật đầu; lên từ mục đầu vòng về mục bật cuối', () => {
    expect(nextActiveIndex(it3, -1, 'ArrowDown')).toBe(0);
    expect(nextActiveIndex(it3, 0, 'ArrowUp')).toBe(2);
  });
  it('PageDown/PageUp nhảy 8 mục, kẹp ở hai đầu, rơi vào mục bật gần nhất', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ label: `m${i}` }));
    expect(nextActiveIndex(many, 0, 'PageDown')).toBe(8);
    expect(nextActiveIndex(many, 15, 'PageDown')).toBe(19);
    expect(nextActiveIndex(many, 19, 'PageUp')).toBe(11);
    expect(nextActiveIndex(many, 3, 'PageUp')).toBe(0);
    const gap = many.map((m, i) => (i === 8 ? { ...m, disabled: true } : m));
    expect(nextActiveIndex(gap, 0, 'PageDown')).toBe(7);
    expect(nextActiveIndex(gap, 16, 'PageUp')).toBe(9);
  });
  it('danh sách rỗng → -1', () => {
    expect(nextActiveIndex([], -1, 'ArrowDown')).toBe(-1);
  });
});

describe('typeaheadIndex', () => {
  it('bỏ dấu, bỏ qua disabled, tìm sau vị trí hiện tại rồi vòng lại', () => {
    const items = [{ label: 'Thấp' }, { label: 'Trung bình' }, { label: 'Tối thượng' }];
    expect(typeaheadIndex(items, 't', 0)).toBe(1);
    expect(typeaheadIndex(items, 't', 2)).toBe(0);
    expect(typeaheadIndex(items, 'tr', -1)).toBe(1);
    expect(typeaheadIndex(items, 'x', 0)).toBe(-1);
  });
  it('không phân biệt hoa thường/dấu và bỏ qua mục disabled', () => {
    const items = [{ label: 'Đã xong' }, { label: 'Cao', disabled: true }, { label: 'Cao nhất' }];
    expect(typeaheadIndex(items, 'D', -1)).toBe(0);
    expect(typeaheadIndex(items, 'c', -1)).toBe(2);
  });
});

describe('shouldShowSearch', () => {
  it('ẩn khi ≤ 6 mục và không tìm phía server', () => {
    expect(shouldShowSearch(4, false)).toBe(false);
    expect(shouldShowSearch(7, false)).toBe(true);
    expect(shouldShowSearch(2, true)).toBe(true);
  });
  it('biên 6 / 7', () => {
    expect(shouldShowSearch(6, false)).toBe(false);
    expect(shouldShowSearch(7, false)).toBe(true);
  });
});

describe('filterOptions', () => {
  const opts = [
    { label: 'Cao', description: 'Làm ngay trong ngày' },
    { label: 'Thấp', hint: 'P4' },
    { label: 'Khoá', disabled: true, description: 'Cần quyền quản trị' },
  ];
  it('rỗng → giữ nguyên; khớp nhãn, mã và mô tả', () => {
    expect(filterOptions(opts, '')).toBe(opts);
    expect(filterOptions(opts, 'ngay').map((o) => o.label)).toEqual(['Cao']);
    expect(filterOptions(opts, 'p4').map((o) => o.label)).toEqual(['Thấp']);
  });
  it('mô tả của mục disabled (lý do vô hiệu) không được tìm', () => {
    expect(filterOptions(opts, 'quyền')).toEqual([]);
    expect(filterOptions(opts, 'khoa').map((o) => o.label)).toEqual(['Khoá']);
  });
});
