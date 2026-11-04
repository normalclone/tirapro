import { describe, expect, it } from 'vitest';
import {
  bucketDonePoints,
  classifyStatuses,
  sortMyIssueKeys,
  vnWeekStarts,
} from './me-overview.logic';

describe('classifyStatuses', () => {
  const st = (id: string, name: string, category: 'TODO' | 'IN_PROGRESS' | 'DONE') => ({
    id,
    name,
    category,
  });
  const out = classifyStatuses([
    st('1', 'Ready for Retest', 'DONE'),
    st('2', 'Chờ test lại', 'IN_PROGRESS'),
    st('3', 'Đang TEST', 'IN_PROGRESS'),
    st('4', 'Test xong', 'DONE'), // tên có "test" nhưng không thuộc IN_PROGRESS
    st('5', 'Reopened', 'TODO'),
    st('6', 'Mở lại', 'IN_PROGRESS'),
    st('7', 'MỞ LẠI', 'TODO'),
    st('8', 'In Progress', 'IN_PROGRESS'),
    st('9', 'Latest review', 'IN_PROGRESS'), // "test" chỉ là đoạn trong từ khác → không khớp
    st('10', 'Contest', 'IN_PROGRESS'),
    st('11', 'In QA Testing', 'IN_PROGRESS'),
    st('12', 'Re-test', 'IN_PROGRESS'),
    st('13', 'Retest', 'IN_PROGRESS'),
    st('14', 'Chờ TEST (QA)', 'IN_PROGRESS'),
  ]);

  it('awaitingRetest: tên Ready for Retest HOẶC IN_PROGRESS có nguyên từ test/testing/retest (không phân biệt hoa/thường/dấu)', () => {
    expect([...out.awaitingRetest].sort()).toEqual(['1', '11', '12', '13', '14', '2', '3']);
  });
  it('reopened: Reopened / Mở lại, không phân biệt hoa/thường/dấu', () => {
    expect([...out.reopened].sort()).toEqual(['5', '6', '7']);
  });
});

describe('sortMyIssueKeys', () => {
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
  it('hạn tăng dần (không hạn cuối), rồi ưu tiên giảm dần (không ưu tiên cuối), rồi id', () => {
    const rows = [
      { id: 'a', dueDate: null, priorityRank: 5 },
      { id: 'b', dueDate: d('2026-11-10'), priorityRank: 1 },
      { id: 'c', dueDate: d('2026-11-10'), priorityRank: 4 },
      { id: 'd', dueDate: d('2026-11-01'), priorityRank: null },
      { id: 'e', dueDate: d('2026-11-10'), priorityRank: null },
      { id: 'f', dueDate: d('2026-11-10'), priorityRank: 4 },
      { id: 'g', dueDate: null, priorityRank: 9 },
    ];
    expect(sortMyIssueKeys(rows).map((r) => r.id)).toEqual(['d', 'c', 'f', 'b', 'e', 'g', 'a']);
  });
});

describe('vnWeekStarts', () => {
  it('8 tuần, cũ → mới, mỗi tuần bắt đầu Thứ Hai theo giờ VN; tuần cuối chứa hôm nay (giờ VN)', () => {
    // 2026-11-01 (CN) 17:30Z = 2026-11-02 (T2) 00:30 giờ VN → đã sang tuần mới.
    const w = vnWeekStarts(new Date('2026-11-01T17:30:00.000Z'));
    expect(w).toHaveLength(8);
    expect(w[7]!.label).toBe('2026-11-02');
    expect(w[6]!.label).toBe('2026-10-26');
    expect(w[0]!.label).toBe('2026-09-14');
    // Mốc tức thời = 00:00 VN = 17:00Z của ngày trước.
    expect(w[7]!.from.toISOString()).toBe('2026-11-01T17:00:00.000Z');
  });
  it('CN 23:59 VN vẫn là tuần cũ', () => {
    // 2026-11-01 16:59Z = CN 23:59 VN.
    const w = vnWeekStarts(new Date('2026-11-01T16:59:00.000Z'));
    expect(w[7]!.label).toBe('2026-10-26');
  });
});

describe('bucketDonePoints', () => {
  const weeks = vnWeekStarts(new Date('2026-11-04T05:00:00.000Z')); // tuần của 2026-11-02
  const row = (resolvedAt: string, projectKey: string, points: number) => ({
    resolvedAt: new Date(resolvedAt),
    projectKey,
    points,
  });

  it('ranh giới tuần VN: 16:59:59Z CN thuộc tuần trước, 17:00:00Z CN thuộc tuần mới', () => {
    const res = bucketDonePoints(weeks, [
      row('2026-11-01T16:59:59.000Z', 'AAA', 3),
      row('2026-11-01T17:00:00.000Z', 'AAA', 5),
    ]);
    expect(res[6]).toEqual({
      weekStart: '2026-10-26',
      byProject: [{ projectKey: 'AAA', points: 3 }],
    });
    expect(res[7]).toEqual({
      weekStart: '2026-11-02',
      byProject: [{ projectKey: 'AAA', points: 5 }],
    });
  });

  it('cộng theo dự án (sắp theo điểm giảm dần), tuần trống → byProject rỗng, bỏ điểm ngoài 8 tuần', () => {
    const res = bucketDonePoints(weeks, [
      row('2026-11-03T01:00:00.000Z', 'AAA', 2),
      row('2026-11-03T02:00:00.000Z', 'BBB', 5),
      row('2026-11-04T02:00:00.000Z', 'AAA', 2.5),
      row('2025-01-01T00:00:00.000Z', 'OLD', 99),
    ]);
    expect(res[7]!.byProject).toEqual([
      { projectKey: 'BBB', points: 5 },
      { projectKey: 'AAA', points: 4.5 },
    ]);
    expect(res[0]!.byProject).toEqual([]);
    expect(res.flatMap((w) => w.byProject).some((p) => p.projectKey === 'OLD')).toBe(false);
  });
});
