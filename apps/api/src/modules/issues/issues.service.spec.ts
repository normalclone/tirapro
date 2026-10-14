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
    const issueUpdate = vi.fn(async () => ({}));
    let movedRank: unknown;
    const updateMany = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      movedRank = data.rank;
      return { count: 1 };
    });
    const tx = {
      issue: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
          if (where.id === 'i1') return issueRow();
          const r = ranks[where.id];
          return r ? { rank: rebalanced ? r[1] : r[0] } : null;
        }),
        findMany: vi.fn(async () => [{ id: 'a' }, { id: 'i1' }, { id: 'b' }]),
        update: issueUpdate,
        updateMany,
        findFirstOrThrow: vi.fn(async () => issueRow({ rank: movedRank, version: 4 })),
      },
      project: { update: vi.fn(async () => { rebalanced = true; return { id: 'p1' }; }) },
    };
    const { service, events } = makeService(tx);

    const dto = await service.move('w1', 'u1', 'i1', { version: 3, afterId: 'a', beforeId: 'b' } as never);

    expect(tx.project.update).toHaveBeenCalledTimes(1);
    expect(dto.rank > 'i' && dto.rank < 'r').toBe(true);
    // 3 lần update rebalance; issue được kéo ghi qua updateMany có điều kiện version
    expect(issueUpdate).toHaveBeenCalledTimes(3);
    expect(updateMany).toHaveBeenCalledTimes(1);
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

describe('IssuesService — OCC atomic', () => {
  /** tx giả: updateMany trả count theo `count`; findFirst có select = đọc lại version sau khi thua. */
  function occTx(count: number, curVersion: number | null) {
    return {
      issue: {
        findFirst: vi.fn(async ({ select }: { select?: unknown }) => {
          if (select) return curVersion === null ? null : { version: curVersion };
          return issueRow();
        }),
        findFirstOrThrow: vi.fn(async () => issueRow({ version: 4, summary: 'mới' })),
        updateMany: vi.fn(async () => ({ count })),
      },
      issueHistory: { createMany: vi.fn(), create: vi.fn() },
    };
  }

  it('update(): updateMany count=0 => VersionConflictException mang version hiện tại, không ghi history, không emit', async () => {
    const tx = occTx(0, 7);
    const { service, events } = makeService(tx);
    await expect(service.update('w1', 'u1', 'i1', { version: 3, assigneeId: 'u2' } as never)).rejects.toMatchObject({
      status: 409,
      current: { version: 7 },
    });
    expect(tx.issueHistory.createMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('update(): ghi có điều kiện đúng version client gửi và tăng version', async () => {
    const tx = occTx(1, null);
    const { service, events } = makeService(tx);
    const dto = await service.update('w1', 'u1', 'i1', { version: 3, summary: 'mới', assigneeId: 'u2' } as never);
    const call = tx.issue.updateMany.mock.calls[0]![0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(call.where).toMatchObject({ id: 'i1', workspaceId: 'w1', deletedAt: null, version: 3 });
    expect(call.data).toMatchObject({ summary: 'mới', assigneeId: 'u2', version: { increment: 1 } });
    expect(dto.version).toBe(4);
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('update(): issue bị xoá giữa chừng => 404 thay vì 409', async () => {
    const tx = occTx(0, null);
    const { service } = makeService(tx);
    await expect(service.update('w1', 'u1', 'i1', { version: 3, summary: 'x' } as never)).rejects.toMatchObject({ status: 404 });
  });

  it('move(): thua OCC => 409 và không emit ISSUE_MOVED', async () => {
    const tx = occTx(0, 5);
    const { service, events } = makeService(tx);
    await expect(service.move('w1', 'u1', 'i1', { version: 3 } as never)).rejects.toMatchObject({ status: 409 });
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('transition(): thua OCC => 409, không ghi history', async () => {
    const tx = {
      ...occTx(0, 5),
      project: { findUnique: vi.fn(async () => ({ defaultWorkflowId: 'wf' })) },
      workflowTransition: { findFirst: vi.fn(async () => ({ id: 'x' })) },
      status: { findUnique: vi.fn(async () => ({ category: 'DONE' })) },
    };
    const { service, events } = makeService(tx);
    await expect(service.transition('w1', 'u1', 'i1', { version: 3, toStatusId: 's2' } as never)).rejects.toMatchObject({ status: 409 });
    expect(tx.issueHistory.create).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('softDelete(): tăng version, và xoá hai lần đồng thời chỉ một lần thắng', async () => {
    const tx = occTx(1, null);
    const { service, events } = makeService(tx);
    await service.softDelete('w1', 'u1', 'i1');
    expect(tx.issue.updateMany.mock.calls[0]![0]).toMatchObject({ data: { version: { increment: 1 } } });
    expect(events.emit).toHaveBeenCalledTimes(1);

    const lost = occTx(0, null);
    const b = makeService(lost);
    await expect(b.service.softDelete('w1', 'u1', 'i1')).rejects.toMatchObject({ status: 404 });
    expect(b.events.emit).not.toHaveBeenCalled();
  });
});
