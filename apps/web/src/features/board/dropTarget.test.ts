import { describe, expect, it } from 'vitest';
import type { BoardColumnDto } from '@tirapro/types';
import type { Workflow } from '@/features/workflow-settings/api';
import { resolveDropStatuses } from './dropTarget';

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
const col = (statusIds: string[]): BoardColumnDto => ({
  id: 'c',
  boardId: 'b',
  name: 'Cột',
  order: 0,
  wipLimit: null,
  statusIds,
});

describe('resolveDropStatuses', () => {
  it('thả vào cột đang chứa status hiện tại => stay', () => {
    expect(resolveDropStatuses(col(['doing', 'review']), 'review', [wf([])])).toEqual({
      kind: 'stay',
    });
  });
  it('đúng một status hợp lệ (không phải status đầu) => move với đúng status đó', () => {
    const r = resolveDropStatuses(col(['doing', 'review']), 'todo', [wf([['todo', 'review']])]);
    expect(r).toMatchObject({ kind: 'move', options: [{ id: 'review' }] });
  });
  it('nhiều status hợp lệ => options theo thứ tự trong cột', () => {
    const r = resolveDropStatuses(col(['review', 'doing']), 'todo', [
      wf([
        ['todo', 'doing'],
        [null, 'review'],
      ]),
    ]);
    expect(r.kind === 'move' && r.options.map((o) => o.id)).toEqual(['review', 'doing']);
  });
  it('không status nào trong cột chuyển được => blocked', () => {
    expect(resolveDropStatuses(col(['doing', 'review']), 'todo', [wf([['todo', 'done']])])).toEqual(
      { kind: 'blocked' },
    );
  });
  it('workflow chưa tải => rơi về status đầu của cột để máy chủ kiểm', () => {
    const r = resolveDropStatuses(col(['doing', 'review']), 'todo', undefined);
    expect(r).toMatchObject({ kind: 'move', options: [{ id: 'doing' }] });
  });
});
