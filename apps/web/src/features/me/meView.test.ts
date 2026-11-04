import { describe, expect, it } from 'vitest';
import type { MeIssueItemDto } from '@tirapro/types';
import {
  buildChart,
  chartSummary,
  defaultBugTab,
  filterByProject,
  MY_OPEN_JQL,
  projectChips,
  rowDue,
  weekLabel,
} from './meView';

const item = (id: string, projectKey: string): MeIssueItemDto =>
  ({ id, key: `${projectKey}-${id}`, projectKey }) as MeIssueItemDto;

describe('chip dự án', () => {
  const items = [item('1', 'B'), item('2', 'A'), item('3', 'A'), item('4', 'C')];
  it('đếm theo dự án, nhiều nhất trước, đồng hạng theo mã', () => {
    expect(projectChips(items)).toEqual([
      { key: 'A', count: 2 },
      { key: 'B', count: 1 },
      { key: 'C', count: 1 },
    ]);
  });
  it('lọc giữ thứ tự gốc; null = tất cả', () => {
    expect(filterByProject(items, 'A').map((i) => i.id)).toEqual(['2', '3']);
    expect(filterByProject(items, null).map((i) => i.id)).toEqual(['1', '2', '3', '4']);
  });
});

describe('defaultBugTab', () => {
  const e: MeIssueItemDto[] = [];
  const one = [item('1', 'A')];
  it('tab đầu tiên có việc; rỗng hết → Chờ test lại', () => {
    expect(defaultBugTab({ awaitingRetest: e, reopened: one, assignedToMe: one })).toBe('reopened');
    expect(defaultBugTab({ awaitingRetest: e, reopened: e, assignedToMe: one })).toBe(
      'assignedToMe',
    );
    expect(defaultBugTab({ awaitingRetest: e, reopened: e, assignedToMe: e })).toBe(
      'awaitingRetest',
    );
  });
});

describe('biểu đồ điểm theo tuần', () => {
  const w = (weekStart: string, ...p: [string, number][]) => ({
    weekStart,
    byProject: p.map(([projectKey, points]) => ({ projectKey, points })),
  });
  it('weekLabel dd/MM', () => expect(weekLabel('2026-11-02')).toBe('02/11'));

  it('mỗi dự án một màu series, cột chồng cộng đúng, tuần trống = 0', () => {
    const m = buildChart([w('2026-10-26', ['A', 3]), w('2026-11-02', ['A', 2], ['B', 5])]);
    expect(m.series).toEqual([
      { key: 'A', color: 'var(--series-1)' },
      { key: 'B', color: 'var(--series-2)' },
    ]);
    expect(m.rows[0]).toMatchObject({ week: '26/10', A: 3, B: 0, total: 3 });
    expect(m.rows[1]).toMatchObject({ week: '02/11', A: 2, B: 5, total: 7 });
    expect(m.totalPoints).toBe(10);
  });

  it('quá 5 dự án: 4 dự án nhiều điểm nhất + "Khác"', () => {
    const m = buildChart([
      w('2026-11-02', ['A', 10], ['B', 9], ['C', 8], ['D', 7], ['E', 2], ['F', 1]),
    ]);
    expect(m.series.map((s) => s.key)).toEqual(['A', 'B', 'C', 'D', 'Khác']);
    expect(m.rows[0]).toMatchObject({ Khác: 3, total: 37 });
  });

  it('tóm tắt chữ cho trình đọc màn hình; không có dữ liệu → "chưa có"', () => {
    const m = buildChart([w('2026-10-26'), w('2026-11-02', ['A', 2], ['B', 5])]);
    expect(chartSummary(m)).toBe('Điểm đã xong theo tuần, tuần 02/11: 7 điểm (B 5, A 2)');
    expect(chartSummary(buildChart([w('2026-11-02')]))).toBe('Điểm đã xong theo tuần: chưa có');
  });
});

describe('rowDue (khớp ô "Đến hạn trong 7 ngày")', () => {
  // 2026-11-04 12:00 giờ VN
  const now = new Date('2026-11-04T05:00:00.000Z');
  const due = (d: string | null, category = 'IN_PROGRESS') =>
    ({ dueDate: d && `${d}T00:00:00.000Z`, status: { category } }) as unknown as MeIssueItemDto;
  it('trước hôm nay = quá hạn; hôm nay … +6 = sắp đến hạn; +7 trở đi hoặc không hạn = không tô', () => {
    expect(rowDue(due('2026-11-03'), now)).toBe('overdue');
    expect(rowDue(due('2026-11-04'), now)).toBe('soon');
    expect(rowDue(due('2026-11-10'), now)).toBe('soon'); // +6
    expect(rowDue(due('2026-11-11'), now)).toBeNull(); // +7
    expect(rowDue(due(null), now)).toBeNull();
  });
  it('nửa đêm VN: 17:30Z ngày 04 đã là ngày 05 → hạn 04 thành quá hạn', () => {
    expect(rowDue(due('2026-11-04'), new Date('2026-11-04T17:30:00.000Z'))).toBe('overdue');
  });
  it('việc đã xong không tô', () => {
    expect(rowDue(due('2026-11-01', 'DONE'), now)).toBeNull();
  });
});

describe('MY_OPEN_JQL', () => {
  it('việc chưa xong giao cho tôi, hạn tăng dần', () => {
    expect(MY_OPEN_JQL).toBe(
      'assignee = currentUser() AND statusCategory != DONE ORDER BY due ASC',
    );
  });
});
