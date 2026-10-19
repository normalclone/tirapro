import { describe, expect, it } from 'vitest';
import { backLabel, isIndexPath, visibleGroups, type SubNavGroup } from './subNavModel';

const item = (to: string, hidden?: boolean) => ({ to, label: to, hidden });

describe('visibleGroups', () => {
  it('bỏ mục hidden và nhóm rỗng, giữ thứ tự', () => {
    const groups: SubNavGroup[] = [
      { label: 'Chung', items: [item('/a'), item('/b', true)] },
      { label: 'Ẩn hết', items: [item('/c', true)] },
      { items: [item('/d')] },
    ];
    expect(visibleGroups(groups)).toEqual([
      { label: 'Chung', items: [item('/a')] },
      { items: [item('/d')] },
    ]);
  });
  it('không đổi dữ liệu gốc', () => {
    const groups: SubNavGroup[] = [{ items: [item('/a'), item('/b', true)] }];
    visibleGroups(groups);
    expect(groups[0]?.items).toHaveLength(2);
  });
  it('rỗng → rỗng', () => {
    expect(visibleGroups([])).toEqual([]);
  });
});

describe('isIndexPath', () => {
  it('đúng basePath, bỏ qua dấu / cuối', () => {
    expect(isIndexPath('/settings', '/settings')).toBe(true);
    expect(isIndexPath('/settings/', '/settings')).toBe(true);
    expect(isIndexPath('/settings', '/settings/')).toBe(true);
  });
  it('trang con và khu vực khác không phải index', () => {
    expect(isIndexPath('/settings/roles', '/settings')).toBe(false);
    expect(isIndexPath('/settingsx', '/settings')).toBe(false);
    expect(isIndexPath('/manage', '/settings')).toBe(false);
  });
});

describe('backLabel', () => {
  it('"Quay lại {khu vực}"', () => {
    expect(backLabel('Cài đặt')).toBe('Quay lại Cài đặt');
  });
});
