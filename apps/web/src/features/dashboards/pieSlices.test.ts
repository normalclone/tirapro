import { describe, expect, it } from 'vitest';
import type { ProjectReport } from '@/features/reports/api';
import {
  isPieField,
  isQaField,
  slicesFromOverview,
  slicesFromProject,
  slicesFromQa,
} from './pieSlices';

const totals = { total: 10, todo: 4, inProgress: 3, done: 3, overdue: 1, bug: 2 };

describe('slicesFromProject', () => {
  const report = {
    byStatus: [{ name: 'Mở', color: null, count: 1 }],
    byType: [{ name: 'Bug', color: '#f00', count: 2 }],
    byPriority: [{ name: 'Cao', color: null, count: 3 }],
    byAssignee: [
      { id: 'u1', name: 'An', total: 5, inProgress: 1, done: 2, overdue: 0, points: 0 },
      { id: null, name: 'Chưa gán', total: 2, inProgress: 0, done: 0, overdue: 0, points: 0 },
    ],
  } as unknown as ProjectReport;

  it('assignee = việc CHƯA xong (tổng − đã xong), kể cả "Chưa gán"', () => {
    expect(slicesFromProject('assignee', report)).toEqual([
      { name: 'An', color: null, count: 3 },
      { name: 'Chưa gán', color: null, count: 2 },
    ]);
  });
  it('trạng thái / loại / ưu tiên lấy đúng nhóm; severity không có ở báo cáo dự án', () => {
    expect(slicesFromProject('status', report)).toBe(report.byStatus);
    expect(slicesFromProject('type', report)).toBe(report.byType);
    expect(slicesFromProject('priority', report)).toBe(report.byPriority);
    expect(slicesFromProject('severity', report)).toBeUndefined();
  });
});

describe('slicesFromOverview', () => {
  const o = {
    totals,
    byType: [{ name: 'Task', color: null, count: 7 }],
    byPriority: [],
    byAssignee: [{ name: 'Bình', color: null, count: 3 }],
  };
  it('assignee lấy byAssignee của tổng quan (kể cả khi vắng → undefined, ô chờ)', () => {
    expect(slicesFromOverview('assignee', o)).toEqual([{ name: 'Bình', color: null, count: 3 }]);
    expect(slicesFromOverview('assignee', { ...o, byAssignee: undefined })).toBeUndefined();
  });
  it('trạng thái gộp theo nhóm To Do / Đang làm / Xong', () => {
    expect(slicesFromOverview('status', o)?.map((s) => s.count)).toEqual([4, 3, 3]);
  });
  it('severity không có ở tổng quan', () =>
    expect(slicesFromOverview('severity', o)).toBeUndefined());
});

describe('slicesFromQa / guards', () => {
  it('bug đang mở theo mức nghiêm trọng, giữ màu', () => {
    expect(
      slicesFromQa({
        openBySeverity: [
          { severityId: 's1', name: 'Critical', color: '#f00', rank: 4, open: 3 },
          { severityId: null, name: 'Chưa đặt', color: null, rank: 0, open: 0 },
        ],
      }),
    ).toEqual([
      { name: 'Critical', color: '#f00', count: 3 },
      { name: 'Chưa đặt', color: null, count: 0 },
    ]);
  });
  it('nhận đủ 5 trường; chỉ severity lấy từ báo cáo QA', () => {
    for (const f of ['status', 'type', 'priority', 'severity', 'assignee'])
      expect(isPieField(f)).toBe(true);
    expect(isPieField('zzz')).toBe(false);
    expect(isQaField('severity')).toBe(true);
    expect(isQaField('assignee')).toBe(false);
  });
});
