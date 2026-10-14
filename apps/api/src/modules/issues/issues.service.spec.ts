import { describe, expect, it, vi } from 'vitest';
import { IssuesService } from './issues.service';

const now = new Date('2026-10-15T00:00:00Z');

/** Dòng issue đủ trường để toDto() không văng lỗi. */
function issueRow(over: Record<string, unknown> = {}) {
  return {
    id: 'i1', key: 'P-TASK-1', summary: 's', workspaceId: 'w1', projectId: 'p1', number: 1,
    description: null, descriptionFormat: 'MARKDOWN',
    type: { id: 't1', name: 'Task', key: 'task', iconUrl: null, color: null, hierarchyLevel: 0, isSubtask: false },
    typeId: 't1',
    status: { id: 's1', workflowId: 'wf', name: 'Todo', category: 'TODO', color: null, order: 0, isInitial: true },
    statusId: 's1',
    priority: null, priorityId: null, severity: null, resolution: null, resolutionId: null,
    assignee: null, assigneeId: null, reporter: null, reporterId: 'u1', createdById: 'u1',
    parentId: null, epicId: null, sprintId: null, storyPoints: null,
    originalEstimate: null, remainingEstimate: null, timeSpent: null,
    dueDate: null, startDate: null, resolvedAt: null, triageState: null, triageSnoozeUntil: null, occurrenceCount: 0,
    rank: 'n', version: 3, labels: [], createdAt: now, updatedAt: now,
    ...over,
  };
}

function makeService(tx: Record<string, unknown>, prismaExtra: Record<string, unknown> = {}) {
  const prisma = { $transaction: (fn: (t: unknown) => unknown) => fn(tx), ...tx, ...prismaExtra };
  const events = { emit: vi.fn() };
  const rbac = { getEffectivePermissions: vi.fn() };
  const service = new IssuesService(prisma as never, events as never, rbac as never);
  return { service, events, prisma };
}

describe('IssuesService.move — rebalance khi hết chỗ chèn', () => {
  it('rank hai mốc sát nhau => đánh số lại project rồi tính lại 1 lần', async () => {
    let rebalanced = false;
    const ranks: Record<string, [string, string]> = { a: ['n', 'i'], b: ['n0', 'r'] }; // [trước, sau rebalance]
    const issueUpdate = vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
      where.id === 'i1' && 'statusId' in data ? issueRow({ rank: data.rank }) : {});
    const tx = {
      issue: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
          if (where.id === 'i1') return issueRow();
          const r = ranks[where.id];
          return r ? { rank: rebalanced ? r[1] : r[0] } : null;
        }),
        findMany: vi.fn(async () => [{ id: 'a' }, { id: 'i1' }, { id: 'b' }]),
        update: issueUpdate,
      },
      project: { update: vi.fn(async () => { rebalanced = true; return { id: 'p1' }; }) },
    };
    const { service, events } = makeService(tx);

    const dto = await service.move('w1', 'u1', 'i1', { version: 3, afterId: 'a', beforeId: 'b' } as never);

    expect(tx.project.update).toHaveBeenCalledTimes(1);
    expect(dto.rank > 'i' && dto.rank < 'r').toBe(true);
    // 3 lần update rebalance + 1 lần update issue được kéo
    expect(issueUpdate).toHaveBeenCalledTimes(4);
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('mốc không còn tồn tại => 404 thay vì lặng lẽ xếp xuống cuối', async () => {
    const tx = {
      issue: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === 'i1' ? issueRow() : null)) },
    };
    const { service } = makeService(tx);
    await expect(service.move('w1', 'u1', 'i1', { version: 3, afterId: 'gone' } as never)).rejects.toMatchObject({ status: 404 });
  });
});
