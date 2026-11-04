import { describe, expect, it } from 'vitest';
import type { Workflow } from '@/features/workflow-settings/api';
import { defaultWorkflow, statusIdOf } from './workflowFixtures';
import {
  canRevertTransition,
  computeNextStatuses,
  transitionLabel,
  withSuggestedFirst,
  workflowOfStatus,
  type NextStatus,
} from './nextStatuses';

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

describe('withSuggestedFirst', () => {
  const mkNext = (id: string): NextStatus => ({
    id,
    name: id,
    category: 'IN_PROGRESS',
    order: 0,
    transitionName: null,
    label: id,
  });
  it('đưa gợi ý lên đầu và đánh dấu; thứ tự còn lại giữ nguyên', () => {
    const out = withSuggestedFirst([mkNext('a'), mkNext('b'), mkNext('c')], 'c');
    expect(out.map((s) => s.id)).toEqual(['c', 'a', 'b']);
    expect(out[0]!.suggested).toBe(true);
    expect(out[1]!.suggested).toBeUndefined();
  });
  it('không có gợi ý hoặc gợi ý ngoài danh sách → giữ nguyên chính danh sách', () => {
    const list = [mkNext('a'), mkNext('b')];
    expect(withSuggestedFirst(list, undefined)).toBe(list);
    expect(withSuggestedFirst(list, 'zzz')).toBe(list);
  });
});

describe('workflowOfStatus — quy trình theo loại việc', () => {
  const standard = defaultWorkflow('STANDARD');
  const bug = defaultWorkflow('BUG');
  it('Task (Standard) và Bug cùng dự án mở ra hai quy trình khác nhau', () => {
    expect(workflowOfStatus([standard, bug], statusIdOf('STANDARD', 'In Review'))?.name).toBe(
      'Standard Workflow',
    );
    expect(workflowOfStatus([standard, bug], statusIdOf('BUG', 'Ready for Retest'))?.name).toBe(
      'Bug Workflow',
    );
  });
  it('chưa tải / trạng thái lạ → null', () => {
    expect(workflowOfStatus(undefined, 'x')).toBeNull();
    expect(workflowOfStatus([standard], 'zzz')).toBeNull();
    expect(workflowOfStatus([standard], undefined)).toBeNull();
  });
});
