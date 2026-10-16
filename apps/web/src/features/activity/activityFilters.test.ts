import { describe, expect, it } from 'vitest';
import { ACTIVITY_FILTERS, describeActivity, fieldsParam } from './activityFilters';

const a = (o: Record<string, unknown>) =>
  ({
    id: '1',
    field: 'STATUS',
    oldValue: null,
    newValue: null,
    oldLabel: null,
    newLabel: null,
    oldCategory: null,
    newCategory: null,
    pointsDelta: null,
    hasDiff: false,
    actor: null,
    occurredAt: '2026-10-16T00:00:00Z',
    ...o,
  }) as never;

describe('fieldsParam', () => {
  it('Tất cả => undefined; còn lại => CSV', () => {
    expect(fieldsParam('all')).toBeUndefined();
    expect(fieldsParam('status')).toBe('STATUS');
    expect(fieldsParam('other')).toBe('TYPE,RESOLUTION,SCOPE,TIME_SPENT');
  });
  it('id lạ => undefined', () => expect(fieldsParam('zzz')).toBeUndefined());
  it('mỗi loại lịch sử hệ thống xuất hiện đúng một lần trong các chip (trừ Tất cả)', () => {
    const all = ACTIVITY_FILTERS.flatMap((f) => f.fields);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([
      'ASSIGNEE',
      'DESCRIPTION',
      'PRIORITY',
      'RESOLUTION',
      'SCOPE',
      'SPRINT',
      'STATUS',
      'STORY_POINTS',
      'TIME_SPENT',
      'TYPE',
    ]);
  });
});

describe('describeActivity', () => {
  it('người phụ trách có tên, Chưa gán khi null', () => {
    expect(describeActivity(a({ field: 'ASSIGNEE', oldLabel: null, newLabel: 'Dũng' }))).toBe(
      'đổi người phụ trách: Chưa gán → Dũng',
    );
  });
  it('sprint có tên, Backlog khi null', () => {
    expect(describeActivity(a({ field: 'SPRINT', oldLabel: 'Sprint 1', newLabel: null }))).toBe(
      'chuyển sprint: Sprint 1 → Backlog',
    );
  });
  it('mô tả, điểm, trạng thái', () => {
    expect(describeActivity(a({ field: 'DESCRIPTION', hasDiff: true }))).toBe('sửa mô tả');
    expect(describeActivity(a({ field: 'STORY_POINTS', oldValue: '5', newValue: '85' }))).toBe(
      'đổi điểm: 5 → 85',
    );
    expect(describeActivity(a({ field: 'STATUS', oldValue: 'To Do', newValue: 'Done' }))).toBe(
      'đổi trạng thái: To Do → Done',
    );
  });
});
