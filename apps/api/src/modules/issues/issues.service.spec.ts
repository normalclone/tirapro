import { describe, expect, it, vi } from 'vitest';
import { IssuesService } from './issues.service';

/** expect.stringContaining có kiểu any — bọc lại để không phát sinh cảnh báo lint. */
const has = (text: string): unknown => expect.stringContaining(text);

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
    project: { archivedAt: null },
    ...over,
  };
}

function makeService(tx: Record<string, unknown>, prismaExtra: Record<string, unknown> = {}) {
  const prisma = { $transaction: (fn: (t: unknown) => unknown) => fn(tx), ...tx, ...prismaExtra };
  const events = { emit: vi.fn() };
  const rbac = { getEffectivePermissions: vi.fn() };
  const service = new IssuesService(prisma as never, events as never, rbac as never);
  return { service, events, prisma, rbac };
}

describe('IssuesService.move — rebalance khi hết chỗ chèn', () => {
  it('rank hai mốc sát nhau => đánh số lại project rồi tính lại 1 lần', async () => {
    let rebalanced = false;
    const ranks: Record<string, [string, string]> = { a: ['n', 'i'], b: ['n0', 'r'] }; // [trước, sau rebalance]
    const executeRaw = vi.fn(() => Promise.resolve(3));
    let movedRank: unknown;
    const updateMany = vi.fn(async ({ data }: { data: Record<string, unknown> }) => { await Promise.resolve();
      movedRank = data.rank;
      return { count: 1 };
    });
    const tx = {
      issue: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => { await Promise.resolve();
          if (where.id === 'i1') return issueRow();
          const r = ranks[where.id];
          return r ? { rank: rebalanced ? r[1] : r[0] } : null;
        }),
        findMany: vi.fn(() => Promise.resolve([{ id: 'a' }, { id: 'i1' }, { id: 'b' }])),
        updateMany,
        findFirstOrThrow: vi.fn(() => Promise.resolve(issueRow({ rank: movedRank, version: 4 }))),
      },
      project: { update: vi.fn(async () => { await Promise.resolve(); rebalanced = true; return { id: 'p1' }; }) },
      $executeRaw: executeRaw,
    };
    const { service, events } = makeService(tx);

    const dto = await service.move('w1', 'u1', 'i1', { version: 3, afterId: 'a', beforeId: 'b' });

    expect(tx.project.update).toHaveBeenCalledTimes(1);
    expect(dto.rank > 'i' && dto.rank < 'r').toBe(true);
    // Rebalance = ĐÚNG MỘT câu raw cho cả project, hai mảng (id, rank) cùng độ dài
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [, movedId, ids, newRanks] = executeRaw.mock.calls[0] as unknown as [unknown, string, string[], string[]];
    expect(movedId).toBe('i1'); // issue đang kéo không bị tăng version bởi rebalance
    expect(ids).toEqual(['a', 'i1', 'b']);
    expect(newRanks).toHaveLength(ids.length);
    expect(new Set(newRanks).size).toBe(newRanks.length);
    // issue được kéo ghi qua updateMany có điều kiện version
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith('project.ranks_rebalanced', { projectId: 'p1' });
    expect(events.emit).toHaveBeenCalledTimes(2); // rebalance + ISSUE_MOVED
  });

  it('rebalance bump version cả project nhưng KHÔNG bump issue đang kéo => move vẫn thành công với version client', async () => {
    // Mô phỏng DB thật: updateMany chỉ khớp khi where.version === version hiện tại; raw UPDATE bump version trừ movedId.
    const versions: Record<string, number> = { a: 1, i1: 3, b: 1 };
    const ranks: Record<string, [string, string]> = { a: ['n', 'i'], b: ['n0', 'r'] };
    let rebalanced = false;
    let movedRank: unknown;
    const tx = {
      issue: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => { await Promise.resolve();
          if (where.id === 'i1') return issueRow({ version: versions.i1 });
          const r = ranks[where.id];
          return r ? { rank: rebalanced ? r[1] : r[0] } : null;
        }),
        findMany: vi.fn(() => Promise.resolve([{ id: 'a' }, { id: 'i1' }, { id: 'b' }])),
        updateMany: vi.fn(async ({ where, data }: { where: { id: string; version: number }; data: Record<string, unknown> }) => { await Promise.resolve();
          if (where.version !== versions[where.id]) return { count: 0 };
          versions[where.id]!++;
          movedRank = data.rank;
          return { count: 1 };
        }),
        findFirstOrThrow: vi.fn(() => Promise.resolve(issueRow({ rank: movedRank, version: versions.i1 }))),
      },
      project: { update: vi.fn(() => Promise.resolve({ id: 'p1' })) },
      $executeRaw: vi.fn(async (_s: unknown, moved: string, ids: string[]) => { await Promise.resolve();
        rebalanced = true;
        for (const id of ids) if (id !== moved) versions[id]!++;
        return ids.length;
      }),
    };
    const { service } = makeService(tx);
    const dto = await service.move('w1', 'u1', 'i1', { version: 3, afterId: 'a', beforeId: 'b' });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(versions).toEqual({ a: 2, i1: 4, b: 2 });
    expect(dto.version).toBe(4);
  });

  it('mốc không còn tồn tại => 404 thay vì lặng lẽ xếp xuống cuối', async () => {
    const tx = {
      issue: { findFirst: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(where.id === 'i1' ? issueRow() : null)) },
    };
    const { service } = makeService(tx);
    await expect(service.move('w1', 'u1', 'i1', { version: 3, afterId: 'gone' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('IssuesService — OCC atomic', () => {
  /** tx giả: updateMany trả count theo `count`; findFirst có select = đọc lại version sau khi thua. */
  function occTx(count: number, curVersion: number | null) {
    return {
      issue: {
        findFirst: vi.fn(async ({ select }: { select?: unknown }) => { await Promise.resolve();
          if (select) return curVersion === null ? null : { version: curVersion };
          return issueRow();
        }),
        findFirstOrThrow: vi.fn(() => Promise.resolve(issueRow({ version: 4, summary: 'mới' }))),
        updateMany: vi.fn((_args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise.resolve({ count })),
      },
      issueHistory: { createMany: vi.fn(), create: vi.fn() },
    };
  }

  it('update(): updateMany count=0 => VersionConflictException mang version hiện tại, không ghi history, không emit', async () => {
    const tx = occTx(0, 7);
    const { service, events } = makeService(tx);
    await expect(service.update('w1', 'u1', 'i1', { version: 3, assigneeId: 'u2' })).rejects.toMatchObject({
      status: 409,
      current: { version: 7 },
    });
    expect(tx.issueHistory.createMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('update(): ghi có điều kiện đúng version client gửi và tăng version', async () => {
    const tx = occTx(1, null);
    const { service, events } = makeService(tx);
    const dto = await service.update('w1', 'u1', 'i1', { version: 3, summary: 'mới', assigneeId: 'u2' });
    const call = tx.issue.updateMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({ id: 'i1', workspaceId: 'w1', deletedAt: null, version: 3 });
    expect(call.data).toMatchObject({ summary: 'mới', assigneeId: 'u2', version: { increment: 1 } });
    expect(dto.version).toBe(4);
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('update(): issue bị xoá giữa chừng => 404 thay vì 409', async () => {
    const tx = occTx(0, null);
    const { service } = makeService(tx);
    await expect(service.update('w1', 'u1', 'i1', { version: 3, summary: 'x' })).rejects.toMatchObject({ status: 404 });
  });

  it('move(): thua OCC => 409 và không emit ISSUE_MOVED', async () => {
    const tx = occTx(0, 5);
    const { service, events } = makeService(tx);
    await expect(service.move('w1', 'u1', 'i1', { version: 3 })).rejects.toMatchObject({ status: 409 });
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('transition(): thua OCC => 409, không ghi history', async () => {
    const tx = {
      ...occTx(0, 5),
      project: { findUnique: vi.fn(() => Promise.resolve({ defaultWorkflowId: 'wf' })) },
      workflowTransition: { findFirst: vi.fn(() => Promise.resolve({ id: 'x' })) },
      status: { findUnique: vi.fn(() => Promise.resolve({ category: 'DONE' })) },
    };
    const { service, events } = makeService(tx);
    await expect(service.transition('w1', 'u1', 'i1', { version: 3, toStatusId: 's2' })).rejects.toMatchObject({ status: 409 });
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

describe('IssuesService.bulkUpdate', () => {
  /** Hai issue a, b (version 3). `lose` = id bị thua OCC lúc ghi (version hiện tại trong DB = 5). */
  function bulkTx(opts: { rows?: Array<Record<string, unknown>>; lose?: string; allowTransition?: boolean } = {}) {
    const rows = opts.rows ?? [issueRow({ id: 'a' }), issueRow({ id: 'b' })];
    const tx = {
      issue: {
        findMany: vi.fn((_args: { where: Record<string, unknown> }) => Promise.resolve(rows)),
        updateMany: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve({ count: where.id === opts.lose ? 0 : 1 })),
        findFirst: vi.fn(() => Promise.resolve({ version: 5 })),
        findFirstOrThrow: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(issueRow({ id: where.id, version: 4, assigneeId: 'u2' }))),
      },
      issueHistory: { createMany: vi.fn(), create: vi.fn() },
      project: { findUnique: vi.fn(() => Promise.resolve({ defaultWorkflowId: 'wf' })) },
      workflowTransition: { findFirst: vi.fn(() => Promise.resolve(opts.allowTransition === false ? null : { id: 'tr' })) },
      status: { findUnique: vi.fn(() => Promise.resolve({ category: 'IN_PROGRESS' })) },
    };
    return tx;
  }
  const items = [{ id: 'a', version: 3 }, { id: 'b', version: 3 }];

  it('2 item, 1 thua OCC lúc ghi => updated 1, conflicts 1 (kèm version hiện tại), chỉ emit cho item đã ghi', async () => {
    const tx = bulkTx({ lose: 'b' });
    const { service, events } = makeService(tx);
    const res = await service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { assigneeId: 'u2' } });
    expect(res.updated).toHaveLength(1);
    expect(res.updated[0]).toMatchObject({ id: 'a', version: 4 });
    expect(res.conflicts).toEqual([{ id: 'b', version: 5 }]);
    expect(tx.issueHistory.createMany).toHaveBeenCalledTimes(1); // chỉ item a
    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith('issue.updated', expect.objectContaining({ actorId: 'u1' }));
  });

  it('version đã lệch từ lúc đọc => conflict ngay, không gọi updateMany cho item đó', async () => {
    const tx = bulkTx({ rows: [issueRow({ id: 'a' }), issueRow({ id: 'b', version: 9 })] });
    const { service } = makeService(tx);
    const res = await service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { assigneeId: 'u2' } });
    expect(res.conflicts).toEqual([{ id: 'b', version: 9 }]);
    expect(res.updated.map((i) => i.id)).toEqual(['a']);
    expect(tx.issue.updateMany).toHaveBeenCalledTimes(1);
  });

  it('item không thuộc dự án/workspace => 404 cho cả yêu cầu, chưa mở transaction', async () => {
    const tx = bulkTx({ rows: [issueRow({ id: 'a' })] });
    const txSpy = vi.fn();
    const { service } = makeService(tx, { $transaction: txSpy });
    await expect(service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { assigneeId: 'u2' } })).rejects.toMatchObject({ status: 404 });
    expect(txSpy).not.toHaveBeenCalled();
    expect(tx.issue.findMany.mock.calls[0]?.[0]).toMatchObject({ where: { workspaceId: 'w1', projectId: 'p1', deletedAt: null } });
  });

  it('chỉ có issue:edit, patch có statusId => 403, không đọc/ghi issue, không mở transaction', async () => {
    const tx = bulkTx();
    const txSpy = vi.fn();
    const { service, rbac } = makeService(tx, { $transaction: txSpy, user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: false })) } });
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:edit']));
    await expect(
      service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { statusId: 's2' } }),
    ).rejects.toMatchObject({ status: 403 });
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('u1', 'w1', 'p1');
    expect(tx.issue.findMany).not.toHaveBeenCalled();
    expect(txSpy).not.toHaveBeenCalled();
  });

  it('có issue:transition:own hoặc là system admin => được đổi trạng thái', async () => {
    for (const [perms, admin] of [[['issue:transition:own'], false], [['issue:edit'], true]] as const) {
      const tx = bulkTx();
      const { service, rbac } = makeService(tx, { user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: admin })) } });
      rbac.getEffectivePermissions.mockResolvedValue(new Set(perms));
      const res = await service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { statusId: 's2' } });
      expect(res.updated).toHaveLength(2);
    }
  });

  it('patch không có statusId => không cần kiểm quyền chuyển trạng thái', async () => {
    const tx = bulkTx();
    const { service, rbac } = makeService(tx);
    await service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { assigneeId: 'u2' } });
    expect(rbac.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('statusId sai workflow => 409 INVALID_TRANSITION, không ghi gì', async () => {
    const tx = bulkTx({ allowTransition: false });
    const { service, events, rbac } = makeService(tx);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:transition']));
    await expect(
      service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { statusId: 's2' } }),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('statusId hợp lệ => ghi history STATUS và emit ISSUE_TRANSITIONED cho từng item', async () => {
    const tx = bulkTx();
    tx.issue.findFirstOrThrow = vi.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(issueRow({ id: where.id, version: 4, statusId: 's2', status: { id: 's2', workflowId: 'wf', name: 'Doing', category: 'IN_PROGRESS', color: null, order: 1, isInitial: false } })));
    const { service, events, rbac } = makeService(tx);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:transition']));
    const res = await service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { statusId: 's2' } });
    expect(res.updated).toHaveLength(2);
    expect(tx.issueHistory.create).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledWith('issue.transitioned', expect.objectContaining({ fromStatusId: 's1' }));
  });

  it('patch không đổi gì so với hiện tại => không ghi, không tăng version, không emit', async () => {
    const tx = bulkTx();
    const { service, events } = makeService(tx);
    const res = await service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { assigneeId: null } });
    expect(res.updated.map((i) => i.version)).toEqual([3, 3]);
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });
});

describe('IssuesService.query — rawIds (full-text)', () => {
  function setup(rows: ReturnType<typeof issueRow>[]) {
    const findMany = vi.fn(() => Promise.resolve(rows));
    const { service } = makeService({ issue: { findMany } });
    return { service, findMany };
  }

  it('giữ thứ tự rank của rawIds và phân trang theo con trỏ', async () => {
    const rows = ['c', 'a', 'b'].map((id) => issueRow({ id }));
    const { service } = setup(rows);
    const first = await service.query('w1', {}, [], undefined, 2, ['a', 'b', 'c']);
    expect(first.data.map((i) => i.id)).toEqual(['a', 'b']);
    expect(first.pageInfo).toMatchObject({ hasNextPage: true });
    const second = await service.query('w1', {}, [], 'b', 2, ['a', 'b', 'c']);
    expect(second.data.map((i) => i.id)).toEqual(['c']);
    expect(second.pageInfo).toMatchObject({ hasNextPage: false });
  });

  it('rawIds rỗng -> trang rỗng, không truy vấn DB', async () => {
    const { service, findMany } = setup([]);
    const res = await service.query('w1', {}, [], undefined, 10, []);
    expect(res.data).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('có orderBy tường minh -> lọc theo id nhưng để DB sắp xếp', async () => {
    const { service, findMany } = setup([issueRow({ id: 'a' })]);
    await service.query('w1', {}, [{ createdAt: 'asc' }], undefined, 10, ['a', 'b']);
    const args = (findMany.mock.calls[0] as unknown as [{ where: unknown; orderBy: unknown }])[0];
    expect(JSON.stringify(args.where)).toContain('"in":["a","b"]');
    expect(args.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });
});

describe('IssuesService — giới hạn WIP của cột board', () => {
  /** Cột "Doing" (statusIds s2, s4) có giới hạn `limit`, đang có `count` việc; issue đang ở s1 (ngoài cột). */
  function wipTx(opts: { limit?: number | null; count?: number; boardType?: 'SCRUM' | 'KANBAN'; activeSprint?: boolean; issue?: Record<string, unknown>; column?: boolean } = {}) {
    const limit = opts.limit === undefined ? 2 : opts.limit;
    const issue = issueRow(opts.issue ?? {});
    return {
      boardColumn: {
        findFirst: vi.fn(() =>
          Promise.resolve(opts.column === false ? null : {
            id: 'c2', name: 'Doing', wipLimit: limit, board: { type: opts.boardType ?? 'KANBAN' },
            statuses: [{ statusId: 's2' }, { statusId: 's4' }],
          })),
      },
      sprint: { findFirst: vi.fn(() => Promise.resolve(opts.activeSprint === false ? null : { id: 'sp1' })) },
      $queryRaw: vi.fn(() => Promise.resolve([])),
      issue: {
        findFirst: vi.fn(() => Promise.resolve(issue)),
        findMany: vi.fn(() => Promise.resolve([issue])),
        count: vi.fn((_args: { where: Record<string, unknown> }) => Promise.resolve(opts.count ?? 2)),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
        findFirstOrThrow: vi.fn(() => Promise.resolve(issueRow({ version: 4, statusId: 's2' }))),
      },
      issueHistory: { createMany: vi.fn(), create: vi.fn() },
      project: { findUnique: vi.fn(() => Promise.resolve({ defaultWorkflowId: 'wf', archivedAt: null })) },
      workflowTransition: { findFirst: vi.fn(() => Promise.resolve({ id: 'tr' })) },
      status: { findUnique: vi.fn(() => Promise.resolve({ category: 'IN_PROGRESS' })) },
    };
  }
  const input = { version: 3, toStatusId: 's2', boardId: 'b1' };

  it('transition vào cột đã đầy, không force => WIP_LIMIT_REACHED (422), không ghi, không emit', async () => {
    const tx = wipTx({ count: 2 });
    const { service, events } = makeService(tx);
    await expect(service.transition('w1', 'u1', 'i1', input)).rejects.toMatchObject({
      status: 422,
      response: { code: 'WIP_LIMIT_REACHED', message: 'Cột "Doing" đã đạt giới hạn 2 việc đang làm — hãy hoàn thành bớt hoặc chọn "Vẫn chuyển"' },
    });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('kiểm WIP chạy TRONG transaction, sau khi khoá dòng cột (FOR UPDATE) để hai request đồng thời không cùng lọt', async () => {
    const order: string[] = [];
    const tx = wipTx({ count: 1 });
    tx.$queryRaw = vi.fn(() => { order.push('lock'); return Promise.resolve([]); });
    tx.issue.count = vi.fn(() => { order.push('count'); return Promise.resolve(1); });
    tx.issue.updateMany = vi.fn(() => { order.push('write'); return Promise.resolve({ count: 1 }); });
    const { service } = makeService(tx);
    await service.transition('w1', 'u1', 'i1', input);
    expect(order).toEqual(['lock', 'count', 'write']);
  });

  it('còn chỗ (count < giới hạn) => chuyển bình thường, đếm đúng project + trạng thái của cột + chưa xoá', async () => {
    const tx = wipTx({ count: 1 });
    const { service, events } = makeService(tx);
    await service.transition('w1', 'u1', 'i1', input);
    expect(tx.issue.count.mock.calls[0]![0].where).toMatchObject({ projectId: 'p1', deletedAt: null, statusId: { in: ['s2', 's4'] } });
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('board SCRUM chỉ đếm việc của sprint đang ACTIVE; không có sprint ACTIVE => không chặn', async () => {
    const tx = wipTx({ count: 2, boardType: 'SCRUM' });
    const { service } = makeService(tx);
    await expect(service.transition('w1', 'u1', 'i1', input)).rejects.toMatchObject({ response: { code: 'WIP_LIMIT_REACHED' } });
    expect(tx.issue.count.mock.calls[0]![0].where).toMatchObject({ sprintId: 'sp1' });

    const none = wipTx({ count: 99, boardType: 'SCRUM', activeSprint: false });
    await makeService(none).service.transition('w1', 'u1', 'i1', input);
    expect(none.issue.count).not.toHaveBeenCalled();
  });

  it('force + có project:admin => qua dù cột đầy', async () => {
    const tx = wipTx({ count: 5 });
    const { service, rbac, events } = makeService(tx);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['project:admin']));
    await service.transition('w1', 'u1', 'i1', { ...input, force: true });
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('u1', 'w1', 'p1');
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('force nhưng không phải quản trị dự án => 403, không ghi', async () => {
    const tx = wipTx({ count: 5 });
    const { service, rbac } = makeService(tx, { user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: false })) } });
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:transition']));
    await expect(service.transition('w1', 'u1', 'i1', { ...input, force: true })).rejects.toMatchObject({ status: 403 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('không gửi boardId / cột không có wipLimit / cột không chứa trạng thái đích => không đếm', async () => {
    for (const [tx, inp] of [
      [wipTx({ count: 9 }), { version: 3, toStatusId: 's2' }],
      [wipTx({ count: 9, limit: null }), input],
      [wipTx({ count: 9, column: false }), input],
    ] as const) {
      await makeService(tx).service.transition('w1', 'u1', 'i1', inp);
      expect(tx.issue.count).not.toHaveBeenCalled();
    }
  });

  it('issue đã nằm trong cột đích (đổi giữa hai trạng thái cùng cột) => không tính là vào thêm', async () => {
    const tx = wipTx({ count: 2, issue: { statusId: 's4' } });
    const { service } = makeService(tx);
    await service.transition('w1', 'u1', 'i1', input);
    expect(tx.issue.count).not.toHaveBeenCalled();
  });

  it('move sang trạng thái của cột đã đầy => WIP_LIMIT_REACHED; move trong cùng cột (không đổi trạng thái) thì không kiểm', async () => {
    const tx = wipTx({ count: 2 });
    const { service } = makeService(tx);
    await expect(service.move('w1', 'u1', 'i1', { version: 3, statusId: 's2', boardId: 'b1' })).rejects.toMatchObject({
      response: { code: 'WIP_LIMIT_REACHED' },
    });
    const same = wipTx({ count: 2 });
    await makeService(same).service.move('w1', 'u1', 'i1', { version: 3, boardId: 'b1' });
    expect(same.issue.count).not.toHaveBeenCalled();
  });

  it('bulkUpdate: chuyển nhiều việc vào cột chỉ còn 1 chỗ => chặn cả lô, nêu số chỗ còn lại', async () => {
    const tx = wipTx({ count: 1 });
    tx.issue.findMany = vi.fn(() => Promise.resolve([issueRow({ id: 'a' }), issueRow({ id: 'b' })]));
    const { service, rbac } = makeService(tx);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:transition']));
    await expect(
      service.bulkUpdate('w1', 'u1', {
        projectId: 'p1', boardId: 'b1', patch: { statusId: 's2' },
        items: [{ id: 'a', version: 3 }, { id: 'b', version: 3 }],
      }),
    ).rejects.toMatchObject({ status: 422, response: { code: 'WIP_LIMIT_REACHED', message: has('chỉ còn chỗ cho 1') } });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('dự án đã lưu trữ => transition/move bị chặn trước khi đụng DB ghi', async () => {
    const tx = wipTx({ issue: { project: { archivedAt: new Date() } } });
    const { service } = makeService(tx);
    await expect(service.transition('w1', 'u1', 'i1', input)).rejects.toMatchObject({ status: 422, message: has('lưu trữ') });
    await expect(service.move('w1', 'u1', 'i1', { version: 3 })).rejects.toMatchObject({ status: 422 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });
});
