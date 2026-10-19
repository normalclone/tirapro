import { describe, expect, it, vi } from 'vitest';
import type { Workflow } from '@/features/workflow-settings/api';
import { statusUndoAction, transitionToastOptions } from './statusUndo';

const st = (id: string, order: number) => ({
  id,
  name: id.toUpperCase(),
  category: 'TODO' as const,
  color: null,
  order,
  isInitial: order === 0,
});
// review → done một chiều; done chỉ về todo.
const wf: Workflow = {
  id: 'wf',
  name: 'wf',
  description: null,
  isTemplate: false,
  isDefault: true,
  projectId: 'p1',
  statuses: [st('todo', 0), st('review', 1), st('done', 2)],
  transitions: [
    ['todo', 'review'],
    ['review', 'todo'],
    ['review', 'done'],
    ['done', 'todo'],
  ].map(([f, t], i) => ({ id: `t${i}`, name: t!, fromStatusId: f!, toStatusId: t!, order: i })),
};
const updated = { id: 'i1', key: 'P-1', version: 7 };
const from = (statusId: string) => ({ statusId, statusName: statusId.toUpperCase() });

describe('statusUndoAction', () => {
  it('bước ngược hợp lệ → có nút Hoàn tác, bấm chạy `run`', () => {
    const run = vi.fn(() => Promise.resolve());
    const a = statusUndoAction([wf], 'todo', 'review', run);
    expect(a?.label).toBe('Hoàn tác');
    a!.onClick();
    expect(run).toHaveBeenCalledOnce();
  });
  it('bước ngược không hợp lệ (review → done) hoặc workflow chưa tải → không có nút', () => {
    expect(statusUndoAction([wf], 'review', 'done', () => Promise.resolve())).toBeUndefined();
    expect(statusUndoAction(undefined, 'todo', 'review', () => Promise.resolve())).toBeUndefined();
  });
});

describe('transitionToastOptions', () => {
  it('hợp lệ: action quay về trạng thái cũ với version MỚI của máy chủ, toast 4s', () => {
    const transition = { mutateAsync: vi.fn(() => Promise.resolve({})) };
    const o = transitionToastOptions({
      workflows: [wf],
      from: from('todo'),
      toStatusId: 'review',
      updated,
      transition,
    });
    expect(o.duration).toBe(4000);
    o.action!.onClick();
    expect(transition.mutateAsync).toHaveBeenCalledWith({
      id: 'i1',
      key: 'P-1',
      toStatusId: 'todo',
      version: 7,
      statusName: 'TODO',
    });
  });
  it('không hợp lệ: không có action, toast ngắn 2s', () => {
    const transition = { mutateAsync: vi.fn() };
    const o = transitionToastOptions({
      workflows: [wf],
      from: from('review'),
      toStatusId: 'done',
      updated,
      transition,
    });
    expect(o.action).toBeUndefined();
    expect(o.duration).toBe(2000);
  });
});
