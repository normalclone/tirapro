import { describe, expect, it } from 'vitest';
import type { Workflow } from '@/features/workflow-settings/api';
import { canRevertTransition, computeNextStatuses, transitionLabel } from './nextStatuses';

const st = (id: string, order: number, category: 'TODO' | 'IN_PROGRESS' | 'DONE' = 'TODO') => ({
  id,
  name: id.toUpperCase(),
  category,
  color: null,
  order,
  isInitial: order === 0,
});
/** Mỗi transition = [từ, đến] hoặc [từ, đến, tên hành động]; mặc định tên = id đích. */
const wf = (
  transitions: Array<[string | null, string] | [string | null, string, string]>,
): Workflow => ({
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
  transitions: transitions.map(([f, t, name], i) => ({
    id: `t${i}`,
    name: name ?? t,
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

describe('transitionLabel', () => {
  it('dùng tên hành động; bỏ tên máy sinh kiểu "To <đích>"', () => {
    expect(transitionLabel('Mở lại', 'To Do')).toBe('Mở lại');
    expect(transitionLabel('To To Do', 'To Do')).toBe('To Do');
    expect(transitionLabel('to done', 'Done')).toBe('Done');
    expect(transitionLabel('', 'In Progress')).toBe('In Progress');
    expect(transitionLabel(null, 'Done')).toBe('Done');
  });
});

describe('computeNextStatuses — label', () => {
  it('trả label theo tên transition', () => {
    const w = [
      wf([
        ['review', 'doing', 'Trả lại'],
        ['review', 'done', 'Hoàn thành'],
      ]),
    ];
    const out = computeNextStatuses(w, 'review');
    expect(out.map((s) => s.label)).toEqual(['Trả lại', 'Hoàn thành']);
    expect(out.map((s) => s.transitionName)).toEqual(['Trả lại', 'Hoàn thành']);
    expect(out.map((s) => s.name)).toEqual(['DOING', 'DONE']);
  });
});
