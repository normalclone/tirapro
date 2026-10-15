import { describe, expect, it } from 'vitest';
import type { Workflow } from '@/features/workflow-settings/api';
import { canRevertTransition } from './nextStatuses';

const st = (id: string, order: number, category: 'TODO' | 'IN_PROGRESS' | 'DONE' = 'TODO') => ({
  id,
  name: id.toUpperCase(),
  category,
  color: null,
  order,
  isInitial: order === 0,
});
const wf = (transitions: Array<[string | null, string]>): Workflow => ({
  id: 'wf',
  name: 'wf',
  description: null,
  isTemplate: false,
  isDefault: true,
  projectId: 'p1',
  statuses: [
    st('todo', 0),
    st('doing', 1, 'IN_PROGRESS'),
    st('review', 2, 'IN_PROGRESS'),
    st('done', 3, 'DONE'),
  ],
  transitions: transitions.map(([f, t], i) => ({
    id: `t${i}`,
    name: t,
    fromStatusId: f,
    toStatusId: t,
    order: i,
  })),
});

describe('canRevertTransition — nút Hoàn tác chỉ khi bước ngược hợp lệ', () => {
  // review → done một chiều; done chỉ về todo (giống workflow mặc định).
  const w = [
    wf([
      ['todo', 'doing'],
      ['doing', 'review'],
      ['doing', 'todo'],
      ['review', 'doing'],
      ['review', 'done'],
      ['done', 'todo'],
    ]),
  ];
  it('có transition ngược → true', () => {
    expect(canRevertTransition(w, 'todo', 'doing')).toBe(true);
    expect(canRevertTransition(w, 'doing', 'review')).toBe(true);
  });
  it('review → done: done chỉ về todo nên KHÔNG hoàn tác được', () => {
    expect(canRevertTransition(w, 'review', 'done')).toBe(false);
  });
  it('transition "bất kỳ" (fromStatusId null) tính là hợp lệ', () => {
    expect(
      canRevertTransition(
        [
          wf([
            ['doing', 'done'],
            [null, 'doing'],
          ]),
        ],
        'done',
        'doing',
      ),
    ).toBe(true);
  });
  it('workflow chưa tải hoặc không chứa trạng thái mới → false (không hứa điều chưa kiểm chứng)', () => {
    expect(canRevertTransition(undefined, 'todo', 'doing')).toBe(false);
    expect(canRevertTransition([], 'todo', 'doing')).toBe(false);
    expect(canRevertTransition(w, 'todo', 'khong-co')).toBe(false);
  });
});
