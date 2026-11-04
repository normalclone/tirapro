import { describe, expect, it } from 'vitest';
import type { BoardColumnDto } from '@tirapro/types';
import type { Workflow } from '@/features/workflow-settings/api';
import { defaultWorkflow, statusIdOf } from '@/features/issues/workflowFixtures';
import { blockedDropMessage, resolveDropStatuses } from './dropTarget';

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

describe('cùng bảng, Bug và Task có quy trình khác nhau', () => {
  const standard = defaultWorkflow('STANDARD');
  const bug = defaultWorkflow('BUG');
  const both = [standard, bug];
  // Cột "Đang làm" gom trạng thái đang làm của CẢ HAI quy trình (như sau khi chuyển đổi: bảng cũ + trạng thái mới).
  const doingCol = col([
    statusIdOf('STANDARD', 'In Progress'),
    statusIdOf('STANDARD', 'In Review'),
    statusIdOf('BUG', 'In Progress'),
    statusIdOf('BUG', 'Ready for Retest'),
  ]);

  it('thẻ Task chỉ thấy đích của quy trình Standard', () => {
    const r = resolveDropStatuses(doingCol, statusIdOf('STANDARD', 'Ready'), both);
    expect(r).toMatchObject({
      kind: 'move',
      options: [{ id: statusIdOf('STANDARD', 'In Progress') }],
    });
  });
  it('thẻ Bug chỉ thấy đích của quy trình Bug (không lẫn In Review)', () => {
    const r = resolveDropStatuses(doingCol, statusIdOf('BUG', 'To Do'), both);
    expect(r).toMatchObject({ kind: 'move', options: [{ id: statusIdOf('BUG', 'In Progress') }] });
    const fromProgress = resolveDropStatuses(doingCol, statusIdOf('BUG', 'Reopened'), both);
    expect(fromProgress).toMatchObject({ kind: 'move' });
    if (fromProgress.kind === 'move')
      expect(fromProgress.options.every((o) => o.id.startsWith('bug:'))).toBe(true);
  });
  it('cột chỉ có trạng thái của quy trình khác → blocked cho thẻ này, vẫn hợp lệ cho thẻ kia', () => {
    const reworkOnly = col([statusIdOf('STANDARD', 'Rework')]);
    expect(resolveDropStatuses(reworkOnly, statusIdOf('BUG', 'In Progress'), both)).toEqual({
      kind: 'blocked',
    });
    expect(
      resolveDropStatuses(reworkOnly, statusIdOf('STANDARD', 'In Review'), both),
    ).toMatchObject({
      kind: 'move',
    });
  });
  it('toast khi không có đích nêu loại việc, trạng thái hiện tại và cột', () => {
    expect(
      blockedDropMessage({ type: { name: 'Bug' }, status: { name: 'Reopened' } }, 'Xong'),
    ).toBe('Quy trình của loại Bug không có bước chuyển từ “Reopened” sang cột “Xong”.');
  });
});
