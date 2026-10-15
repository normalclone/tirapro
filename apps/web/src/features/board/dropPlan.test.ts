import { describe, expect, it } from 'vitest';
import type { BoardColumnDto, IssueDto } from '@tirapro/types';
import type { Placement } from '@/lib/rankDrop';
import {
  NO_LANE,
  decideDrop,
  dropFeedback,
  dropMessage,
  planDrop,
  splitContainerId,
  type DropContext,
} from './dropPlan';

describe('planDrop', () => {
  it('cùng cột: không đổi thứ tự => ignore; có đổi => reorder', () => {
    expect(planDrop({ resKind: 'stay', assigneeChanged: false, unchanged: true })).toBe('ignore');
    expect(planDrop({ resKind: 'stay', assigneeChanged: false, unchanged: false })).toBe('reorder');
  });
  it('sang cột khác có đường chuyển => status; quy trình chặn => blocked', () => {
    expect(planDrop({ resKind: 'move', assigneeChanged: false, unchanged: false })).toBe('status');
    expect(planDrop({ resKind: 'blocked', assigneeChanged: false, unchanged: false })).toBe(
      'blocked',
    );
  });
  it('đổi người (hàng khác của swimlane theo người) luôn đi đường cũ', () => {
    for (const resKind of ['stay', 'move', 'blocked'] as const)
      expect(planDrop({ resKind, assigneeChanged: true, unchanged: false })).toBe('assign');
  });
  it('cùng cột nhưng khác container (làn khác, không đổi người) => ignore', () => {
    expect(
      planDrop({ resKind: 'stay', assigneeChanged: false, unchanged: false, crossContainer: true }),
    ).toBe('ignore');
  });
});

const col = (id: string, statusIds: string[]): BoardColumnDto =>
  ({ id, name: id, statusIds, wipLimit: null }) as unknown as BoardColumnDto;
const issue = { id: 'i1', status: { id: 's1' }, assigneeId: 'u1' } as unknown as IssueDto;
const ctx = (over: Partial<DropContext> = {}): DropContext => ({
  columns: [col('c1', ['s1']), col('c2', ['s2']), col('c0', [])],
  workflows: undefined,
  swimlaneBy: 'none',
  canAssign: true,
  canEditIssue: () => true,
  ...over,
});
const place = (over: Partial<Placement>): Placement => ({
  containerId: 'c1',
  index: 1,
  total: 3,
  afterId: 'a',
  beforeId: 'b',
  origin: { afterId: null, beforeId: null },
  crossContainer: false,
  unchanged: false,
  ...over,
});

describe('splitContainerId', () => {
  it('tách làn và cột', () => {
    expect(splitContainerId('c1')).toEqual({ laneKey: null, colId: 'c1' });
    expect(splitContainerId('u1::c2')).toEqual({ laneKey: 'u1', colId: 'c2' });
  });
});

describe('decideDrop', () => {
  it('cùng cột: reorder / ignore khi không đổi', () => {
    expect(decideDrop(issue, place({}), ctx())?.plan).toBe('reorder');
    expect(decideDrop(issue, place({ unchanged: true }), ctx())?.plan).toBe('ignore');
  });
  it('sang cột khác => status; cột chưa gắn trạng thái / không có cột => null', () => {
    expect(decideDrop(issue, place({ containerId: 'c2', crossContainer: true }), ctx())?.plan).toBe(
      'status',
    );
    expect(decideDrop(issue, place({ containerId: 'c0', crossContainer: true }), ctx())).toBeNull();
    expect(decideDrop(issue, place({ containerId: 'zz' }), ctx())).toBeNull();
  });
  it('sang cột mà quy trình không cho chuyển tới => blocked (có plan để báo, không vạch/viền)', () => {
    const st = (id: string, order: number) => ({
      id,
      name: id,
      category: 'TODO' as const,
      color: null,
      order,
      isInitial: order === 0,
    });
    // s1 → (không có đường nào) → s2
    const workflows = [
      {
        id: 'wf',
        name: 'wf',
        description: null,
        isTemplate: false,
        isDefault: true,
        projectId: 'p1',
        statuses: [st('s1', 0), st('s2', 1)],
        transitions: [],
      },
    ];
    const p = place({ containerId: 'c2', crossContainer: true });
    const d = decideDrop(issue, p, ctx({ workflows }));
    expect(d?.plan).toBe('blocked');
    expect(dropFeedback(d!.plan, p)).toEqual({ hint: null, container: null });
  });
  it('làn khác cùng cột, làn không phải người => ignore (không vạch chèn)', () => {
    const d = decideDrop(
      issue,
      place({ containerId: 'prio2::c1', crossContainer: true }),
      ctx({ swimlaneBy: 'priority' }),
    );
    expect(d).toMatchObject({ plan: 'ignore', wantsReassign: false });
  });
  it('làn người khác: có quyền => assign; thiếu quyền => ignore nhưng wantsReassign (để báo)', () => {
    const p = place({ containerId: 'u2::c1', crossContainer: true });
    expect(decideDrop(issue, p, ctx({ swimlaneBy: 'assignee' }))).toMatchObject({
      plan: 'assign',
      targetAssignee: 'u2',
      assigneeChanged: true,
    });
    expect(decideDrop(issue, p, ctx({ swimlaneBy: 'assignee', canAssign: false }))).toMatchObject({
      plan: 'ignore',
      wantsReassign: true,
      assigneeChanged: false,
    });
  });
  it('hàng "Chưa có người" = bỏ gán; cùng người thì không phải đổi người', () => {
    const none = place({ containerId: `${NO_LANE}::c1`, crossContainer: true });
    expect(decideDrop(issue, none, ctx({ swimlaneBy: 'assignee' }))).toMatchObject({
      plan: 'assign',
      targetAssignee: null,
    });
    const same = place({ containerId: 'u1::c1', index: 0 });
    expect(decideDrop(issue, same, ctx({ swimlaneBy: 'assignee' }))?.wantsReassign).toBe(false);
  });
});

describe('dropFeedback', () => {
  const cross = place({ containerId: 'c2', crossContainer: true, afterId: 'x', beforeId: null });
  it('status/reorder: vạch chèn + container đích (chỉ khi sang container khác)', () => {
    expect(dropFeedback('status', cross)).toEqual({
      hint: { id: 'x', edge: 'after' },
      container: 'c2',
    });
    expect(dropFeedback('reorder', place({}))).toEqual({ hint: null, container: null });
  });
  it('ignore / không có đích => không vạch, không viền', () => {
    expect(dropFeedback('ignore', cross)).toEqual({ hint: null, container: null });
    expect(dropFeedback(null, cross)).toEqual({ hint: null, container: null });
    expect(dropFeedback('status', null)).toEqual({ hint: null, container: null });
  });
  it('blocked (quy trình không cho chuyển) => không vạch, không viền', () => {
    expect(dropFeedback('blocked', cross)).toEqual({ hint: null, container: null });
  });
  it('assign: có viền hàng đích nhưng KHÔNG có vạch (vị trí bị bỏ)', () => {
    expect(dropFeedback('assign', cross)).toEqual({ hint: null, container: 'c2' });
  });
});

describe('dropMessage', () => {
  const base = { key: 'P-1', colName: 'Doing' };
  const cross = place({ crossContainer: true, index: 1, total: 4 });
  it('theo kết quả của plan', () => {
    expect(dropMessage('over', { ...base, plan: 'status', p: cross })).toBe(
      'P-1 sang cột “Doing”, vị trí 2/4.',
    );
    expect(dropMessage('end', { ...base, plan: 'reorder', p: place({ index: 0, total: 3 }) })).toBe(
      'Đã thả P-1 ở vị trí 1/3 trong cột “Doing”.',
    );
    expect(dropMessage('end', { ...base, plan: 'ignore', p: cross })).toBe(
      'Đã thả P-1, giữ nguyên vị trí.',
    );
    expect(dropMessage('over', { ...base, plan: 'blocked', p: cross })).toBe(
      'P-1: không chuyển được sang cột “Doing” — quy trình không cho phép.',
    );
    expect(dropMessage('end', { ...base, plan: 'blocked', p: cross })).toContain(
      'quy trình không cho phép, giữ nguyên vị trí',
    );
    expect(dropMessage('over', { ...base, plan: 'assign', p: cross })).toContain(
      'đổi người phụ trách',
    );
    expect(dropMessage('end', { ...base, plan: null, p: place({ unchanged: true }) })).toContain(
      'giữ nguyên vị trí 2/3',
    );
    expect(dropMessage('over', { ...base, plan: null, p: null })).toBe('P-1 đang ở ngoài các cột.');
    expect(dropMessage('end', { ...base, plan: null, p: null })).toBe(
      'Đã thả P-1 ra ngoài các cột, giữ nguyên.',
    );
  });
});
