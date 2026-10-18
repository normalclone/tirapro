import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  filterOptions,
  focusTarget,
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

describe('focusTarget', () => {
  it('có ô tìm → focus ô tìm; không → focus listbox', () => {
    expect(focusTarget(true)).toBe('input');
    expect(focusTarget(false)).toBe('list');
  });
});

describe('SearchSelect.pick — chọn lại mục đang chọn không phát onChange', () => {
  const src = readFileSync(join(__dirname, 'SearchSelect.tsx'), 'utf8');
  const pick = src.slice(src.indexOf('function pick('), src.indexOf('function pick(') + 400);
  it('chỉ gọi onChange qua shouldEmitChange(value, v), vẫn đóng popover và xoá ô tìm', () => {
    expect(src).toContain("import { shouldEmitChange } from '@/lib/radioNav'");
    expect(pick).toContain('if (shouldEmitChange(value, v)) onChange(v);');
    expect(pick).not.toMatch(/^\s*onChange\(v\);/m);
    expect(pick).toContain('setOpen(false)');
    expect(pick).toContain('resetSearch()');
  });
});

describe('SearchSelect: hộp danh sách (kiểm nguồn)', () => {
  const src = readFileSync(join(__dirname, 'SearchSelect.tsx'), 'utf8');
  it('danh sách không có ô tìm: hàng đang trỏ vẽ viền khi ul focus-visible (WCAG 2.4.7)', () => {
    expect(src).toMatch(/className="group max-h-64[^"]*outline-none"/);
    expect(src).toContain('group-focus-visible:ring-2');
    expect(src).toContain('group-focus-visible:ring-[var(--ring)]');
  });
  it('ul có tên truy cập dự phòng, chặn mousedown cướp focus, và xoá từ khoá khi ô tìm ẩn', () => {
    expect(src).toContain('aria-label={ariaLabel ?? placeholder}');
    expect(src).toMatch(/onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/);
    expect(src).toMatch(/useClearQueryWhenSearchHidden\(showSearch, setQ\)/);
    expect(src).toMatch(/if \(!showSearch\) setQ\(''\)/);
  });
});
