import { describe, expect, it } from 'vitest';
import {
  resolvedLast14Days,
  sourceFromProjectReport,
  statValue,
  type StatSource,
} from './statMetrics';

const overview: StatSource = {
  totals: { overdue: 4, bug: 7, total: 30, done: 9, inProgress: 3, todo: 18 },
  projectCount: 5,
};

describe('statValue', () => {
  it('overdue lấy từ totals.overdue; bugs từ totals.bug; projects từ projectCount', () => {
    expect(statValue('overdue', overview)).toBe(4);
    expect(statValue('bugs', overview)).toBe(7);
    expect(statValue('projects', overview)).toBe(5);
  });

  it('open = To Do + In Progress (không tính việc đã xong)', () => {
    expect(statValue('open', overview)).toBe(21);
  });

  it('done14 không có nguồn → null (ô hiện "—", không bịa số 0); có nguồn → đúng số, kể cả 0', () => {
    expect(statValue('done14', overview)).toBeNull();
    expect(statValue('done14', { ...overview, resolved14: 0 })).toBe(0);
    expect(statValue('done14', { ...overview, resolved14: 12 })).toBe(12);
  });
});

describe('resolvedLast14Days', () => {
  it('cộng resolved của 14 ngày cuối, bỏ ngày cũ hơn', () => {
    const series = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      created: 0,
      resolved: i < 6 ? 100 : 1,
    }));
    expect(resolvedLast14Days(series)).toBe(14);
    expect(resolvedLast14Days([])).toBe(0);
  });
});

describe('sourceFromProjectReport', () => {
  const report = {
    totals: { total: 10, todo: 4, inProgress: 3, done: 3, overdue: 2, unassigned: 1, points: 20 },
    byType: [
      { name: 'Bug', color: null, count: 2 },
      { name: 'Lỗi giao diện', color: null, count: 1 },
      { name: 'Task', color: null, count: 7 },
    ],
  };

  it('gom bug theo tên loại (Bug / Lỗi…), một dự án', () => {
    const src = sourceFromProjectReport(report, 5);
    expect(src.totals).toEqual({ total: 10, todo: 4, inProgress: 3, done: 3, overdue: 2, bug: 3 });
    expect(src.projectCount).toBe(1);
    expect(statValue('done14', src)).toBe(5);
  });
});
