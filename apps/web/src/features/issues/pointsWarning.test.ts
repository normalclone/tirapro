import { describe, expect, it } from 'vitest';
import { confirmPointsEdit, pointsEditWarning, pointsEditWarningBulk } from './pointsWarning';

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

describe('confirmPointsEdit', () => {
  it('mở hộp SAU khi sự kiện phím hiện tại kết thúc (không trong cùng tick) và trả kết quả người dùng chọn', async () => {
    const calls: string[] = [];
    const confirm = (o: { title: string; confirmLabel?: string }) => {
      calls.push(`${o.title}|${o.confirmLabel}`);
      return Promise.resolve(true);
    };
    const p = confirmPointsEdit(confirm, 'cảnh báo');
    expect(calls).toEqual([]); // chưa mở ngay: keypress của Enter còn đang đi tới nút "Vẫn sửa"
    await expect(p).resolves.toBe(true);
    expect(calls).toEqual(['Sửa điểm của việc đã hoàn thành?|Vẫn sửa']);
  });
  it('Huỷ => false', async () => {
    await expect(confirmPointsEdit(() => Promise.resolve(false), 'x')).resolves.toBe(false);
  });
});
