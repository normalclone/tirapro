import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROJECT_VIEW_ENTRIES,
  activeMoreSeg,
  tabLabelVisible,
  visibleMoreItems,
} from './projectTabs';

describe('tabLabelVisible', () => {
  it('màn hẹp: chỉ tab đang mở hiện nhãn, tab khác chỉ biểu tượng', () => {
    expect(tabLabelVisible(true)).toBe(true);
    expect(tabLabelVisible(false)).toBe(false);
  });
});

describe('activeMoreSeg — màn thuộc menu "Thêm"', () => {
  it('trả segment nếu thuộc menu Thêm', () => {
    for (const s of ['triage', 'activity', 'trash', 'config']) expect(activeMoreSeg(s)).toBe(s);
  });
  it('view chính hoặc segment lạ → null', () => {
    for (const s of ['board', 'backlog', 'gantt', 'tree', 'reports', 'create', '']) {
      expect(activeMoreSeg(s)).toBeNull();
    }
  });
});

describe('visibleMoreItems — mục menu "Thêm" theo quyền', () => {
  const items = [
    { id: 'triage', needs: 'issue:triage' },
    { id: 'activity' },
    { id: 'risks' },
    { id: 'automation', needs: 'automation:manage' },
  ] as const;
  const ids = (can: (p: string) => boolean, hasProject: boolean) =>
    visibleMoreItems(items, can, hasProject).map((i) => i.id);

  it('thiếu issue:triage → không có "Việc mới vào"; có → có', () => {
    expect(ids((p) => p !== 'issue:triage', true)).not.toContain('triage');
    expect(ids(() => true, true)).toContain('triage');
  });
  it('mục không `needs` luôn hiện; chưa có dự án thì ẩn Rủi ro/Tự động hoá', () => {
    expect(ids(() => false, true)).toEqual(['activity', 'risks']);
    expect(ids(() => true, false)).toEqual(['triage', 'activity']);
  });
});

describe('gợi ý 404 trong dự án không bao giờ chỉ tới "Việc mới vào"', () => {
  it('PROJECT_VIEW_ENTRIES không có triage (người thiếu quyền không được dẫn tới màn bị ẩn)', () => {
    expect(PROJECT_VIEW_ENTRIES.some((e) => e.seg === 'triage')).toBe(false);
    expect(JSON.stringify(PROJECT_VIEW_ENTRIES)).not.toMatch(/triage|viec moi vao/i);
  });
});

describe('ProjectLayout: mục "Việc mới vào" đòi issue:triage', () => {
  it('đọc-source: MORE triage có needs: issue:triage; lọc qua visibleMoreItems', () => {
    const src = readFileSync(join(__dirname, 'ProjectLayout.tsx'), 'utf8');
    expect(src).toMatch(/id: 'triage',[\s\S]{0,400}?needs: 'issue:triage'/);
    expect(src).toMatch(/visibleMoreItems\(MORE,/);
  });
});
