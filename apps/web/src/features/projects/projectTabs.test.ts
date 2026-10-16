import { describe, expect, it } from 'vitest';
import { activeMoreSeg, tabLabelVisible } from './projectTabs';

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
