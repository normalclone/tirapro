import { describe, expect, it } from 'vitest';
import {
  pointsConfirmOptions,
  pointsEditWarning,
  pointsEditWarningBulk,
  WARN_TITLE,
} from './pointsWarning';

const issue = (o: Record<string, unknown> = {}) =>
  ({ key: 'P-1', sprintId: null, status: { category: 'TODO' }, ...o }) as never;
const sprints = [
  { id: 's1', name: 'Sprint 1', state: 'CLOSED' },
  { id: 's2', name: 'Sprint 2', state: 'ACTIVE' },
] as never;

describe('pointsEditWarning', () => {
  it('việc bình thường => không cảnh báo', () =>
    expect(pointsEditWarning(issue(), sprints)).toBeNull());
  it('việc trong sprint đang chạy => không cảnh báo', () =>
    expect(pointsEditWarning(issue({ sprintId: 's2' }), sprints)).toBeNull());
  it('việc Done', () =>
    expect(pointsEditWarning(issue({ status: { category: 'DONE' } }), sprints)).toMatch(
      /đã hoàn thành/,
    ));
  it('sprint đã kết thúc: nêu tên sprint và velocity', () => {
    const w = pointsEditWarning(issue({ sprintId: 's1' }), sprints)!;
    expect(w).toContain('Sprint 1');
    expect(w).toMatch(/velocity/i);
  });
  it('vừa Done vừa sprint đã đóng: gộp cả hai lý do', () => {
    const w = pointsEditWarning(issue({ sprintId: 's1', status: { category: 'DONE' } }), sprints)!;
    expect(w).toContain('đã hoàn thành và');
    expect(w).toContain('Sprint 1');
  });
  it('chưa tải sprint => chỉ xét Done', () =>
    expect(pointsEditWarning(issue({ sprintId: 's1' }), undefined)).toBeNull());
});

describe('pointsEditWarningBulk', () => {
  it('đếm số việc bị ảnh hưởng', () => {
    const w = pointsEditWarningBulk(
      [issue(), issue({ status: { category: 'DONE' } }), issue({ sprintId: 's1' })],
      sprints,
    )!;
    expect(w).toContain('2 việc');
  });
  it('không việc nào ảnh hưởng => null', () =>
    expect(pointsEditWarningBulk([issue()], sprints)).toBeNull());
});

describe('pointsConfirmOptions', () => {
  it('nút xác nhận "Vẫn sửa", mô tả là nội dung cảnh báo', () =>
    expect(pointsConfirmOptions('cảnh báo')).toEqual({
      title: WARN_TITLE,
      description: 'cảnh báo',
      confirmLabel: 'Vẫn sửa',
    }));
});
