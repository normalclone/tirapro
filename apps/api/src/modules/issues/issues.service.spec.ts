import { describe, expect, it, vi } from 'vitest';
import { DOMAIN_EVENTS } from '@tirapro/types';
import { Prisma } from '@prisma/client';
import { ProjectAccessService } from '../rbac/project-access.service';
import { IssuesService } from './issues.service';

/** expect.stringContaining có kiểu any — bọc lại để không phát sinh cảnh báo lint. */
const has = (text: string): unknown => expect.stringContaining(text);

const now = new Date('2026-10-15T00:00:00Z');

/** Dòng issue đủ trường để toDto() không văng lỗi. */
function issueRow(over: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    key: 'P-TASK-1',
    summary: 's',
    workspaceId: 'w1',
    projectId: 'p1',
    number: 1,
    description: null,
    descriptionFormat: 'MARKDOWN',
    acceptanceCriteria: null,
    type: {
      id: 't1',
      name: 'Task',
      key: 'task',
      iconUrl: null,
      color: null,
      hierarchyLevel: 0,
      isSubtask: false,
    },
    typeId: 't1',
    status: {
      id: 's1',
      workflowId: 'wf',
      name: 'Todo',
      category: 'TODO',
      color: null,
      order: 0,
      isInitial: true,
    },
    statusId: 's1',
    priority: null,
    priorityId: null,
    severity: null,
    resolution: null,
    resolutionId: null,
    assignee: null,
    assigneeId: null,
    reporter: null,
    reporterId: 'u1',
    createdById: 'u1',
    parentId: null,
    epicId: null,
    sprintId: null,
    storyPoints: null,
    originalEstimate: null,
    remainingEstimate: null,
    timeSpent: null,
    dueDate: null,
    startDate: null,
    resolvedAt: null,
    triageState: null,
    triageSnoozeUntil: null,
    occurrenceCount: 0,
    rank: 'n',
    version: 3,
    labels: [],
    components: [{ component: { id: 'c1', name: 'Backend' } }],
    fixVersions: [{ type: 'FIX', version: { id: 'v1', name: 'v1.0' } }],
    createdAt: now,
    updatedAt: now,
    project: { archivedAt: null },
    ...over,
  };
}

function makeService(
  tx: Record<string, unknown>,
  prismaExtra: Record<string, unknown> = {},
  comments?: { create: ReturnType<typeof vi.fn> },
  perms: string[] = ['issue:edit', 'backlog:manage', 'issue:transition', 'comment:create'],
) {
  // Mặc định mọi assignee đều là thành viên workspace; ca "người ngoài" ghi đè workspaceMembership qua prismaExtra.
  const base = {
    workspaceMembership: { findFirst: vi.fn(() => Promise.resolve({ userId: 'u2' })) },
  };
  const prisma = {
    $transaction: (fn: (t: unknown) => unknown) => fn(tx),
    ...base,
    ...tx,
    ...prismaExtra,
  };
  const events = { emit: vi.fn() };
  // Mặc định đủ quyền sửa/xếp backlog/chuyển trạng thái; ca thiếu quyền ghi đè bằng mockResolvedValue.
  const rbac = {
    getEffectivePermissions: vi.fn(() => Promise.resolve(new Set(perms))),
  };
  // Người được giao thấy dự án (mặc định); ca dự án riêng tư đặt lại `access.canSee`.
  const access = new ProjectAccessService(prisma as never, rbac as never);
  const canSee = vi.spyOn(access, 'canSee').mockResolvedValue(true);
  const service = new IssuesService(
    prisma as never,
    events as never,
    rbac as never,
    undefined,
    undefined,
    comments as never,
    access,
  );
  return { service, events, prisma, rbac, canSee };
}

describe('IssuesService.toDto — components/fixVersions (B17)', () => {
  it('toDto trả components/fixVersions đã gắn (sắp theo tên)', async () => {
    const row = issueRow({
      components: [
        { component: { id: 'c2', name: 'Web' } },
        { component: { id: 'c1', name: 'API' } },
      ],
      fixVersions: [
        { type: 'AFFECTS', version: { id: 'v2', name: 'v2.0' } },
        { type: 'FIX', version: { id: 'v1', name: 'v1.0' } },
      ],
    });
    const { service } = makeService({ issue: { findFirst: vi.fn(() => Promise.resolve(row)) } });
    const dto = await service.getByKey('w1', 'P-TASK-1', null);
    expect(dto.components).toEqual([
      { id: 'c1', name: 'API' },
      { id: 'c2', name: 'Web' },
    ]);
    expect(dto.fixVersions).toEqual([
      { id: 'v1', name: 'v1.0', type: 'FIX' },
      { id: 'v2', name: 'v2.0', type: 'AFFECTS' },
    ]);
  });
});

describe('IssuesService.move — rebalance khi hết chỗ chèn', () => {
  it('rank hai mốc sát nhau => đánh số lại project rồi tính lại 1 lần', async () => {
    let rebalanced = false;
    const ranks: Record<string, [string, string]> = { a: ['n', 'i'], b: ['n0', 'r'] }; // [trước, sau rebalance]
    const executeRaw = vi.fn(() => Promise.resolve(3));
    let movedRank: unknown;
    const updateMany = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      await Promise.resolve();
      movedRank = data.rank;
      return { count: 1 };
    });
    const tx = {
      issue: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
          await Promise.resolve();
          if (where.id === 'i1') return issueRow();
          const r = ranks[where.id];
          return r ? { rank: rebalanced ? r[1] : r[0] } : null;
        }),
        findMany: vi.fn(() => Promise.resolve([{ id: 'a' }, { id: 'i1' }, { id: 'b' }])),
        updateMany,
        findFirstOrThrow: vi.fn(() => Promise.resolve(issueRow({ rank: movedRank, version: 4 }))),
      },
      project: {
        update: vi.fn(async () => {
          await Promise.resolve();
          rebalanced = true;
          return { id: 'p1' };
        }),
      },
      $executeRaw: executeRaw,
    };
    const { service, events } = makeService(tx);

    const dto = await service.move('w1', 'u1', 'i1', { version: 3, afterId: 'a', beforeId: 'b' });

    expect(tx.project.update).toHaveBeenCalledTimes(1);
    expect(dto.rank > 'i' && dto.rank < 'r').toBe(true);
    // Rebalance = ĐÚNG MỘT câu raw cho cả project, hai mảng (id, rank) cùng độ dài
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [, movedId, ids, newRanks] = executeRaw.mock.calls[0] as unknown as [
      unknown,
      string,
      string[],
      string[],
    ];
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
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
          await Promise.resolve();
          if (where.id === 'i1') return issueRow({ version: versions.i1 });
          const r = ranks[where.id];
          return r ? { rank: rebalanced ? r[1] : r[0] } : null;
        }),
        findMany: vi.fn(() => Promise.resolve([{ id: 'a' }, { id: 'i1' }, { id: 'b' }])),
        updateMany: vi.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string; version: number };
            data: Record<string, unknown>;
          }) => {
            await Promise.resolve();
            if (where.version !== versions[where.id]) return { count: 0 };
            versions[where.id]!++;
            movedRank = data.rank;
            return { count: 1 };
          },
        ),
        findFirstOrThrow: vi.fn(() =>
          Promise.resolve(issueRow({ rank: movedRank, version: versions.i1 })),
        ),
      },
      project: { update: vi.fn(() => Promise.resolve({ id: 'p1' })) },
      $executeRaw: vi.fn(async (_s: unknown, moved: string, ids: string[]) => {
        await Promise.resolve();
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
      issue: {
        findFirst: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === 'i1' ? issueRow() : null),
        ),
      },
    };
    const { service } = makeService(tx);
    await expect(
      service.move('w1', 'u1', 'i1', { version: 3, afterId: 'gone' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('IssuesService — OCC atomic', () => {
  /** tx giả: updateMany trả count theo `count`; findFirst có select = đọc lại version sau khi thua. */
  function occTx(count: number, curVersion: number | null) {
    return {
      issue: {
        findFirst: vi.fn(async ({ select }: { select?: unknown }) => {
          await Promise.resolve();
          if (select) return curVersion === null ? null : { version: curVersion };
          return issueRow();
        }),
        findFirstOrThrow: vi.fn(() => Promise.resolve(issueRow({ version: 4, summary: 'mới' }))),
        updateMany: vi.fn(
          (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
            Promise.resolve({ count }),
        ),
      },
      issueHistory: { createMany: vi.fn(), create: vi.fn() },
    };
  }

  it('update(): updateMany count=0 => VersionConflictException mang version hiện tại, không ghi history, không emit', async () => {
    const tx = occTx(0, 7);
    const { service, events } = makeService(tx);
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, assigneeId: 'u2' }),
    ).rejects.toMatchObject({
      status: 409,
      current: { version: 7 },
    });
    expect(tx.issueHistory.createMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('update(): ghi có điều kiện đúng version client gửi và tăng version', async () => {
    const tx = occTx(1, null);
    const { service, events } = makeService(tx);
    const dto = await service.update('w1', 'u1', 'i1', {
      version: 3,
      summary: 'mới',
      assigneeId: 'u2',
    });
    const call = tx.issue.updateMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({ id: 'i1', workspaceId: 'w1', deletedAt: null, version: 3 });
    expect(call.data).toMatchObject({
      summary: 'mới',
      assigneeId: 'u2',
      version: { increment: 1 },
    });
    expect(dto.version).toBe(4);
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('update(): acceptanceCriteria được ghi qua updateMany (OCC) và DTO trả acceptanceProgress', async () => {
    const tx = occTx(1, null);
    tx.issue.findFirstOrThrow.mockResolvedValueOnce(
      issueRow({ version: 4, acceptanceCriteria: '- [x] a\n- [ ] b\n- [ ] c' }),
    );
    const { service } = makeService(tx);
    const dto = await service.update('w1', 'u1', 'i1', {
      version: 3,
      acceptanceCriteria: '- [x] a\n- [ ] b\n- [ ] c',
    });
    expect(tx.issue.updateMany.mock.calls[0]![0].data).toMatchObject({
      acceptanceCriteria: '- [x] a\n- [ ] b\n- [ ] c',
    });
    expect(dto.acceptanceProgress).toEqual({ done: 1, total: 3 });
  });

  it('update(): chuỗi rỗng/khoảng trắng → null; không có mục tick → acceptanceProgress null', async () => {
    const tx = occTx(1, null);
    const { service } = makeService(tx);
    await service.update('w1', 'u1', 'i1', { version: 3, acceptanceCriteria: '   ' });
    expect(tx.issue.updateMany.mock.calls[0]![0].data).toMatchObject({ acceptanceCriteria: null });
  });

  it('toDto: văn bản tiêu chí không có ô tick -> acceptanceProgress null; có ô tick -> đếm đúng', async () => {
    const plain = occTx(1, null);
    plain.issue.findFirstOrThrow.mockResolvedValueOnce(
      issueRow({ version: 4, acceptanceCriteria: 'Chỉ là đoạn văn, không có ô tick' }),
    );
    const dto = await makeService(plain).service.update('w1', 'u1', 'i1', {
      version: 3,
      acceptanceCriteria: 'Chỉ là đoạn văn, không có ô tick',
    });
    expect(dto.acceptanceCriteria).toBe('Chỉ là đoạn văn, không có ô tick');
    expect(dto.acceptanceProgress).toBeNull();
  });

  it('update(): issue bị xoá giữa chừng => 404 thay vì 409', async () => {
    const tx = occTx(0, null);
    const { service } = makeService(tx);
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, summary: 'x' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('move(): thua OCC => 409 và không emit ISSUE_MOVED', async () => {
    const tx = occTx(0, 5);
    const { service, events } = makeService(tx);
    await expect(service.move('w1', 'u1', 'i1', { version: 3 })).rejects.toMatchObject({
      status: 409,
    });
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('transition(): thua OCC => 409, không ghi history', async () => {
    const tx = {
      ...occTx(0, 5),
      project: { findUnique: vi.fn(() => Promise.resolve({ defaultWorkflowId: 'wf' })) },
      workflowTransition: { findFirst: vi.fn(() => Promise.resolve({ id: 'x' })) },
      status: { findUnique: vi.fn(() => Promise.resolve({ category: 'DONE' })) },
      resolution: { findFirst: vi.fn(() => Promise.resolve({ id: 'r-done' })) },
    };
    const { service, events } = makeService(tx);
    await expect(
      service.transition('w1', 'u1', 'i1', { version: 3, toStatusId: 's2' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.issueHistory.create).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('softDelete(): tăng version, và xoá hai lần đồng thời chỉ một lần thắng', async () => {
    const tx = occTx(1, null);
    const { service, events } = makeService(tx);
    await service.softDelete('w1', 'u1', 'i1');
    expect(tx.issue.updateMany.mock.calls[0]![0]).toMatchObject({
      data: { version: { increment: 1 } },
    });
    expect(events.emit).toHaveBeenCalledTimes(1);
    // Gateway chỉ phát `issue:deleted` tới room project khi payload có projectId.
    expect(events.emit).toHaveBeenCalledWith(DOMAIN_EVENTS.ISSUE_DELETED, {
      issueId: 'i1',
      projectId: 'p1',
      actorId: 'u1',
    });

    const lost = occTx(0, null);
    const b = makeService(lost);
    await expect(b.service.softDelete('w1', 'u1', 'i1')).rejects.toMatchObject({ status: 404 });
    expect(b.events.emit).not.toHaveBeenCalled();
  });
});

describe('IssuesService.update — severityId, environment', () => {
  function occTx() {
    return {
      issue: {
        findFirst: vi.fn(() => Promise.resolve(issueRow())),
        findFirstOrThrow: vi.fn(() => Promise.resolve(issueRow({ version: 4 }))),
        updateMany: vi.fn(
          (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
            Promise.resolve({ count: 1 }),
        ),
      },
      issueHistory: { createMany: vi.fn(), create: vi.fn() },
    };
  }

  it('kiểm mức thuộc workspace, ghi severityId, null để bỏ mức', async () => {
    const tx = occTx();
    const severity = { findFirst: vi.fn(() => Promise.resolve({ id: 'sv1' })) };
    const { service } = makeService(tx, { severity });
    await service.update('w1', 'u1', 'i1', { version: 3, severityId: 'sv1' });
    expect(severity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sv1', workspaceId: 'w1' } }),
    );
    expect(tx.issue.updateMany.mock.calls[0]![0].data).toMatchObject({ severityId: 'sv1' });
    await service.update('w1', 'u1', 'i1', { version: 3, severityId: null });
    expect(tx.issue.updateMany.mock.calls[1]![0].data).toMatchObject({ severityId: null });
  });

  it('environment: chuẩn hoá khi ghi, rỗng/null => DbNull', async () => {
    const tx = occTx();
    const { service } = makeService(tx);
    await service.update('w1', 'u1', 'i1', {
      version: 3,
      environment: { env: 'staging', browser: ' Chrome 126 ', os: '' },
    });
    expect(tx.issue.updateMany.mock.calls[0]![0].data).toMatchObject({
      environment: { env: 'staging', browser: 'Chrome 126' },
    });
    await service.update('w1', 'u1', 'i1', { version: 3, environment: null });
    expect(tx.issue.updateMany.mock.calls[1]![0].data.environment).toBe(Prisma.DbNull);
    await service.update('w1', 'u1', 'i1', { version: 3, summary: 'x' });
    expect(tx.issue.updateMany.mock.calls[2]![0].data).not.toHaveProperty('environment');
  });

  it('mức của workspace khác => 404, chưa ghi', async () => {
    const tx = occTx();
    const { service } = makeService(tx, {
      severity: { findFirst: vi.fn(() => Promise.resolve(null)) },
    });
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, severityId: 'x' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });
});

describe('IssuesService.retract — người báo xoá việc của mình trong 10 phút', () => {
  const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000);
  function setup(row: Record<string, unknown>, children = 0, othersComments = 0) {
    const issue = {
      findFirst: vi.fn(() => Promise.resolve(issueRow(row))),
      count: vi.fn(() => Promise.resolve(children)),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
    };
    const comment = { count: vi.fn(() => Promise.resolve(othersComments)) };
    return { ...makeService({ issue }, { comment }), issue, comment };
  }
  it('người báo, 3 phút, không việc con/bình luận người khác => xoá mềm + phát ISSUE_DELETED', async () => {
    const { service, issue, events } = setup({
      reporterId: 'u1',
      createdById: 'u1',
      createdAt: at(3),
    });
    await expect(service.retract('w1', 'u1', 'i1')).resolves.toEqual({ success: true });
    const data = (
      issue.updateMany.mock.calls as unknown as Array<[{ data: { deletedAt: unknown } }]>
    )[0]![0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(events.emit).toHaveBeenCalledWith(
      DOMAIN_EVENTS.ISSUE_DELETED,
      expect.objectContaining({ issueId: 'i1' }),
    );
  });
  it('người tạo (không phải người báo) cũng thu hồi được', async () => {
    const { service } = setup({ reporterId: 'u2', createdById: 'u1', createdAt: at(1) });
    await expect(service.retract('w1', 'u1', 'i1')).resolves.toEqual({ success: true });
  });
  it('quá 10 phút => 422, không ghi', async () => {
    const { service, issue } = setup({ reporterId: 'u1', createdAt: at(11) });
    await expect(service.retract('w1', 'u1', 'i1')).rejects.toMatchObject({ status: 422 });
    expect(issue.updateMany).not.toHaveBeenCalled();
  });
  it('người được giao (không phải người báo/tạo) => 403', async () => {
    const { service } = setup({
      reporterId: 'u2',
      createdById: 'u2',
      assigneeId: 'u1',
      createdAt: at(1),
    });
    await expect(service.retract('w1', 'u1', 'i1')).rejects.toMatchObject({ status: 403 });
  });
  it('đã có việc con hoặc bình luận của người khác => 422', async () => {
    await expect(
      setup({ reporterId: 'u1', createdAt: at(1) }, 1).service.retract('w1', 'u1', 'i1'),
    ).rejects.toMatchObject({ status: 422 });
    const { service, comment, issue } = setup({ reporterId: 'u1', createdAt: at(1) }, 0, 2);
    await expect(service.retract('w1', 'u1', 'i1')).rejects.toMatchObject({ status: 422 });
    // Bình luận authorId NULL cũng tính là của người khác (SQL `<>` bỏ qua NULL nếu chỉ dùng `not`).
    expect(comment.count).toHaveBeenCalledWith({
      where: {
        issueId: 'i1',
        deletedAt: null,
        OR: [{ authorId: null }, { authorId: { not: 'u1' } }],
      },
    });
    // Việc con HOẶC việc gắn qua epicId (Epic) đều chặn.
    expect(issue.count).toHaveBeenCalledWith({
      where: { deletedAt: null, OR: [{ parentId: 'i1' }, { epicId: 'i1' }] },
    });
  });
  it('dự án đã lưu trữ => chặn', async () => {
    const { service } = setup({
      reporterId: 'u1',
      createdAt: at(1),
      project: { archivedAt: new Date() },
    });
    await expect(service.retract('w1', 'u1', 'i1')).rejects.toMatchObject({ status: 422 });
  });
});

describe('IssuesService.restore — khôi phục việc từ Thùng rác', () => {
  function setup(found: Record<string, unknown> | null, count = 1) {
    const issue = {
      findFirst: vi.fn(() => Promise.resolve(found ? issueRow(found) : null)),
      findFirstOrThrow: vi.fn(() => Promise.resolve(issueRow({ version: 5 }))),
      updateMany: vi.fn(() => Promise.resolve({ count })),
    };
    return { ...makeService({ issue }), issue };
  }
  it('ghi deletedAt:null chỉ khi đang xoá, tăng version, phát ISSUE_UPDATED, trả IssueDto', async () => {
    const { service, issue, events } = setup({ deletedAt: new Date() });
    const dto = await service.restore('w1', 'u9', 'p1', 'i1');
    expect(issue.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'i1', workspaceId: 'w1', projectId: 'p1', deletedAt: { not: null } },
      }),
    );
    expect(issue.updateMany).toHaveBeenCalledWith({
      where: { id: 'i1', workspaceId: 'w1', projectId: 'p1', deletedAt: { not: null } },
      data: { deletedAt: null, updatedById: 'u9', version: { increment: 1 } },
    });
    expect(dto.id).toBe('i1');
    expect(events.emit).toHaveBeenCalledWith(
      DOMAIN_EVENTS.ISSUE_UPDATED,
      expect.objectContaining({ actorId: 'u9' }),
    );
  });
  it('cha/epic đã xoá mềm => khôi phục thành việc không cha/epic, changedFields nêu rõ', async () => {
    const found = { deletedAt: new Date(), parentId: 'gone', epicId: 'live' };
    const { service, issue, events } = setup(found);
    (issue as unknown as { findMany: unknown }).findMany = vi.fn(() =>
      Promise.resolve([{ id: 'live' }]),
    );
    await service.restore('w1', 'u9', 'p1', 'i1');
    const data = (issue.updateMany.mock.calls as unknown as Array<[{ data: object }]>)[0]![0].data;
    expect(data).toMatchObject({ deletedAt: null, parentId: null });
    expect(data).not.toHaveProperty('epicId');
    expect(events.emit).toHaveBeenCalledWith(
      DOMAIN_EVENTS.ISSUE_UPDATED,
      expect.objectContaining({ changedFields: ['deletedAt', 'parentId'] }),
    );
  });
  it('không có trong Thùng rác => 404; hai lần khôi phục đồng thời chỉ một thắng', async () => {
    await expect(setup(null).service.restore('w1', 'u9', 'p1', 'i1')).rejects.toMatchObject({
      status: 404,
    });
    const raced = setup({ deletedAt: new Date() }, 0);
    await expect(raced.service.restore('w1', 'u9', 'p1', 'i1')).rejects.toMatchObject({
      status: 404,
    });
    expect(raced.events.emit).not.toHaveBeenCalled();
  });
  it('dự án đã lưu trữ => chặn, chưa ghi', async () => {
    const { service, issue } = setup({
      deletedAt: new Date(),
      project: { archivedAt: new Date() },
    });
    await expect(service.restore('w1', 'u9', 'p1', 'i1')).rejects.toMatchObject({ status: 422 });
    expect(issue.updateMany).not.toHaveBeenCalled();
  });
});

describe('IssuesService.bulkUpdate', () => {
  /** Hai issue a, b (version 3). `lose` = id bị thua OCC lúc ghi (version hiện tại trong DB = 5). */
  function bulkTx(
    opts: { rows?: Array<Record<string, unknown>>; lose?: string; allowTransition?: boolean } = {},
  ) {
    const rows = opts.rows ?? [issueRow({ id: 'a' }), issueRow({ id: 'b' })];
    const tx = {
      issue: {
        findMany: vi.fn((_args: { where: Record<string, unknown> }) => Promise.resolve(rows)),
        updateMany: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve({ count: where.id === opts.lose ? 0 : 1 }),
        ),
        findFirst: vi.fn(() => Promise.resolve({ version: 5 })),
        findFirstOrThrow: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(issueRow({ id: where.id, version: 4, assigneeId: 'u2' })),
        ),
      },
      issueHistory: { createMany: vi.fn(), create: vi.fn() },
      project: { findUnique: vi.fn(() => Promise.resolve({ defaultWorkflowId: 'wf' })) },
      workflowTransition: {
        findFirst: vi.fn(() =>
          Promise.resolve(opts.allowTransition === false ? null : { id: 'tr' }),
        ),
      },
      status: { findUnique: vi.fn(() => Promise.resolve({ category: 'IN_PROGRESS' })) },
    };
    return tx;
  }
  const items = [
    { id: 'a', version: 3 },
    { id: 'b', version: 3 },
  ];

  it('transaction của lô đặt timeout/maxWait đủ rộng (mặc định 5s quá sát với 100 item × ~4 truy vấn)', async () => {
    const tx = bulkTx();
    const txSpy = vi.fn((fn: (t: unknown) => unknown, _opts?: unknown) => fn(tx));
    const { service } = makeService(tx, { $transaction: txSpy });
    await service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { assigneeId: 'u2' } });
    expect(txSpy.mock.calls[0]![1]).toMatchObject({ timeout: 30_000, maxWait: 10_000 });
  });

  it('bulk sang Done => mỗi item nhận Resolution mặc định, tra mặc định đúng một lần cho cả lô', async () => {
    const tx = bulkTx();
    tx.status.findUnique = vi.fn(() => Promise.resolve({ category: 'DONE' }));
    const resolution = { findFirst: vi.fn(() => Promise.resolve({ id: 'r-done' })) };
    const { service } = makeService(tx, { resolution });
    await service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { statusId: 's2' } });
    expect(resolution.findFirst).toHaveBeenCalledTimes(1);
    for (const call of tx.issue.updateMany.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >)
      expect(call[0].data.resolutionId).toBe('r-done');
  });

  it('bulk rời Done => resolutionId và resolvedAt về null', async () => {
    const rows = [
      issueRow({ id: 'a', resolutionId: 'r-old' }),
      issueRow({ id: 'b', resolutionId: 'r-old' }),
    ];
    const tx = bulkTx({ rows });
    const resolution = { findFirst: vi.fn(() => Promise.resolve({ id: 'r-done' })) };
    const { service } = makeService(tx, { resolution });
    await service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { statusId: 's2' } });
    expect(resolution.findFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'w1', isDefault: true } }),
    );
    for (const call of tx.issue.updateMany.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >)
      expect(call[0].data).toMatchObject({ resolutionId: null, resolvedAt: null });
  });

  it('2 item, 1 thua OCC lúc ghi => updated 1, conflicts 1 (kèm version hiện tại), chỉ emit cho item đã ghi', async () => {
    const tx = bulkTx({ lose: 'b' });
    const { service, events } = makeService(tx);
    const res = await service.bulkUpdate('w1', 'u1', {
      projectId: 'p1',
      items,
      patch: { assigneeId: 'u2' },
    });
    expect(res.updated).toHaveLength(1);
    expect(res.updated[0]).toMatchObject({ id: 'a', version: 4 });
    expect(res.conflicts).toEqual([{ id: 'b', version: 5 }]);
    expect(tx.issueHistory.createMany).toHaveBeenCalledTimes(1); // chỉ item a
    // 1 ISSUE_UPDATED (item a) + 1 ISSUES_BULK_UPDATED gộp cho cả lô.
    expect(events.emit).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledWith(
      'issue.updated',
      expect.objectContaining({ actorId: 'u1' }),
    );
  });

  it('sửa hàng loạt: mỗi ISSUE_UPDATED mang `batch` (không phải `bulk`) và có MỘT ISSUES_BULK_UPDATED cho cả lô', async () => {
    const tx = bulkTx();
    const { service, events } = makeService(tx);
    await service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { assigneeId: 'u2' } });
    const calls = events.emit.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
    const updated = calls.filter(([n]) => n === 'issue.updated').map(([, p]) => p);
    expect(updated).toHaveLength(2);
    const batchId = (updated[0]!.batch as { id: string }).id;
    for (const p of updated) {
      expect(p.batch).toEqual({ id: batchId, size: 2 });
      // `bulk: true` = hệ thống phát hàng loạt (thông báo "được giao" sẽ bị bỏ qua) — người dùng sửa thì KHÔNG đặt.
      expect(p).not.toHaveProperty('bulk');
    }
    const summary = calls.filter(([n]) => n === 'issue.bulk_updated');
    expect(summary).toHaveLength(1);
    expect(summary[0]![1]).toMatchObject({
      workspaceId: 'w1',
      projectId: 'p1',
      actorId: 'u1',
      count: 2,
    });
  });

  it('version đã lệch từ lúc đọc => conflict ngay, không gọi updateMany cho item đó', async () => {
    const tx = bulkTx({ rows: [issueRow({ id: 'a' }), issueRow({ id: 'b', version: 9 })] });
    const { service } = makeService(tx);
    const res = await service.bulkUpdate('w1', 'u1', {
      projectId: 'p1',
      items,
      patch: { assigneeId: 'u2' },
    });
    expect(res.conflicts).toEqual([{ id: 'b', version: 9 }]);
    expect(res.updated.map((i) => i.id)).toEqual(['a']);
    expect(tx.issue.updateMany).toHaveBeenCalledTimes(1);
  });

  it('item không thuộc dự án/workspace => 404 cho cả yêu cầu, chưa mở transaction', async () => {
    const tx = bulkTx({ rows: [issueRow({ id: 'a' })] });
    const txSpy = vi.fn();
    const { service } = makeService(tx, { $transaction: txSpy });
    await expect(
      service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { assigneeId: 'u2' } }),
    ).rejects.toMatchObject({ status: 404 });
    expect(txSpy).not.toHaveBeenCalled();
    expect(tx.issue.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { workspaceId: 'w1', projectId: 'p1', deletedAt: null },
    });
  });

  it('chỉ có issue:edit, patch có statusId => 403, không đọc/ghi issue, không mở transaction', async () => {
    const tx = bulkTx();
    const txSpy = vi.fn();
    const { service, rbac } = makeService(tx, {
      $transaction: txSpy,
      user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: false })) },
    });
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:edit']));
    await expect(
      service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { statusId: 's2' } }),
    ).rejects.toMatchObject({ status: 403 });
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('u1', 'w1', 'p1');
    expect(tx.issue.findMany).not.toHaveBeenCalled();
    expect(txSpy).not.toHaveBeenCalled();
  });

  it('có issue:transition:own hoặc là system admin => được đổi trạng thái', async () => {
    for (const [perms, admin] of [
      [['issue:transition:own'], false],
      [['issue:edit'], true],
    ] as const) {
      const tx = bulkTx();
      const { service, rbac } = makeService(tx, {
        user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: admin })) },
      });
      rbac.getEffectivePermissions.mockResolvedValue(new Set(perms));
      const res = await service.bulkUpdate('w1', 'u1', {
        projectId: 'p1',
        items,
        patch: { statusId: 's2' },
      });
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
      Promise.resolve(
        issueRow({
          id: where.id,
          version: 4,
          statusId: 's2',
          status: {
            id: 's2',
            workflowId: 'wf',
            name: 'Doing',
            category: 'IN_PROGRESS',
            color: null,
            order: 1,
            isInitial: false,
          },
        }),
      ),
    );
    const { service, events, rbac } = makeService(tx);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:transition']));
    const res = await service.bulkUpdate('w1', 'u1', {
      projectId: 'p1',
      items,
      patch: { statusId: 's2' },
    });
    expect(res.updated).toHaveLength(2);
    expect(tx.issueHistory.create).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledWith(
      'issue.transitioned',
      expect.objectContaining({ fromStatusId: 's1' }),
    );
  });

  it('patch không đổi gì so với hiện tại => không ghi, không tăng version, không emit', async () => {
    const tx = bulkTx();
    const { service, events } = makeService(tx);
    const res = await service.bulkUpdate('w1', 'u1', {
      projectId: 'p1',
      items,
      patch: { assigneeId: null },
    });
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
    const first = await service.query('w1', {}, [], undefined, 2, null, {
      rawIds: ['a', 'b', 'c'],
    });
    expect(first.data.map((i) => i.id)).toEqual(['a', 'b']);
    expect(first.pageInfo).toMatchObject({ hasNextPage: true });
    const second = await service.query('w1', {}, [], 'b', 2, null, { rawIds: ['a', 'b', 'c'] });
    expect(second.data.map((i) => i.id)).toEqual(['c']);
    expect(second.pageInfo).toMatchObject({ hasNextPage: false });
  });

  it('con trỏ không còn trong rawIds => trang rỗng (không quay lại trang đầu); con trỏ còn trong rawIds dù issue đã mất vẫn tiếp tục đúng chỗ', async () => {
    const rows = ['a', 'c'].map((id) => issueRow({ id })); // b đã bị xoá/ẩn khỏi kết quả
    const { service } = setup(rows);
    const gone = await service.query('w1', {}, [], 'zzz', 2, null, { rawIds: ['a', 'b', 'c'] });
    expect(gone.data).toEqual([]);
    expect(gone.pageInfo).toMatchObject({ hasNextPage: false, endCursor: null });
    const afterB = await service.query('w1', {}, [], 'b', 2, null, { rawIds: ['a', 'b', 'c'] });
    expect(afterB.data.map((i) => i.id)).toEqual(['c']);
  });

  it('rawIds rỗng -> trang rỗng, không truy vấn DB', async () => {
    const { service, findMany } = setup([]);
    const res = await service.query('w1', {}, [], undefined, 10, null, { rawIds: [] });
    expect(res.data).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('có orderBy tường minh -> lọc theo id nhưng để DB sắp xếp', async () => {
    const { service, findMany } = setup([issueRow({ id: 'a' })]);
    await service.query('w1', {}, [{ createdAt: 'asc' }], undefined, 10, null, {
      rawIds: ['a', 'b'],
    });
    const args = (findMany.mock.calls[0] as unknown as [{ where: unknown; orderBy: unknown }])[0];
    expect(JSON.stringify(args.where)).toContain('"in":["a","b"]');
    expect(args.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });
});

/** Cột "Doing" (statusIds s2, s4) có giới hạn `limit`, đang có `count` việc; issue đang ở s1 (ngoài cột). */
function wipTx(
  opts: {
    limit?: number | null;
    count?: number;
    boardType?: 'SCRUM' | 'KANBAN';
    activeSprint?: boolean;
    issue?: Record<string, unknown>;
    column?: boolean;
  } = {},
) {
  const limit = opts.limit === undefined ? 2 : opts.limit;
  const issue = issueRow(opts.issue ?? {});
  return {
    boardColumn: {
      findFirst: vi.fn(() =>
        Promise.resolve(
          opts.column === false
            ? null
            : {
                id: 'c2',
                name: 'Doing',
                wipLimit: limit,
                board: { type: opts.boardType ?? 'KANBAN' },
                statuses: [{ statusId: 's2' }, { statusId: 's4' }],
              },
        ),
      ),
    },
    sprint: {
      findFirst: vi.fn(() => Promise.resolve(opts.activeSprint === false ? null : { id: 'sp1' })),
    },
    $queryRaw: vi.fn(() => Promise.resolve([])),
    issue: {
      findFirst: vi.fn(() => Promise.resolve(issue)),
      findMany: vi.fn(() => Promise.resolve([issue])),
      count: vi.fn((_args: { where: Record<string, unknown> }) => Promise.resolve(opts.count ?? 2)),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      findFirstOrThrow: vi.fn(() => Promise.resolve(issueRow({ version: 4, statusId: 's2' }))),
    },
    issueHistory: { createMany: vi.fn(), create: vi.fn() },
    project: {
      findUnique: vi.fn(() => Promise.resolve({ defaultWorkflowId: 'wf', archivedAt: null })),
    },
    workflowTransition: { findFirst: vi.fn(() => Promise.resolve({ id: 'tr' })) },
    status: { findUnique: vi.fn(() => Promise.resolve({ category: 'IN_PROGRESS' })) },
  };
}

describe('IssuesService — giới hạn WIP của cột board', () => {
  const input = { version: 3, toStatusId: 's2', boardId: 'b1' };

  it('transition vào cột đã đầy, không force => WIP_LIMIT_REACHED (422), không ghi, không emit', async () => {
    const tx = wipTx({ count: 2 });
    const { service, events } = makeService(tx);
    await expect(service.transition('w1', 'u1', 'i1', input)).rejects.toMatchObject({
      status: 422,
      response: {
        code: 'WIP_LIMIT_REACHED',
        message:
          'Cột "Doing" đã đạt giới hạn 2 việc đang làm — hãy hoàn thành bớt hoặc chọn "Vẫn chuyển"',
      },
    });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('kiểm WIP chạy TRONG transaction, sau khi khoá dòng cột (FOR UPDATE) để hai request đồng thời không cùng lọt', async () => {
    const order: string[] = [];
    const tx = wipTx({ count: 1 });
    tx.$queryRaw = vi.fn(() => {
      order.push('lock');
      return Promise.resolve([]);
    });
    tx.issue.count = vi.fn(() => {
      order.push('count');
      return Promise.resolve(1);
    });
    tx.issue.updateMany = vi.fn(() => {
      order.push('write');
      return Promise.resolve({ count: 1 });
    });
    const { service } = makeService(tx);
    await service.transition('w1', 'u1', 'i1', input);
    expect(order).toEqual(['lock', 'count', 'write']);
  });

  it('còn chỗ (count < giới hạn) => chuyển bình thường, đếm đúng project + trạng thái của cột + chưa xoá', async () => {
    const tx = wipTx({ count: 1 });
    const { service, events } = makeService(tx);
    await service.transition('w1', 'u1', 'i1', input);
    expect(tx.issue.count.mock.calls[0]![0].where).toMatchObject({
      projectId: 'p1',
      deletedAt: null,
      statusId: { in: ['s2', 's4'] },
    });
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('board SCRUM chỉ đếm việc của sprint đang ACTIVE; không có sprint ACTIVE => không chặn', async () => {
    const tx = wipTx({ count: 2, boardType: 'SCRUM' });
    const { service } = makeService(tx);
    await expect(service.transition('w1', 'u1', 'i1', input)).rejects.toMatchObject({
      response: { code: 'WIP_LIMIT_REACHED' },
    });
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
    const { service, rbac } = makeService(tx, {
      user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: false })) },
    });
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:transition']));
    await expect(
      service.transition('w1', 'u1', 'i1', { ...input, force: true }),
    ).rejects.toMatchObject({ status: 403 });
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
    await expect(
      service.move('w1', 'u1', 'i1', { version: 3, statusId: 's2', boardId: 'b1' }),
    ).rejects.toMatchObject({
      response: { code: 'WIP_LIMIT_REACHED' },
    });
    const same = wipTx({ count: 2 });
    await makeService(same).service.move('w1', 'u1', 'i1', { version: 3, boardId: 'b1' });
    expect(same.issue.count).not.toHaveBeenCalled();
  });

  it('move đổi trạng thái => ghi IssueHistory STATUS trong cùng transaction; không đổi trạng thái thì không ghi', async () => {
    const tx = wipTx({ count: 0 });
    await makeService(tx).service.move('w1', 'u1', 'i1', {
      version: 3,
      statusId: 's2',
      boardId: 'b1',
    });
    expect(tx.issueHistory.create).toHaveBeenCalledTimes(1);
    expect(tx.issueHistory.create.mock.calls[0]![0]).toMatchObject({
      data: { issueId: 'i1', field: 'STATUS', actorId: 'u1' },
    });

    const same = wipTx({ count: 0 });
    same.issue.findFirstOrThrow = vi.fn(() => Promise.resolve(issueRow({ version: 4 })));
    await makeService(same).service.move('w1', 'u1', 'i1', { version: 3 });
    expect(same.issueHistory.create).not.toHaveBeenCalled();
  });

  it('bulkUpdate: chuyển nhiều việc vào cột chỉ còn 1 chỗ => chặn cả lô, nêu số chỗ còn lại', async () => {
    const tx = wipTx({ count: 1 });
    tx.issue.findMany = vi.fn(() =>
      Promise.resolve([issueRow({ id: 'a' }), issueRow({ id: 'b' })]),
    );
    const { service, rbac } = makeService(tx);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:transition']));
    await expect(
      service.bulkUpdate('w1', 'u1', {
        projectId: 'p1',
        boardId: 'b1',
        patch: { statusId: 's2' },
        items: [
          { id: 'a', version: 3 },
          { id: 'b', version: 3 },
        ],
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'WIP_LIMIT_REACHED', message: has('chỉ còn chỗ cho 1') },
    });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('dự án đã lưu trữ => transition/move bị chặn trước khi đụng DB ghi', async () => {
    const tx = wipTx({ issue: { project: { archivedAt: new Date() } } });
    const { service } = makeService(tx);
    await expect(service.transition('w1', 'u1', 'i1', input)).rejects.toMatchObject({
      status: 422,
      message: has('lưu trữ'),
    });
    await expect(service.move('w1', 'u1', 'i1', { version: 3 })).rejects.toMatchObject({
      status: 422,
    });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });
});

describe('IssuesService.move — workflow, resolution, sự kiện', () => {
  const emitted = (events: { emit: ReturnType<typeof vi.fn> }) =>
    events.emit.mock.calls.map((c) => c[0] as string);

  it('đổi trạng thái sai workflow => 409 INVALID_TRANSITION, không ghi, không emit, chưa tính rank', async () => {
    const tx = wipTx({ count: 0 });
    const transitionFind = vi.fn((_args: { where: unknown }) => Promise.resolve(null));
    tx.workflowTransition.findFirst = transitionFind as never; // ép kiểu: mock gốc luôn trả {id}
    const { service, events } = makeService(tx);
    await expect(
      service.move('w1', 'u1', 'i1', { version: 3, statusId: 's2', afterId: 'a' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(transitionFind.mock.calls[0]![0]).toMatchObject({
      where: { workflowId: 'wf', toStatusId: 's2' },
    });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
    // Chưa tính rank: không tra issue mốc `afterId`, không rebalance.
    expect(tx.issue.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.issue.findMany).not.toHaveBeenCalled();
  });

  it('đổi trạng thái hợp lệ => emit ISSUE_MOVED rồi ISSUE_TRANSITIONED (có fromStatusId), history STATUS', async () => {
    const tx = wipTx({ count: 0 });
    const { service, events } = makeService(tx);
    await service.move('w1', 'u1', 'i1', { version: 3, statusId: 's2' });
    expect(emitted(events)).toEqual([DOMAIN_EVENTS.ISSUE_MOVED, DOMAIN_EVENTS.ISSUE_TRANSITIONED]);
    expect(events.emit).toHaveBeenLastCalledWith(
      DOMAIN_EVENTS.ISSUE_TRANSITIONED,
      expect.objectContaining({ actorId: 'u1', fromStatusId: 's1' }),
    );
    const payload = events.emit.mock.calls[1]![1] as { issue: { id: string } };
    expect(payload.issue.id).toBe('i1');
    expect(tx.issueHistory.create).toHaveBeenCalledTimes(1);
  });

  it('sang DONE => resolvedAt đặt, resolutionId = Resolution mặc định của workspace; rời DONE => cả hai null', async () => {
    const done = wipTx({ count: 0 });
    done.status.findUnique = vi.fn(() => Promise.resolve({ category: 'DONE' }));
    const resolution = { findFirst: vi.fn(() => Promise.resolve({ id: 'r-done' })) };
    await makeService(done, { resolution }).service.move('w1', 'u1', 'i1', {
      version: 3,
      statusId: 's2',
    });
    expect(resolution.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'w1', isDefault: true } }),
    );
    const d1 = done.issue.updateMany.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(d1[0].data.resolvedAt).toBeInstanceOf(Date);
    expect(d1[0].data.resolutionId).toBe('r-done');

    const open = wipTx({ count: 0 });
    await makeService(open).service.move('w1', 'u1', 'i1', { version: 3, statusId: 's2' });
    const d2 = open.issue.updateMany.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(d2[0].data).toMatchObject({ resolvedAt: null, resolutionId: null });
  });

  it('không đổi trạng thái (xếp lại thứ tự / cùng statusId) => không tra workflow, chỉ emit ISSUE_MOVED', async () => {
    const tx = wipTx({ count: 0 });
    tx.issue.findFirstOrThrow = vi.fn(() => Promise.resolve(issueRow({ version: 4 })));
    const { service, events } = makeService(tx);
    await service.move('w1', 'u1', 'i1', { version: 3 });
    await service.move('w1', 'u1', 'i1', { version: 3, statusId: 's1' });
    expect(tx.workflowTransition.findFirst).not.toHaveBeenCalled();
    expect(emitted(events)).toEqual([DOMAIN_EVENTS.ISSUE_MOVED, DOMAIN_EVENTS.ISSUE_MOVED]);
    const data = (
      tx.issue.updateMany.mock.calls[0] as unknown as [{ data: Record<string, unknown> }]
    )[0].data;
    expect('resolvedAt' in data).toBe(false); // xếp lại thứ tự không đụng resolution
  });
});

describe('IssuesService.transition — Resolution mặc định và lý do', () => {
  it('transition sang Done: resolutionId tường minh thắng mặc định; comment được tạo sau commit', async () => {
    const tx = wipTx({ count: 0 });
    tx.status.findUnique = vi.fn(() => Promise.resolve({ category: 'DONE', name: 'Done' }));
    const comments = { create: vi.fn(() => Promise.resolve({})) };
    const resolution = {
      findFirst: vi.fn(() => Promise.resolve({ id: 'r-done' })),
    };
    const { service } = makeService(tx, { resolution }, comments);
    await service.transition('w1', 'u1', 'i1', {
      toStatusId: 's2',
      version: 3,
      resolutionId: 'r-cnr',
      comment: 'Không tái hiện được trên iOS 17',
    });
    const data = (
      tx.issue.updateMany.mock.calls[0] as unknown as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(data.resolutionId).toBe('r-cnr');
    expect(resolution.findFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'w1', isDefault: true } }),
    );
    expect(comments.create).toHaveBeenCalledWith(
      'w1',
      'u1',
      'i1',
      expect.objectContaining({
        bodyFormat: 'MARKDOWN',
        body: expect.stringContaining('Không tái hiện được trên iOS 17') as string,
      }),
    );
  });

  it('transition sang Done không gửi resolutionId => dùng Resolution mặc định; resolutionId=null tường minh => không đặt', async () => {
    const mk = () => {
      const tx = wipTx({ count: 0 });
      tx.status.findUnique = vi.fn(() => Promise.resolve({ category: 'DONE' }));
      return tx;
    };
    const resolution = { findFirst: vi.fn(() => Promise.resolve({ id: 'r-done' })) };
    const a = mk();
    await makeService(a, { resolution }).service.transition('w1', 'u1', 'i1', {
      toStatusId: 's2',
      version: 3,
    });
    expect(
      (a.issue.updateMany.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data
        .resolutionId,
    ).toBe('r-done');
    const b = mk();
    await makeService(b, { resolution }).service.transition('w1', 'u1', 'i1', {
      toStatusId: 's2',
      version: 3,
      resolutionId: null,
    });
    expect(
      (b.issue.updateMany.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data
        .resolutionId,
    ).toBeNull();
  });

  it('transition có comment nhưng thiếu comment:create => 403, chưa ghi', async () => {
    const tx = wipTx({ count: 0 });
    const comments = { create: vi.fn() };
    const { service, events } = makeService(
      tx,
      { user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: false })) } },
      comments,
      ['issue:transition'],
    );
    await expect(
      service.transition('w1', 'u1', 'i1', { toStatusId: 's2', version: 3, comment: 'lý do' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(comments.create).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('transition: ghi lý do thất bại không làm hỏng chuyển trạng thái', async () => {
    const tx = wipTx({ count: 0 });
    const comments = { create: vi.fn(() => Promise.reject(new Error('boom'))) };
    const { service, events } = makeService(tx, {}, comments);
    const dto = await service.transition('w1', 'u1', 'i1', {
      toStatusId: 's2',
      version: 3,
      comment: 'lý do',
    });
    expect(dto.id).toBe('i1');
    expect(dto.reasonSaved).toBe(false); // FE dựa vào cờ này để báo "chưa ghi được lý do"
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('transition: ghi lý do thành công => reasonSaved=true; không gửi comment => không có cờ', async () => {
    const comments = { create: vi.fn(() => Promise.resolve({})) };
    const a = await makeService(wipTx({ count: 0 }), {}, comments).service.transition(
      'w1',
      'u1',
      'i1',
      { toStatusId: 's2', version: 3, comment: 'lý do' },
    );
    expect(a.reasonSaved).toBe(true);
    const b = await makeService(wipTx({ count: 0 }), {}, comments).service.transition(
      'w1',
      'u1',
      'i1',
      { toStatusId: 's2', version: 3 },
    );
    expect('reasonSaved' in b).toBe(false);
  });

  it('transition rời Done => resolutionId và resolvedAt về null (không tra mặc định)', async () => {
    const tx = wipTx({ count: 0, issue: { statusId: 's4', resolutionId: 'r-done' } });
    const resolution = { findFirst: vi.fn(() => Promise.resolve({ id: 'r-done' })) };
    await makeService(tx, { resolution }).service.transition('w1', 'u1', 'i1', {
      toStatusId: 's2',
      version: 3,
    });
    const data = (
      tx.issue.updateMany.mock.calls[0] as unknown as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(data).toMatchObject({ resolutionId: null, resolvedAt: null });
    expect(resolution.findFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'w1', isDefault: true } }),
    );
  });

  it('transition có comment: system admin không có comment:create vẫn ghi được lý do', async () => {
    const tx = wipTx({ count: 0 });
    const comments = { create: vi.fn(() => Promise.resolve({})) };
    const { service } = makeService(
      tx,
      { user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: true })) } },
      comments,
      ['issue:transition'],
    );
    const dto = await service.transition('w1', 'u1', 'i1', {
      toStatusId: 's2',
      version: 3,
      comment: 'lý do',
    });
    expect(dto.reasonSaved).toBe(true);
    expect(comments.create).toHaveBeenCalledTimes(1);
  });
});

describe('IssuesService — assignee phải là thành viên, sprint phải cùng dự án', () => {
  const noMember = () => ({
    workspaceMembership: { findFirst: vi.fn(() => Promise.resolve(null)) },
  });

  it('update(assigneeId) người ngoài workspace => 422, chưa ghi', async () => {
    const tx = {
      issue: {
        findFirst: vi.fn(() => Promise.resolve(issueRow())),
        updateMany: vi.fn(),
        findFirstOrThrow: vi.fn(),
      },
      issueHistory: { createMany: vi.fn() },
    };
    const extra = noMember();
    const { service } = makeService(tx, extra);
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, assigneeId: 'xx' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(extra.workspaceMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'w1', userId: 'xx', user: { status: { not: 'DEACTIVATED' } } },
      }),
    );
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('update(assigneeId: null) không cần kiểm thành viên', async () => {
    const tx = {
      issue: {
        findFirst: vi.fn(() => Promise.resolve(issueRow({ assigneeId: 'u2' }))),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
        findFirstOrThrow: vi.fn(() => Promise.resolve(issueRow({ version: 4 }))),
      },
      issueHistory: { createMany: vi.fn() },
    };
    const extra = noMember();
    const { service } = makeService(tx, extra);
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, assigneeId: null }),
    ).resolves.toBeDefined();
    expect(extra.workspaceMembership.findFirst).not.toHaveBeenCalled();
  });

  it('create(assigneeId) người ngoài workspace => 422, chưa ghi', async () => {
    const tx = {
      project: {
        findFirst: vi.fn(() =>
          Promise.resolve({
            id: 'p1',
            key: 'P',
            defaultWorkflowId: 'wf',
            leadId: null,
            defaultAssigneeMode: 'NONE',
            archivedAt: null,
          }),
        ),
      },
      issueType: { findFirst: vi.fn(() => Promise.resolve({ id: 't1' })) },
      issue: { create: vi.fn() },
    };
    const { service } = makeService(tx, noMember());
    await expect(
      service.create('w1', 'u1', {
        projectId: 'p1',
        typeId: 't1',
        summary: 's',
        descriptionFormat: 'MARKDOWN',
        assigneeId: 'xx',
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.issue.create).not.toHaveBeenCalled();
  });

  it('bulkUpdate(patch.assigneeId) người ngoài workspace => 422, không ghi gì', async () => {
    const tx = {
      issue: {
        findMany: vi.fn(() => Promise.resolve([issueRow({ id: 'a' })])),
        updateMany: vi.fn(),
        findFirstOrThrow: vi.fn(),
      },
      project: { findUnique: vi.fn(() => Promise.resolve({ archivedAt: null })) },
    };
    const txSpy = vi.fn();
    const { service } = makeService(tx, { ...noMember(), $transaction: txSpy });
    await expect(
      service.bulkUpdate('w1', 'u1', {
        projectId: 'p1',
        items: [{ id: 'a', version: 3 }],
        patch: { assigneeId: 'xx' },
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(txSpy).not.toHaveBeenCalled();
  });

  it('move(sprintId) kiểm sprint theo CHÍNH dự án của issue; sprint dự án khác => 404, không ghi', async () => {
    const tx = wipTx({ count: 0 });
    const sprintFind = vi.fn((_args: { where: unknown }) => Promise.resolve(null)); // không có sprint sp9 trong dự án p1
    tx.sprint.findFirst = sprintFind as never;
    const { service } = makeService(tx);
    await expect(
      service.move('w1', 'u1', 'i1', { version: 3, sprintId: 'sp9' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(sprintFind.mock.calls[0]![0]).toMatchObject({
      where: { id: 'sp9', projectId: 'p1', deletedAt: null },
    });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('update(sprintId) cũng ràng buộc cùng dự án (projectId của issue hiện tại)', async () => {
    const sprintFind = vi.fn(() => Promise.resolve(null));
    const tx = {
      issue: {
        findFirst: vi.fn(() => Promise.resolve(issueRow())),
        updateMany: vi.fn(),
        findFirstOrThrow: vi.fn(),
      },
      sprint: { findFirst: sprintFind },
    };
    const { service } = makeService(tx);
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, sprintId: 'sp9' }),
    ).rejects.toMatchObject({ status: 404 });
    expect((sprintFind.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toMatchObject({
      id: 'sp9',
      projectId: 'p1',
    });
  });

  it('bulkUpdate(sprintId) ràng buộc sprint theo projectId của lô', async () => {
    const sprintFind = vi.fn(() => Promise.resolve(null));
    const tx = {
      issue: {
        findMany: vi.fn(() => Promise.resolve([issueRow({ id: 'a' })])),
        updateMany: vi.fn(),
        findFirstOrThrow: vi.fn(),
      },
      project: { findUnique: vi.fn(() => Promise.resolve({ archivedAt: null })) },
      sprint: { findFirst: sprintFind },
    };
    const { service } = makeService(tx);
    await expect(
      service.bulkUpdate('w1', 'u1', {
        projectId: 'p1',
        items: [{ id: 'a', version: 3 }],
        patch: { sprintId: 'sp9' },
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect((sprintFind.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toMatchObject({
      id: 'sp9',
      projectId: 'p1',
    });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });
});

describe('IssuesService — sprint CLOSED không nhận việc (FW1)', () => {
  const closedSprint = () => vi.fn(() => Promise.resolve({ id: 'sp9', state: 'CLOSED' }));

  it('create(sprintId đã đóng) => 422, chưa ghi', async () => {
    const tx = {
      project: {
        findFirst: vi.fn(() =>
          Promise.resolve({
            id: 'p1',
            key: 'P',
            defaultWorkflowId: 'wf',
            leadId: null,
            defaultAssigneeMode: 'NONE',
            archivedAt: null,
          }),
        ),
      },
      issueType: { findFirst: vi.fn(() => Promise.resolve({ id: 't1' })) },
      sprint: { findFirst: closedSprint() },
      issue: { create: vi.fn() },
    };
    const { service } = makeService(tx);
    await expect(
      service.create('w1', 'u1', {
        projectId: 'p1',
        typeId: 't1',
        summary: 's',
        descriptionFormat: 'MARKDOWN',
        sprintId: 'sp9',
      }),
    ).rejects.toMatchObject({ status: 422, message: has('Sprint đã hoàn thành') });
    expect(tx.issue.create).not.toHaveBeenCalled();
  });

  it('createWithin (import Jira gắn sprint CLOSED theo lịch sử) KHÔNG bị chặn, create() thường vẫn 422', async () => {
    const input = {
      projectId: 'p1',
      typeId: 't1',
      summary: 's',
      descriptionFormat: 'MARKDOWN' as const,
      sprintId: 'sp9',
    };
    const w = createTx([{ id: 's1', category: 'TODO', isInitial: true }]);
    const tx = Object.assign(w.tx, { sprint: { findFirst: closedSprint() } });
    const { service } = makeService(tx);
    await expect(service.createWithin(tx as never, 'w1', 'u1', input, [])).resolves.toBeDefined();
    expect(w.created.mock.calls[0]![0].data.sprintId).toBe('sp9');
    await expect(service.create('w1', 'u1', input)).rejects.toMatchObject({ status: 422 });
    expect(w.created).toHaveBeenCalledTimes(1);
  });

  it('update(sprintId đã đóng) => 422, chưa ghi', async () => {
    const tx = {
      issue: {
        findFirst: vi.fn(() => Promise.resolve(issueRow())),
        updateMany: vi.fn(),
        findFirstOrThrow: vi.fn(),
      },
      sprint: { findFirst: closedSprint() },
    };
    const { service } = makeService(tx);
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, sprintId: 'sp9' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('update: việc ĐANG ở sprint đã đóng, sửa field khác (kể cả gửi lại sprintId cũ) => không bị chặn', async () => {
    const sprintFind = closedSprint();
    const tx = {
      issue: {
        findFirst: vi.fn(() => Promise.resolve(issueRow({ sprintId: 'sp9' }))),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
        findFirstOrThrow: vi.fn(() =>
          Promise.resolve(issueRow({ sprintId: 'sp9', version: 4, summary: 'mới' })),
        ),
      },
      issueHistory: { createMany: vi.fn() },
      sprint: { findFirst: sprintFind },
    };
    const { service } = makeService(tx);
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, summary: 'mới' }),
    ).resolves.toBeDefined();
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, summary: 'mới', sprintId: 'sp9' }),
    ).resolves.toBeDefined();
    expect(tx.issue.updateMany).toHaveBeenCalledTimes(2);
  });

  it('update(sprintId: null) từ sprint đã đóng => được bỏ gán', async () => {
    const sprintFind = closedSprint();
    const tx = {
      issue: {
        findFirst: vi.fn(() => Promise.resolve(issueRow({ sprintId: 'sp9' }))),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
        findFirstOrThrow: vi.fn(() => Promise.resolve(issueRow({ sprintId: null, version: 4 }))),
      },
      issueHistory: { createMany: vi.fn() },
      sprint: { findFirst: sprintFind },
    };
    const { service } = makeService(tx);
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, sprintId: null }),
    ).resolves.toBeDefined();
    expect(sprintFind).not.toHaveBeenCalled();
  });

  it('bulkUpdate(patch.sprintId đã đóng) => 422, không ghi gì', async () => {
    const tx = {
      issue: {
        findMany: vi.fn(() => Promise.resolve([issueRow({ id: 'a' })])),
        updateMany: vi.fn(),
        findFirstOrThrow: vi.fn(),
      },
      project: { findUnique: vi.fn(() => Promise.resolve({ archivedAt: null })) },
      sprint: { findFirst: closedSprint() },
    };
    const txSpy = vi.fn();
    const { service } = makeService(tx, { $transaction: txSpy });
    await expect(
      service.bulkUpdate('w1', 'u1', {
        projectId: 'p1',
        items: [{ id: 'a', version: 3 }],
        patch: { sprintId: 'sp9' },
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(txSpy).not.toHaveBeenCalled();
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('move / rank (sprintId đã đóng) => 422, không ghi', async () => {
    const tx = wipTx({ count: 0 });
    tx.sprint.findFirst = closedSprint();
    const { service } = makeService(tx);
    await expect(
      service.move('w1', 'u1', 'i1', { version: 3, sprintId: 'sp9' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });
});

/** Prisma giả cho `create`: `statuses` = trạng thái của workflow dự án; `epics` = id → hàng epic. */
/** `statuses`: các trạng thái của workflow dự án (wf); status ngoài danh sách coi như thuộc workflow khác. */
function createTx(
  statuses: Array<{ id: string; category: string; isInitial: boolean }>,
  epics: Record<string, unknown> = {},
) {
  const created = vi.fn((_args: { data: Record<string, unknown> }) =>
    Promise.resolve(issueRow({ statusId: 's9' })),
  );
  const tx = {
    project: {
      findFirst: vi.fn(() =>
        Promise.resolve({
          id: 'p1',
          key: 'P',
          defaultWorkflowId: 'wf',
          leadId: null,
          defaultAssigneeMode: 'NONE',
          archivedAt: null,
        }),
      ),
      update: vi.fn(() => Promise.resolve({ issueSequence: 1 })),
    },
    issueType: {
      findFirst: vi.fn(() => Promise.resolve({ id: 't1' })),
      findUnique: vi.fn(() => Promise.resolve({ key: 'task', name: 'Task' })),
    },
    status: {
      findFirst: vi.fn(
        ({ where }: { where: { id?: string; workflowId: string; isInitial?: boolean } }) =>
          Promise.resolve(
            statuses.find(
              (st) =>
                where.workflowId === 'wf' &&
                (where.id === undefined || where.id === st.id) &&
                (where.isInitial === undefined || where.isInitial === st.isInitial),
            ) ?? null,
          ),
      ),
    },
    priority: { findFirst: vi.fn(() => Promise.resolve(null)) },
    resolution: { findFirst: vi.fn(() => Promise.resolve({ id: 'r-done' })) },
    issue: {
      findFirst: vi.fn(({ where }: { where: { id?: string } }) =>
        Promise.resolve(where.id && where.id in epics ? epics[where.id] : null),
      ),
      count: vi.fn(() => Promise.resolve(0)),
      create: created,
    },
    issueHistory: { create: vi.fn() },
  };
  return { tx, created };
}

const WF_DEFAULT = [{ id: 's1', category: 'TODO', isInitial: true }];
const createTxFor = (epics: Record<string, unknown>) => createTx(WF_DEFAULT, epics);

describe('IssuesService.create — statusId phải thuộc workflow của dự án (I1)', () => {
  const baseInput = {
    projectId: 'p1',
    typeId: 't1',
    summary: 's',
    descriptionFormat: 'MARKDOWN' as const,
  };

  const WF = [
    { id: 's1', category: 'TODO', isInitial: true },
    { id: 's2', category: 'IN_PROGRESS', isInitial: false },
    { id: 's9', category: 'DONE', isInitial: false },
  ];

  it('severityId: kiểm thuộc workspace rồi ghi vào issue; sai workspace => 404, không tạo', async () => {
    const { tx, created } = createTx(WF);
    const severity = { findFirst: vi.fn(() => Promise.resolve({ id: 'sv1' })) };
    const { service } = makeService({ ...tx, severity }, {});
    await service.create('w1', 'u1', { ...baseInput, severityId: 'sv1' });
    expect(severity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sv1', workspaceId: 'w1' } }),
    );
    expect(created.mock.calls[0]![0].data.severityId).toBe('sv1');
    const bad = createTx(WF);
    const other = makeService(
      { ...bad.tx, severity: { findFirst: vi.fn(() => Promise.resolve(null)) } },
      {},
    );
    await expect(
      other.service.create('w1', 'u1', { ...baseInput, severityId: 'x' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(bad.created).not.toHaveBeenCalled();
  });

  it('statusId của workflow khác => 422, không tạo', async () => {
    const { tx, created } = createTx(WF);
    const { service, rbac } = makeService(tx);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:transition']));
    await expect(
      service.create('w1', 'u1', { ...baseInput, statusId: 'ngoai-workflow' }),
    ).rejects.toMatchObject({ status: 422, message: has('không thuộc quy trình') });
    expect(created).not.toHaveBeenCalled();
  });

  it('statusId khác trạng thái khởi tạo mà thiếu issue:transition => 403, không tạo', async () => {
    const { tx, created } = createTx(WF);
    const { service, rbac } = makeService(tx, {
      user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: false })) },
    });
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:create']));
    await expect(
      service.create('w1', 'u1', { ...baseInput, statusId: 's9' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(created).not.toHaveBeenCalled();
  });

  it('có issue:transition + status DONE của workflow => tạo ở DONE và đặt resolvedAt', async () => {
    const { tx, created } = createTx(WF);
    const { service, rbac } = makeService(tx);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:transition']));
    await service.create('w1', 'u1', { ...baseInput, statusId: 's9' });
    const data = created.mock.calls[0]![0].data;
    expect(data.statusId).toBe('s9');
    expect(data.resolvedAt).toBeInstanceOf(Date);
    expect(data.resolutionId).toBe('r-done'); // tạo thẳng ở Done cũng nhận Resolution mặc định
  });

  it('statusId chính là trạng thái khởi tạo => không đòi issue:transition, không resolvedAt', async () => {
    const { tx, created } = createTx(WF);
    const { service, rbac } = makeService(tx);
    await service.create('w1', 'u1', { ...baseInput, statusId: 's1' });
    expect(rbac.getEffectivePermissions).not.toHaveBeenCalled();
    expect(created.mock.calls[0]![0].data.resolvedAt).toBeNull();
  });

  it('intake (báo lỗi chờ duyệt): trạng thái duyệt ghi CÙNG LẦN tạo, trước khi phát ISSUE_CREATED', async () => {
    const { tx, created } = createTx(WF);
    const { service, events } = makeService(tx);
    const lastOccurredAt = new Date('2026-10-16T01:00:00Z');
    await service.create('w1', 'u1', baseInput, undefined, {
      triageState: 'PENDING',
      triageSource: 'BUG',
      occurrenceCount: 1,
      lastOccurredAt,
    });
    expect(created).toHaveBeenCalledTimes(1);
    expect(created.mock.calls[0]![0].data).toMatchObject({
      triageState: 'PENDING',
      triageSource: 'BUG',
      occurrenceCount: 1,
      lastOccurredAt,
    });
    expect(events.emit).toHaveBeenCalledWith('issue.created', expect.anything());
    // Không có intake => không đụng cột duyệt (việc thường không qua Triage).
    const plain = createTx(WF);
    await makeService(plain.tx).service.create('w1', 'u1', baseInput);
    expect(plain.created.mock.calls[0]![0].data).not.toHaveProperty('triageState');
  });

  it('acceptanceCriteria: create ghi văn bản; chuỗi trắng -> null', async () => {
    const a = createTx(WF);
    await makeService(a.tx).service.create('w1', 'u1', {
      ...baseInput,
      acceptanceCriteria: '- [ ] a\n- [ ] b',
    });
    expect(a.created.mock.calls[0]![0].data.acceptanceCriteria).toBe('- [ ] a\n- [ ] b');
    const b = createTx(WF);
    await makeService(b.tx).service.create('w1', 'u1', { ...baseInput, acceptanceCriteria: '  ' });
    expect(b.created.mock.calls[0]![0].data.acceptanceCriteria).toBeNull();
  });

  it('không truyền statusId => dùng trạng thái khởi tạo (hành vi cũ)', async () => {
    const { tx, created } = createTx(WF);
    const { service } = makeService(tx);
    await service.create('w1', 'u1', baseInput);
    expect(created.mock.calls[0]![0].data.statusId).toBe('s1');
  });

  it('createWithin (import) nhận trạng thái bất kỳ của workflow dự án, không đòi issue:transition', async () => {
    const { tx, created } = createTx(WF);
    const { service, rbac } = makeService(tx);
    await service.createWithin(tx as never, 'w1', 'u1', { ...baseInput, statusId: 's2' }, []);
    expect(rbac.getEffectivePermissions).not.toHaveBeenCalled();
    expect(created.mock.calls[0]![0].data.statusId).toBe('s2');
  });
});

describe('IssuesService.createWithin — mã công việc nhập từ Jira (L27)', () => {
  const baseInput = {
    projectId: 'p1',
    typeId: 't1',
    summary: 's',
    descriptionFormat: 'MARKDOWN' as const,
  };
  const WF = [{ id: 's1', category: 'TODO', isInitial: true }];

  it('import + fixedKey: key = mã Jira, number vẫn lấy từ issueSequence, KHÔNG đếm theo loại', async () => {
    const { tx, created } = createTx(WF);
    tx.project.update = vi.fn(() => Promise.resolve({ issueSequence: 7 }));
    const { service } = makeService(tx);
    await service.createWithin(tx as never, 'w1', 'u1', baseInput, [], 'JRA-1');
    const data = created.mock.calls[0]![0].data;
    expect(data.key).toBe('JRA-1');
    expect(data.number).toBe(7);
    expect(tx.project.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { issueSequence: { increment: 1 } } }),
    );
    expect(tx.issue.count).not.toHaveBeenCalled();
  });

  it('không có fixedKey: đếm theo loại CHỈ trong dải mã Tirapro cùng tiền tố (việc nhập không làm lệch số)', async () => {
    const { tx, created } = createTx(WF);
    tx.issue.count = vi.fn(() => Promise.resolve(2));
    const { service } = makeService(tx);
    await service.createWithin(tx as never, 'w1', 'u1', baseInput, []);
    const where = (
      tx.issue.count.mock.calls[0] as unknown as [{ where: Record<string, unknown> }]
    )[0].where;
    expect(where).toMatchObject({
      projectId: 'p1',
      typeId: 't1',
      key: { startsWith: 'P-TASK-' },
    });
    expect(created.mock.calls[0]![0].data.key).toBe('P-TASK-3');
  });

  it('đường API (create) bỏ qua fixedKey: người dùng không tự đặt được mã', async () => {
    const { tx, created } = createTx(WF);
    const { service } = makeService(tx);
    // createCore là private; `create` không có tham số mã ⇒ luôn sinh mã Tirapro.
    await service.create('w1', 'u1', { ...baseInput, key: 'JRA-1' } as never);
    expect(created.mock.calls[0]![0].data.key).toBe('P-TASK-1');
    expect(tx.issue.count).toHaveBeenCalled();
  });

  it('fixedKey sai dạng (mã Tirapro 3 đoạn) bị bỏ qua: rơi về mã Tirapro tự sinh', async () => {
    const { tx, created } = createTx(WF);
    const { service } = makeService(tx);
    await service.createWithin(tx as never, 'w1', 'u1', baseInput, [], 'JRA-STORY-1');
    expect(created.mock.calls[0]![0].data.key).toBe('P-TASK-1');
  });
});

describe('IssuesService — epicId được lưu và hợp lệ (FW11 + review)', () => {
  const epicRow = (over: Record<string, unknown> = {}) => ({
    projectId: 'p1',
    epicId: null,
    type: { key: 'EPIC', hierarchyLevel: 1 },
    ...over,
  });

  /** `epics`: id → hàng epic (cho truy vấn kiểm epic); mọi truy vấn khác trả `current`. */
  function epicTx(
    current: Record<string, unknown>,
    after: Record<string, unknown>,
    epics: Record<string, unknown> = {},
  ) {
    return {
      issue: {
        findFirst: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id in epics ? epics[where.id] : where.id === 'i1' ? current : null),
        ),
        updateMany: vi.fn((_args: { data: Record<string, unknown> }) =>
          Promise.resolve({ count: 1 }),
        ),
        findFirstOrThrow: vi.fn(() => Promise.resolve(after)),
      },
      issueHistory: { createMany: vi.fn() },
    };
  }

  it('PATCH { epicId } ghi epicId vào DB và phát ISSUE_UPDATED với changedFields chứa epicId', async () => {
    const tx = epicTx(issueRow(), issueRow({ epicId: 'e1', version: 4 }), { e1: epicRow() });
    const { service, events } = makeService(tx);
    const dto = await service.update('w1', 'u1', 'i1', { version: 3, epicId: 'e1' });
    expect(tx.issue.updateMany.mock.calls[0]![0].data).toMatchObject({ epicId: 'e1' });
    expect(dto.epicId).toBe('e1');
    expect(events.emit).toHaveBeenCalledWith(
      DOMAIN_EVENTS.ISSUE_UPDATED,
      expect.objectContaining({ changedFields: ['epicId'] }),
    );
  });

  it('PATCH { epicId: null } gỡ epic (không tra epic)', async () => {
    const tx = epicTx(issueRow({ epicId: 'e1' }), issueRow({ epicId: null, version: 4 }));
    const { service } = makeService(tx);
    await service.update('w1', 'u1', 'i1', { version: 3, epicId: null });
    expect(tx.issue.updateMany.mock.calls[0]![0].data).toMatchObject({ epicId: null });
  });

  it('không gửi epicId, hoặc gửi lại epic hiện tại => không đụng epicId, không tra epic', async () => {
    const tx = epicTx(issueRow({ epicId: 'e1' }), issueRow({ epicId: 'e1', version: 4 }));
    const { service } = makeService(tx);
    await service.update('w1', 'u1', 'i1', { version: 3, summary: 'mới' });
    expect(tx.issue.updateMany.mock.calls[0]![0].data).not.toHaveProperty('epicId');
    await service.update('w1', 'u1', 'i1', { version: 3, epicId: 'e1' });
    expect(tx.issue.findFirst.mock.calls.every((c) => c[0].where.id === 'i1')).toBe(true);
  });

  it.each([
    ['chính issue này', 'i1', {}, 422],
    ['không tồn tại / ngoài workspace', 'ghost', {}, 404],
    [
      'khác dự án',
      'e1',
      { e1: { projectId: 'p2', epicId: null, type: { key: 'EPIC', hierarchyLevel: 1 } } },
      422,
    ],
    [
      'không phải loại Epic',
      'e1',
      { e1: { projectId: 'p1', epicId: null, type: { key: 'TASK', hierarchyLevel: 0 } } },
      422,
    ],
    [
      'tạo vòng trực tiếp (epic đang trỏ về issue)',
      'e1',
      { e1: { projectId: 'p1', epicId: 'i1', type: { key: 'EPIC', hierarchyLevel: 1 } } },
      422,
    ],
    [
      'tạo vòng gián tiếp (e1 → e2 → i1)',
      'e1',
      {
        e1: { projectId: 'p1', epicId: 'e2', type: { key: 'EPIC', hierarchyLevel: 1 } },
        e2: { projectId: 'p1', epicId: 'i1', type: { key: 'EPIC', hierarchyLevel: 1 } },
      },
      422,
    ],
  ])('update: epic %s => lỗi, không ghi', async (_n, epicId, epics, status) => {
    const tx = epicTx(issueRow(), issueRow(), epics);
    const { service } = makeService(tx);
    await expect(service.update('w1', 'u1', 'i1', { version: 3, epicId })).rejects.toMatchObject({
      status,
    });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('epic hợp lệ theo hierarchyLevel >= 1 (loại tuỳ chỉnh) cũng được', async () => {
    const tx = epicTx(issueRow(), issueRow({ epicId: 'e1', version: 4 }), {
      e1: epicRow({ type: { key: null, hierarchyLevel: 2 } }),
    });
    const { service } = makeService(tx);
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, epicId: 'e1' }),
    ).resolves.toBeDefined();
  });

  it('create: epic khác dự án / không phải Epic => 422, không tạo', async () => {
    for (const epic of [
      epicRow({ projectId: 'p2' }),
      epicRow({ type: { key: 'TASK', hierarchyLevel: 0 } }),
    ]) {
      const { tx, created } = createTxFor({ e1: epic });
      const { service } = makeService(tx);
      await expect(
        service.create('w1', 'u1', {
          projectId: 'p1',
          typeId: 't1',
          summary: 's',
          descriptionFormat: 'MARKDOWN',
          epicId: 'e1',
        }),
      ).rejects.toMatchObject({ status: 422 });
      expect(created).not.toHaveBeenCalled();
    }
  });

  it('create: epic hợp lệ => tạo với epicId', async () => {
    const { tx, created } = createTxFor({ e1: epicRow() });
    const { service } = makeService(tx);
    await service.create('w1', 'u1', {
      projectId: 'p1',
      typeId: 't1',
      summary: 's',
      descriptionFormat: 'MARKDOWN',
      epicId: 'e1',
    });
    expect(created.mock.calls[0]![0].data.epicId).toBe('e1');
  });
});

describe('IssuesService — Epic không có epicId (không epic lồng epic)', () => {
  const epicRow = () => ({
    projectId: 'p1',
    epicId: null,
    type: { key: 'EPIC', hierarchyLevel: 1 },
  });

  function epicTx(current: Record<string, unknown>) {
    return {
      issue: {
        findFirst: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === 'e1' ? epicRow() : where.id === 'i1' ? current : null),
        ),
        updateMany: vi.fn((_args: { data: Record<string, unknown> }) =>
          Promise.resolve({ count: 1 }),
        ),
        findFirstOrThrow: vi.fn(() => Promise.resolve(current)),
      },
      issueHistory: { createMany: vi.fn() },
    };
  }

  it('create: chính việc là Epic mà có epicId => 422, không tạo (không epic lồng epic)', async () => {
    const { tx, created } = createTxFor({ e1: epicRow() });
    tx.issueType.findFirst = vi.fn(() =>
      Promise.resolve({ id: 't-epic', key: 'EPIC', hierarchyLevel: 1 }),
    );
    const { service } = makeService(tx);
    await expect(
      service.create('w1', 'u1', {
        projectId: 'p1',
        typeId: 't-epic',
        summary: 's',
        descriptionFormat: 'MARKDOWN',
        epicId: 'e1',
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(created).not.toHaveBeenCalled();
  });

  it('update: việc là Epic mà gắn epicId => 422, không ghi; gỡ epicId (null) vẫn được', async () => {
    const epicIssue = issueRow({ type: { ...issueRow().type, key: 'EPIC', hierarchyLevel: 1 } });
    const tx = epicTx(epicIssue);
    const { service } = makeService(tx);
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, epicId: 'e1' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, epicId: null }),
    ).resolves.toBeDefined();
  });
});

describe('IssuesService — :own (issue:edit:own)', () => {
  function ownTx(row: Record<string, unknown>) {
    return {
      issue: {
        findFirst: vi.fn(() => Promise.resolve(row)),
        findFirstOrThrow: vi.fn(() => Promise.resolve({ ...row, version: 4, summary: 'mới' })),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      },
      issueHistory: { createMany: vi.fn(), create: vi.fn() },
    };
  }

  it('update(ownOnly) trên việc của người khác -> 403, chưa ghi gì, không emit', async () => {
    const tx = ownTx(issueRow({ reporterId: 'u1', createdById: 'u1', assigneeId: null }));
    const { service, events } = makeService(tx);
    await expect(
      service.update('w1', 'u9', 'i1', { version: 3, summary: 'x' }, undefined, true),
    ).rejects.toMatchObject({ status: 403 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it.each([
    ['reporter', { reporterId: 'u9', createdById: 'u1', assigneeId: null }],
    ['assignee', { reporterId: 'u1', createdById: 'u1', assigneeId: 'u9' }],
    ['createdBy', { reporterId: 'u1', createdById: 'u9', assigneeId: null }],
  ])('update(ownOnly) cho phép khi user là %s', async (_name, over) => {
    const tx = ownTx(issueRow(over));
    const { service } = makeService(tx);
    await expect(
      service.update('w1', 'u9', 'i1', { version: 3, summary: 'mới' }, undefined, true),
    ).resolves.toMatchObject({ summary: 'mới' });
    expect(tx.issue.updateMany).toHaveBeenCalledTimes(1);
  });

  it('DTO trả createdById (web dùng để hiện nút sửa theo issue:edit:own)', async () => {
    const tx = ownTx(issueRow({ reporterId: 'u1', createdById: 'u9', assigneeId: null }));
    const { service } = makeService(tx);
    await expect(
      service.update('w1', 'u9', 'i1', { version: 3, summary: 'mới' }, undefined, true),
    ).resolves.toMatchObject({ createdById: 'u9', reporterId: 'u1' });
  });

  it('transition(ownOnly) trên việc của người khác -> 403, chưa ghi gì, không emit', async () => {
    const tx = ownTx(issueRow({ reporterId: 'u1', createdById: 'u1', assigneeId: null }));
    const { service, events } = makeService(tx);
    await expect(
      service.transition('w1', 'u9', 'i1', { version: 3, toStatusId: 's2' }, undefined, true),
    ).rejects.toMatchObject({ status: 403 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('move(ownOnly) trên việc của người khác -> 403; của mình -> qua', async () => {
    const tx = ownTx(issueRow({ reporterId: 'u1', createdById: 'u1', assigneeId: null }));
    const { service } = makeService(tx);
    await expect(service.move('w1', 'u9', 'i1', { version: 3 }, true)).rejects.toMatchObject({
      status: 403,
    });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    await expect(service.move('w1', 'u1', 'i1', { version: 3 }, true)).resolves.toBeDefined();
  });

  it('bulkUpdate chỉ có issue:transition:own + việc của người khác -> 403 cả lô, chưa ghi', async () => {
    const tx = {
      issue: {
        findMany: vi.fn(() =>
          Promise.resolve([issueRow({ id: 'a', reporterId: 'u1', createdById: 'u1' })]),
        ),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
        findFirstOrThrow: vi.fn(),
      },
      issueHistory: { createMany: vi.fn(), create: vi.fn() },
      project: {
        findUnique: vi.fn(() => Promise.resolve({ archivedAt: null, defaultWorkflowId: 'wf' })),
      },
      user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: false })) },
    };
    const { service, rbac } = makeService(tx);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:transition:own']));
    await expect(
      service.bulkUpdate('w1', 'u9', {
        projectId: 'p1',
        items: [{ id: 'a', version: 3 }],
        patch: { statusId: 's2' },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('update không ownOnly (quyền issue:edit đầy đủ) vẫn sửa được việc của người khác', async () => {
    const tx = ownTx(issueRow({ reporterId: 'u1', createdById: 'u1', assigneeId: null }));
    const { service } = makeService(tx);
    await expect(
      service.update('w1', 'u9', 'i1', { version: 3, summary: 'mới' }),
    ).resolves.toBeDefined();
  });

  it('bulkUpdate(ownOnly): một việc của người khác -> 403 cả lô, không ghi việc nào', async () => {
    const tx = {
      issue: {
        findMany: vi.fn(() =>
          Promise.resolve([issueRow({ id: 'a', assigneeId: 'u9' }), issueRow({ id: 'b' })]),
        ),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
        findFirstOrThrow: vi.fn(),
      },
      issueHistory: { createMany: vi.fn(), create: vi.fn() },
      project: { findUnique: vi.fn(() => Promise.resolve({ archivedAt: null })) },
    };
    const { service, events } = makeService(tx);
    const items = [
      { id: 'a', version: 3 },
      { id: 'b', version: 3 },
    ];
    await expect(
      service.bulkUpdate('w1', 'u9', { projectId: 'p1', items, patch: { assigneeId: 'u2' } }, true),
    ).rejects.toMatchObject({ status: 403 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('bulkUpdate(ownOnly): toàn việc của mình -> ghi bình thường', async () => {
    const tx = {
      issue: {
        findMany: vi.fn(() =>
          Promise.resolve([
            issueRow({ id: 'a', assigneeId: 'u9' }),
            issueRow({ id: 'b', reporterId: 'u9' }),
          ]),
        ),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
        findFirstOrThrow: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(issueRow({ id: where.id, version: 4, assigneeId: 'u2' })),
        ),
      },
      issueHistory: { createMany: vi.fn(), create: vi.fn() },
      project: { findUnique: vi.fn(() => Promise.resolve({ archivedAt: null })) },
    };
    const { service } = makeService(tx);
    const items = [
      { id: 'a', version: 3 },
      { id: 'b', version: 3 },
    ];
    const res = await service.bulkUpdate(
      'w1',
      'u9',
      { projectId: 'p1', items, patch: { assigneeId: 'u2' } },
      true,
    );
    expect(res.updated).toHaveLength(2);
  });
});

describe('IssuesService.bulkUpdate — :own trên tập lẫn', () => {
  it('bulkUpdate(statusId) chỉ có issue:transition:own trên tập LẪN (của mình + của người khác) -> 403 cả lô, không ghi việc nào', async () => {
    const tx = {
      issue: {
        findMany: vi.fn(() =>
          Promise.resolve([
            issueRow({ id: 'a', reporterId: 'u9', createdById: 'u9' }), // của u9
            issueRow({ id: 'b', reporterId: 'u1', createdById: 'u1' }), // của người khác
          ]),
        ),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
        findFirstOrThrow: vi.fn(),
      },
      issueHistory: { createMany: vi.fn(), create: vi.fn() },
      project: {
        findUnique: vi.fn(() => Promise.resolve({ archivedAt: null, defaultWorkflowId: 'wf' })),
      },
      workflowTransition: { findFirst: vi.fn(() => Promise.resolve({ id: 'tr' })) },
      status: { findUnique: vi.fn(() => Promise.resolve({ category: 'IN_PROGRESS' })) },
      user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: false })) },
    };
    const txSpy = vi.fn();
    const { service, rbac, events } = makeService(tx, { $transaction: txSpy });
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:transition:own']));
    await expect(
      service.bulkUpdate('w1', 'u9', {
        projectId: 'p1',
        items: [
          { id: 'a', version: 3 },
          { id: 'b', version: 3 },
        ],
        patch: { statusId: 's2' },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(tx.issueHistory.create).not.toHaveBeenCalled();
    expect(txSpy).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });
});

describe('IssuesService — assignee không đổi / tài khoản vô hiệu hoá', () => {
  const noMember = () => ({
    workspaceMembership: { findFirst: vi.fn(() => Promise.resolve(null)) },
  });

  it('update gửi lại assigneeId cũ (người đã rời workspace) => KHÔNG kiểm thành viên, không 422', async () => {
    const tx = {
      issue: {
        findFirst: vi.fn(() => Promise.resolve(issueRow({ assigneeId: 'gone' }))),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
        findFirstOrThrow: vi.fn(() =>
          Promise.resolve(issueRow({ version: 4, assigneeId: 'gone' })),
        ),
      },
      issueHistory: { createMany: vi.fn() },
    };
    const extra = noMember();
    const { service } = makeService(tx, extra);
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, summary: 'mới', assigneeId: 'gone' }),
    ).resolves.toBeDefined();
    expect(extra.workspaceMembership.findFirst).not.toHaveBeenCalled();
  });

  it('gán MỚI cho tài khoản DEACTIVATED => điều kiện where loại DEACTIVATED, 422 khi không khớp', async () => {
    const tx = {
      issue: {
        findFirst: vi.fn(() => Promise.resolve(issueRow())),
        updateMany: vi.fn(),
        findFirstOrThrow: vi.fn(),
      },
      issueHistory: { createMany: vi.fn() },
    };
    const extra = noMember(); // thành viên có user DEACTIVATED không khớp where → findFirst trả null
    const { service } = makeService(tx, extra);
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, assigneeId: 'off' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(extra.workspaceMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'w1', userId: 'off', user: { status: { not: 'DEACTIVATED' } } },
      }),
    );
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('bulkUpdate: mọi hàng đã giữ assignee đó => bỏ qua kiểm; có hàng đổi => kiểm và 422', async () => {
    const mk = (rows: Array<Record<string, unknown>>) => ({
      issue: {
        findMany: vi.fn(() => Promise.resolve(rows)),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
        findFirstOrThrow: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(issueRow({ id: where.id, version: 4, assigneeId: 'gone' })),
        ),
      },
      issueHistory: { createMany: vi.fn(), create: vi.fn() },
      project: { findUnique: vi.fn(() => Promise.resolve({ archivedAt: null })) },
    });
    const input = {
      projectId: 'p1',
      items: [{ id: 'a', version: 3 }],
      patch: { assigneeId: 'gone' },
    };
    const same = noMember();
    await makeService(mk([issueRow({ id: 'a', assigneeId: 'gone' })]), same).service.bulkUpdate(
      'w1',
      'u1',
      input,
    );
    expect(same.workspaceMembership.findFirst).not.toHaveBeenCalled();

    const diff = mk([issueRow({ id: 'a', assigneeId: null })]);
    await expect(
      makeService(diff, noMember()).service.bulkUpdate('w1', 'u1', input),
    ).rejects.toMatchObject({ status: 422 });
    expect(diff.issue.updateMany).not.toHaveBeenCalled();
  });
});

describe('IssuesService — dự án đã xoá mềm', () => {
  const projectFilter = { project: { deletedAt: null } };

  it('getByKey: lọc project.deletedAt:null; không thấy => 404', async () => {
    const findFirst = vi.fn(() => Promise.resolve(null));
    const { service } = makeService({ issue: { findFirst } });
    await expect(service.getByKey('w1', 'P-TASK-1', null)).rejects.toMatchObject({ status: 404 });
    expect((findFirst.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toMatchObject({
      workspaceId: 'w1',
      key: 'P-TASK-1',
      deletedAt: null,
      ...projectFilter,
    });
  });

  it('list (không projectId): lọc project.deletedAt:null', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const { service } = makeService({ issue: { findMany } });
    await service.list('w1', {}, undefined, 50, null);
    expect((findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toMatchObject({
      workspaceId: 'w1',
      deletedAt: null,
      ...projectFilter,
    });
  });

  it('list: ẩn việc chưa duyệt (PENDING/SNOOZED/DECLINED) khỏi Board/Việc chờ — chỉ lấy triageState null hoặc ACCEPTED', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const { service } = makeService({ issue: { findMany } });
    await service.list('w1', { projectId: 'p1' }, undefined, 50, null);
    expect((findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toMatchObject({
      OR: [{ triageState: null }, { triageState: 'ACCEPTED' }],
    });
  });

  it('list: không trả văn bản tiêu chí (chỉ acceptanceProgress); getByKey trả đủ', async () => {
    const row = issueRow({ acceptanceCriteria: '- [x] a\n- [ ] b' });
    const { service } = makeService({
      issue: {
        findMany: vi.fn(() => Promise.resolve([row])),
        findFirst: vi.fn(() => Promise.resolve(row)),
      },
    });
    const page = await service.list('w1', {}, undefined, 50, null);
    expect(page.data[0]).not.toHaveProperty('acceptanceCriteria');
    expect(page.data[0]!.acceptanceProgress).toEqual({ done: 1, total: 2 });
    const detail = await service.getByKey('w1', 'P-TASK-1', null);
    expect(detail.acceptanceCriteria).toBe('- [x] a\n- [ ] b');
  });

  it('list với search: escape % _ \\ (không để "_" khớp mọi dòng)', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const { service } = makeService({ issue: { findMany } });
    await service.list('w1', { search: '_' }, undefined, 50, null);
    await service.list('w1', { search: '50%\\' }, undefined, 50, null);
    const wheres = (
      findMany.mock.calls as unknown as Array<[{ where: Record<string, unknown> }]>
    ).map((c) => c[0].where.summary);
    expect(wheres[0]).toEqual({ contains: '\\_', mode: 'insensitive' });
    expect(wheres[1]).toEqual({ contains: '50\\%\\\\', mode: 'insensitive' });
  });

  it('query (JQL/search) và query theo rawIds (full-text) đều ghép project.deletedAt:null vào scope', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const { service } = makeService({ issue: { findMany } });
    await service.query('w1', {}, [], undefined, 10, null);
    await service.query('w1', {}, [], undefined, 10, null, { rawIds: ['a'] });
    await service.query('w1', {}, [{ updatedAt: 'desc' }], undefined, 10, null, { rawIds: ['a'] });
    expect(findMany).toHaveBeenCalledTimes(3);
    for (const call of findMany.mock.calls as unknown as Array<[{ where: unknown }]>) {
      expect(JSON.stringify(call[0].where)).toContain('"project":{"deletedAt":null}');
    }
  });
});

describe('IssuesService.bulkUpdate — đổi status cùng field khác', () => {
  const stage2 = {
    id: 's2',
    workflowId: 'wf',
    name: 'Doing',
    category: 'IN_PROGRESS',
    color: null,
    order: 1,
    isInitial: false,
  };
  function tx2(afterOver: Record<string, unknown>) {
    const rows = [issueRow({ id: 'a' })];
    return {
      issue: {
        findMany: vi.fn(() => Promise.resolve(rows)),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
        findFirst: vi.fn(() => Promise.resolve({ version: 5 })),
        findFirstOrThrow: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(issueRow({ id: where.id, version: 4, ...afterOver })),
        ),
      },
      issueHistory: { createMany: vi.fn(), create: vi.fn() },
      project: { findUnique: vi.fn(() => Promise.resolve({ defaultWorkflowId: 'wf' })) },
      workflowTransition: { findFirst: vi.fn(() => Promise.resolve({ id: 'tr' })) },
      status: { findUnique: vi.fn(() => Promise.resolve({ category: 'IN_PROGRESS' })) },
    };
  }

  it('đổi cả status lẫn assignee => TRANSITIONED + thêm ISSUE_UPDATED mang changedFields ["assigneeId"]', async () => {
    const tx = tx2({ statusId: 's2', status: stage2, assigneeId: 'u2' });
    const { service, events, rbac } = makeService(tx);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:transition']));
    await service.bulkUpdate('w1', 'u1', {
      projectId: 'p1',
      items: [{ id: 'a', version: 3 }],
      patch: { statusId: 's2', assigneeId: 'u2' },
    });
    expect(events.emit.mock.calls.map((c) => c[0] as string)).toEqual([
      'issue.transitioned',
      'issue.updated',
      'issue.bulk_updated',
    ]);
    expect(events.emit).toHaveBeenCalledWith(
      'issue.updated',
      expect.objectContaining({ changedFields: ['assigneeId'], actorId: 'u1' }),
    );
  });

  it('chỉ đổi status => chỉ TRANSITIONED, không ISSUE_UPDATED thừa', async () => {
    const tx = tx2({ statusId: 's2', status: stage2 });
    const { service, events, rbac } = makeService(tx);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:transition']));
    await service.bulkUpdate('w1', 'u1', {
      projectId: 'p1',
      items: [{ id: 'a', version: 3 }],
      patch: { statusId: 's2' },
    });
    expect(events.emit.mock.calls.map((c) => c[0] as string)).toEqual(['issue.transitioned']);
  });
});

describe('IssuesService.move — neighbor cũ (409) vs hết chỗ (rebalance)', () => {
  /** tx tối thiểu cho move(): `ranks[id] = [trước, sau rebalance]`. */
  function makeTx(ranks: Record<string, [string, string]>) {
    let rebalanced = false;
    let movedRank: unknown;
    const tx = {
      issue: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
          await Promise.resolve();
          if (where.id === 'i1') return issueRow();
          const r = ranks[where.id];
          return r ? { rank: rebalanced ? r[1] : r[0] } : null;
        }),
        findMany: vi.fn(() => Promise.resolve([{ id: 'a' }, { id: 'i1' }, { id: 'b' }])),
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          await Promise.resolve();
          movedRank = data.rank;
          return { count: 1 };
        }),
        findFirstOrThrow: vi.fn(() => Promise.resolve(issueRow({ rank: movedRank, version: 4 }))),
      },
      project: {
        update: vi.fn(async () => {
          await Promise.resolve();
          rebalanced = true;
          return { id: 'p1' };
        }),
      },
      $executeRaw: vi.fn(() => Promise.resolve(3)),
    };
    return tx;
  }

  it('hai mốc bị đảo thứ tự (client cũ) => 409 RANK_NEIGHBORS_STALE, KHÔNG rebalance, không ghi', async () => {
    const tx = makeTx({ a: ['r', 'r'], b: ['i', 'i'] }); // after=a(r) nhưng before=b(i) ⇒ prev > next
    const { service, events } = makeService(tx);
    await expect(
      service.move('w1', 'u1', 'i1', { version: 3, afterId: 'a', beforeId: 'b' }),
    ).rejects.toMatchObject({ status: 409, code: 'RANK_NEIGHBORS_STALE' });
    expect(tx.project.update).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it("hai mốc trùng rank ('n','n') => vẫn là cạn chỗ: rebalance rồi tính lại", async () => {
    const tx = makeTx({ a: ['n', 'i'], b: ['n', 'r'] });
    const { service, events } = makeService(tx);
    const dto = await service.move('w1', 'u1', 'i1', { version: 3, afterId: 'a', beforeId: 'b' });
    expect(tx.project.update).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(dto.rank > 'i' && dto.rank < 'r').toBe(true);
    expect(events.emit).toHaveBeenCalledWith(DOMAIN_EVENTS.PROJECT_RANKS_REBALANCED, {
      projectId: 'p1',
    });
  });

  it('sau rebalance hai mốc vẫn đảo (người khác vừa kéo) => 409 thay vì 422', async () => {
    const tx = makeTx({ a: ['n', 'r'], b: ['n', 'i'] });
    const { service } = makeService(tx);
    await expect(
      service.move('w1', 'u1', 'i1', { version: 3, afterId: 'a', beforeId: 'b' }),
    ).rejects.toMatchObject({ status: 409, code: 'RANK_NEIGHBORS_STALE' });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });
});

describe('IssuesService.query — ORDER BY severity DESC đẩy việc chưa đặt mức xuống cuối', () => {
  type Arg = { where: { AND: unknown[] }; cursor?: { id: string }; skip?: number; take?: number };
  const row = (id: string) => issueRow({ id });
  const desc = [{ severity: { rank: 'desc' as const } }];
  function svc(withSev: string[], unset: string[], cursorSeverityId: string | null = 'sv') {
    const findMany = vi.fn((a: Arg) =>
      Promise.resolve(
        (JSON.stringify(a.where).includes('"severityId":null') ? unset : withSev).map(row),
      ),
    );
    const findFirst = vi.fn(() => Promise.resolve({ severityId: cursorSeverityId }));
    return { findMany, findFirst, ...makeService({ issue: { findMany, findFirst } }) };
  }
  it('trang 1: việc có mức trước, bù bằng việc chưa đặt mức; hai truy vấn lọc đúng severityId', async () => {
    const { service, findMany } = svc(['a', 'b'], ['x', 'y']);
    const page = await service.query('w1', {}, desc, undefined, 3, null);
    expect(page.data.map((i) => i.id)).toEqual(['a', 'b', 'x']);
    expect(JSON.stringify(findMany.mock.calls[0]![0].where)).toContain('"severityId":{"not":null}');
    expect(findMany.mock.calls[1]![0].take).toBe(2); // limit + 1 - số đã có
  });
  it('đủ trang từ pha có mức => không truy vấn pha chưa đặt mức', async () => {
    const { service, findMany } = svc(['a', 'b', 'c'], ['x']);
    await service.query('w1', {}, desc, undefined, 2, null);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
  it('con trỏ nằm ở pha chưa đặt mức => bỏ pha có mức, cursor+skip ở pha chưa đặt', async () => {
    const { service, findMany } = svc(['a'], ['y', 'z'], null);
    const page = await service.query('w1', {}, desc, 'x', 2, null);
    expect(page.data.map((i) => i.id)).toEqual(['y', 'z']);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]![0]).toMatchObject({ cursor: { id: 'x' }, skip: 1 });
  });
  it('con trỏ không còn => trang rỗng (không quay lại trang đầu)', async () => {
    const { service, findFirst } = svc(['a'], ['x']);
    findFirst.mockResolvedValueOnce(null as never);
    const page = await service.query('w1', {}, desc, 'gone', 2, null);
    expect(page.data).toEqual([]);
  });
  it('ASC giữ nguyên một truy vấn (Postgres đã đặt NULL cuối)', async () => {
    const { service, findMany } = svc(['a'], []);
    await service.query('w1', {}, [{ severity: { rank: 'asc' } }], undefined, 2, null);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

describe('IssuesService.query — rankHint (id khớp FTS lên trước, phần còn lại theo updatedAt)', () => {
  const row = (id: string) => issueRow({ id });
  type FindManyArg = { where: unknown; cursor?: { id: string }; skip?: number; take?: number };
  function svc(rankedRows: string[], restRows: string[]) {
    const findMany = vi.fn(({ where }: FindManyArg) => {
      const isRanked = JSON.stringify(where).includes('"in"');
      return Promise.resolve((isRanked ? rankedRows : restRows).map(row));
    });
    return { findMany, ...makeService({ issue: { findMany } }) };
  }

  it('trang 1: id xếp hạng theo thứ tự rank rồi bù bằng phần còn lại', async () => {
    const { service } = svc(['b', 'a'], ['x', 'y']); // DB trả ranked không theo thứ tự rank
    const page = await service.query('w1', {}, [], undefined, 3, null, { rankHint: ['a', 'b'] });
    expect(page.data.map((i) => i.id)).toEqual(['a', 'b', 'x']);
  });

  it('cursor nằm trong phần xếp hạng => tiếp tục sau nó rồi chuyển sang phần còn lại', async () => {
    const { service } = svc(['b', 'a'], ['x', 'y']);
    const page = await service.query('w1', {}, [], 'a', 2, null, { rankHint: ['a', 'b'] });
    expect(page.data.map((i) => i.id)).toEqual(['b', 'x']);
  });

  it('cursor nằm ở phần còn lại => Prisma cursor+skip cho phần còn lại, không lặp phần xếp hạng', async () => {
    const { service, findMany } = svc(['b', 'a'], ['y', 'z']);
    const page = await service.query('w1', {}, [], 'x', 2, null, { rankHint: ['a', 'b'] });
    expect(page.data.map((i) => i.id)).toEqual(['y', 'z']);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]![0]).toMatchObject({ cursor: { id: 'x' }, skip: 1 });
  });

  it('phần xếp hạng lọc theo scope (workspace, chưa xoá, dự án còn sống)', async () => {
    const { service, findMany } = svc(['a'], []);
    await service.query('w1', {}, [], undefined, 5, null, { rankHint: ['a'] });
    const json = JSON.stringify(findMany.mock.calls[0]![0]);
    expect(json).toContain('"workspaceId":"w1"');
    expect(json).toContain('"deletedAt":null');
    expect(json).toContain('"project":{"deletedAt":null}');
  });

  it('có orderBy tường minh => bỏ qua rankHint (đường queryOrdered)', async () => {
    const { service, findMany } = svc(['a'], ['x']);
    await service.query('w1', {}, [{ createdAt: 'desc' }], undefined, 5, null, { rankHint: ['a'] });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(findMany.mock.calls[0]![0])).not.toContain('notIn');
  });
});

describe('IssuesService.move — không mốc giữ rank; đổi sprint ghi lịch sử', () => {
  const emitted = (events: { emit: ReturnType<typeof vi.fn> }) =>
    events.emit.mock.calls.map((c) => c[0] as string);

  it('không afterId/beforeId => KHÔNG tra mốc, KHÔNG rebalance, giữ rank hiện tại', async () => {
    const tx = wipTx({ count: 0 });
    tx.issue.findFirstOrThrow = vi.fn(() => Promise.resolve(issueRow({ version: 4 })));
    const { service } = makeService(tx);
    await service.move('w1', 'u1', 'i1', { version: 3, statusId: 's1' });
    const data = (
      tx.issue.updateMany.mock.calls[0] as unknown as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(data.rank).toBe('n'); // rank của issueRow()
    expect(tx.issue.findMany).not.toHaveBeenCalled(); // không rebalance
  });

  it('đổi sprintId => ghi IssueHistory SPRINT (cũ → mới) trong transaction và phát ISSUE_UPDATED{changedFields:[sprintId]} sau ISSUE_MOVED', async () => {
    const tx = wipTx({ count: 0 });
    tx.issue.findFirstOrThrow = vi.fn(() =>
      Promise.resolve(issueRow({ version: 4, sprintId: 'sp2' })),
    );
    const { service, events } = makeService(tx);
    await service.move('w1', 'u1', 'i1', { version: 3, sprintId: 'sp2' });
    const rows = (
      tx.issueHistory.createMany.mock.calls[0] as unknown as [
        { data: Array<Record<string, unknown>> },
      ]
    )[0].data;
    expect(rows).toEqual([
      expect.objectContaining({ field: 'SPRINT', oldValue: null, newValue: 'sp2', actorId: 'u1' }),
    ]);
    expect(emitted(events)).toEqual([DOMAIN_EVENTS.ISSUE_MOVED, DOMAIN_EVENTS.ISSUE_UPDATED]);
    expect(events.emit).toHaveBeenLastCalledWith(
      DOMAIN_EVENTS.ISSUE_UPDATED,
      expect.objectContaining({ actorId: 'u1', changedFields: ['sprintId'] }),
    );
  });

  it('sprintId không đổi (undefined hoặc bằng hiện tại) => không ghi history SPRINT, không phát ISSUE_UPDATED', async () => {
    const tx = wipTx({ count: 0 });
    tx.issue.findFirstOrThrow = vi.fn(() => Promise.resolve(issueRow({ version: 4 })));
    const { service, events } = makeService(tx);
    await service.move('w1', 'u1', 'i1', { version: 3, afterId: 'a' });
    expect(tx.issueHistory.createMany).not.toHaveBeenCalled();
    expect(emitted(events)).toEqual([DOMAIN_EVENTS.ISSUE_MOVED]);
  });
});

describe('IssuesService.move — ma trận quyền sprint/rank (I4)', () => {
  const rankOf = (tx: ReturnType<typeof wipTx>) =>
    (tx.issue.updateMany.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data
      .rank;

  function setup(
    perms: string[],
    opts: { sysAdmin?: boolean; issue?: Record<string, unknown> } = {},
  ) {
    const tx = wipTx({ count: 0, issue: opts.issue });
    tx.issue.findFirstOrThrow = vi.fn(() => Promise.resolve(issueRow({ version: 4 })));
    const made = makeService(tx, {
      user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: !!opts.sysAdmin })) },
    });
    made.rbac.getEffectivePermissions.mockResolvedValue(new Set(perms));
    return { tx, ...made };
  }

  it('role chỉ có issue:transition đổi sprintId => 403, không ghi', async () => {
    const { tx, service } = setup(['issue:transition']);
    await expect(
      service.move('w1', 'u1', 'i1', { version: 3, sprintId: 'sp2' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('issue:edit đổi sprintId => được; sprintId không đổi thì không đòi quyền sửa', async () => {
    const ok = setup(['issue:edit']);
    await expect(
      ok.service.move('w1', 'u1', 'i1', { version: 3, sprintId: 'sp2' }),
    ).resolves.toBeDefined();
    const same = setup(['issue:transition']);
    await expect(
      same.service.move('w1', 'u1', 'i1', { version: 3, sprintId: null, statusId: 's2' }),
    ).resolves.toBeDefined(); // sprintId hiện tại là null => không đổi
  });

  it('chỉ issue:edit:own: đổi sprint việc của mình được, việc người khác 403', async () => {
    const mine = setup(['issue:edit:own'], { issue: { reporterId: 'u1' } });
    await expect(
      mine.service.move('w1', 'u1', 'i1', { version: 3, sprintId: 'sp2' }),
    ).resolves.toBeDefined();
    const other = setup(['issue:edit:own'], {
      issue: { reporterId: 'x', assigneeId: 'x', createdById: 'x' },
    });
    await expect(
      other.service.move('w1', 'u1', 'i1', { version: 3, sprintId: 'sp2' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('system admin đổi sprint được dù không có quyền dự án', async () => {
    const { service } = setup([], { sysAdmin: true });
    await expect(
      service.move('w1', 'u1', 'i1', { version: 3, sprintId: 'sp2' }),
    ).resolves.toBeDefined();
  });

  it('thiếu issue:edit/backlog:manage + mốc rank + KHÔNG đổi status => 403', async () => {
    const { tx, service } = setup(['issue:transition']);
    await expect(
      service.move('w1', 'u1', 'i1', { version: 3, afterId: 'a' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('thiếu quyền xếp + mốc rank + CÓ đổi status => bỏ qua mốc (giữ rank), vẫn chuyển trạng thái', async () => {
    const { tx, service } = setup(['issue:transition']);
    await service.move('w1', 'u1', 'i1', {
      version: 3,
      afterId: 'a',
      beforeId: 'b',
      statusId: 's2',
    });
    expect(rankOf(tx)).toBe('n'); // rank cũ
    const data = (
      tx.issue.updateMany.mock.calls[0] as unknown as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(data.statusId).toBe('s2');
    expect(tx.issue.findFirst).toHaveBeenCalledTimes(1); // chỉ requireIssue, không tra mốc
  });

  it.each([['issue:edit'], ['backlog:manage']])('có %s => mốc rank được dùng', async (perm) => {
    const { tx, service } = setup([perm, 'issue:transition']);
    await service.move('w1', 'u1', 'i1', { version: 3, afterId: 'a' });
    expect(tx.issue.findFirst.mock.calls.length).toBeGreaterThan(1); // có tra rank của mốc
  });

  it('không mốc, không sprint, chỉ đổi status với issue:transition => không cần quyền sửa/backlog', async () => {
    const { rbac, service } = setup(['issue:transition']);
    await expect(
      service.move('w1', 'u1', 'i1', { version: 3, statusId: 's2' }),
    ).resolves.toBeDefined();
    expect(rbac.getEffectivePermissions).not.toHaveBeenCalled();
  });
});

describe('IssuesService.move — không rebalance khi giữ rank; đổi status + sprint cùng lúc', () => {
  const emitted = (events: { emit: ReturnType<typeof vi.fn> }) =>
    events.emit.mock.calls.map((c) => c[0] as string);

  it('không mốc => không gọi $executeRaw (không rebalance toàn dự án), không tra mốc', async () => {
    const tx = { ...wipTx({ count: 0 }), $executeRaw: vi.fn(() => Promise.resolve(0)) };
    tx.issue.findFirstOrThrow = vi.fn(() => Promise.resolve(issueRow({ version: 4 })));
    const { service } = makeService(tx);
    await service.move('w1', 'u1', 'i1', { version: 3 });
    await service.move('w1', 'u1', 'i1', { version: 3, statusId: 's2', boardId: 'b1' });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.issue.findMany).not.toHaveBeenCalled();
  });

  it('đổi status + sprint cùng lúc => MOVED → TRANSITIONED → UPDATED, mỗi loại đúng một lần', async () => {
    const tx = wipTx({ count: 0 });
    tx.issue.findFirstOrThrow = vi.fn(() =>
      Promise.resolve(issueRow({ version: 4, statusId: 's2', sprintId: 'sp2' })),
    );
    const { service, events } = makeService(tx);
    await service.move('w1', 'u1', 'i1', { version: 3, statusId: 's2', sprintId: 'sp2' });
    expect(emitted(events)).toEqual([
      DOMAIN_EVENTS.ISSUE_MOVED,
      DOMAIN_EVENTS.ISSUE_TRANSITIONED,
      DOMAIN_EVENTS.ISSUE_UPDATED,
    ]);
    expect(events.emit).toHaveBeenLastCalledWith(
      DOMAIN_EVENTS.ISSUE_UPDATED,
      expect.objectContaining({ changedFields: ['sprintId'] }),
    );
  });
});

describe('IssuesService — ai sửa được công việc thì sửa được điểm (B7)', () => {
  const tx = (after: Record<string, unknown>) => ({
    issue: {
      findFirst: vi.fn(() => Promise.resolve(issueRow({ reporterId: 'u1', createdById: 'u1' }))),
      updateMany: vi.fn((_args: { data: Record<string, unknown> }) =>
        Promise.resolve({ count: 1 }),
      ),
      findFirstOrThrow: vi.fn(() => Promise.resolve(after)),
    },
    issueHistory: { createMany: vi.fn() },
    user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: false })) }, // nhánh kiểm system admin của luật hạn
  });
  it('chỉ có issue:edit, không phải người tạo/báo cáo => sửa được storyPoints', async () => {
    const t = tx(issueRow({ storyPoints: 5, version: 4 }));
    const { service, rbac } = makeService(t);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:edit']));
    const dto = await service.update('w1', 'u2', 'i1', { version: 3, storyPoints: 5 });
    expect(dto.storyPoints).toBe(5);
    expect(t.issue.updateMany.mock.calls[0]![0].data).toMatchObject({ storyPoints: 5 });
  });
  it(':own — việc của mình sửa được điểm, việc của người khác => 403 (quy tắc sở hữu cũ)', async () => {
    const mine = tx(issueRow({ storyPoints: 3, version: 4 }));
    await expect(
      makeService(mine).service.update(
        'w1',
        'u1',
        'i1',
        { version: 3, storyPoints: 3 },
        undefined,
        true,
      ),
    ).resolves.toMatchObject({ storyPoints: 3 });
    const other = tx(issueRow());
    await expect(
      makeService(other).service.update(
        'w1',
        'u2',
        'i1',
        { version: 3, storyPoints: 3 },
        undefined,
        true,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(other.issue.updateMany).not.toHaveBeenCalled();
  });
  it('dueDate GIỮ luật cũ: không phải người tạo/quản trị => 403 dù có issue:edit và backlog:manage', async () => {
    const t = tx(issueRow());
    const { service, rbac } = makeService(t);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:edit', 'backlog:manage']));
    await expect(
      service.update('w1', 'u2', 'i1', { version: 3, dueDate: '2026-11-01T00:00:00.000Z' }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('dueDate: người tạo/báo cáo sửa được', async () => {
    const t = tx(issueRow({ dueDate: new Date('2026-11-01T00:00:00Z'), version: 4 }));
    const { service, rbac } = makeService(t);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:edit']));
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, dueDate: '2026-11-01T00:00:00.000Z' }),
    ).resolves.toBeDefined();
  });
});

const rowsAB = () => [issueRow({ id: 'a' }), issueRow({ id: 'b' })];
const items = [
  { id: 'a', version: 3 },
  { id: 'b', version: 3 },
];
function b7Tx(extra: Record<string, unknown> = {}) {
  return {
    issue: {
      findMany: vi.fn((_args: unknown) => Promise.resolve(rowsAB())),
      updateMany: vi.fn((_args: { data: Record<string, unknown> }) =>
        Promise.resolve({ count: 1 }),
      ),
      findFirst: vi.fn(() =>
        Promise.resolve({
          projectId: 'p1',
          epicId: null,
          type: { key: 'EPIC', hierarchyLevel: 1 },
          version: 5,
        }),
      ),
      findFirstOrThrow: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(issueRow({ id: where.id, version: 4, storyPoints: 8, epicId: 'e1' })),
      ),
    },
    issueHistory: { createMany: vi.fn() },
    issueLabel: { createMany: vi.fn(), deleteMany: vi.fn() },
    label: { findMany: vi.fn(() => Promise.resolve([{ id: 'l1' }])) },
    user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: false })) },
    project: { findUnique: vi.fn(() => Promise.resolve({ defaultWorkflowId: 'wf' })) },
    ...extra,
  };
}

describe('IssuesService.bulkUpdate — storyPoints / epicId / labels (B7)', () => {
  it('storyPoints cho lô: ghi điểm', async () => {
    const t = b7Tx();
    const { service } = makeService(t);
    const r = await service.bulkUpdate('w1', 'u2', {
      projectId: 'p1',
      items,
      patch: { storyPoints: 8 },
    });
    expect(r.updated).toHaveLength(2);
    expect(t.issue.updateMany.mock.calls[0]![0].data).toMatchObject({ storyPoints: 8 });
  });
  it('storyPoints (issue:edit, không phải người tạo): ghi được cho cả lô', async () => {
    const t = b7Tx();
    const { service, rbac } = makeService(t);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:edit']));
    const r = await service.bulkUpdate('w1', 'u2', {
      projectId: 'p1',
      items,
      patch: { storyPoints: 8 },
    });
    expect(r.updated).toHaveLength(2);
  });
  it('storyPoints với :own: một việc của người khác => 403 cả lô, chưa ghi', async () => {
    const t = b7Tx(); // rowsAB: reporterId/createdById = u1, assigneeId null
    const { service } = makeService(t);
    await expect(
      service.bulkUpdate('w1', 'u2', { projectId: 'p1', items, patch: { storyPoints: 8 } }, true),
    ).rejects.toMatchObject({ status: 403 });
    expect(t.issue.updateMany).not.toHaveBeenCalled();
  });
  it('epicId: epic hợp lệ => ghi cho cả lô; epic nằm trong lô => 422', async () => {
    const t = b7Tx();
    const { service } = makeService(t);
    await service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { epicId: 'e1' } });
    expect(t.issue.updateMany.mock.calls[0]![0].data).toMatchObject({ epicId: 'e1' });
    await expect(
      service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { epicId: 'a' } }),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('labels.add: tạo liên kết cho hàng còn khớp version, bỏ qua trùng; nhãn lạ => 404; phát ISSUE_UPDATED có changedFields labels', async () => {
    const t = b7Tx();
    const { service, events } = makeService(t);
    await service.bulkUpdate('w1', 'u1', {
      projectId: 'p1',
      items,
      patch: { labels: { add: ['l1'] } },
    });
    expect(t.issueLabel.createMany).toHaveBeenCalledWith({
      data: [
        { issueId: 'a', labelId: 'l1' },
        { issueId: 'b', labelId: 'l1' },
      ],
      skipDuplicates: true,
    });
    expect(events.emit).toHaveBeenCalledWith(
      'issue.updated',
      expect.objectContaining({ changedFields: expect.arrayContaining(['labels']) as unknown }),
    );
    t.label.findMany.mockResolvedValueOnce([]);
    await expect(
      service.bulkUpdate('w1', 'u1', {
        projectId: 'p1',
        items,
        patch: { labels: { add: ['ghost'] } },
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('IssuesService.bulkUpdate — ca biên nhãn/epic/điểm (B7)', () => {
  it('labels.add: hàng lệch version bị loại khỏi createMany và vào conflicts', async () => {
    const t = b7Tx({
      issue: {
        ...b7Tx().issue,
        findMany: vi.fn((_args: unknown) =>
          Promise.resolve([issueRow({ id: 'a' }), issueRow({ id: 'b', version: 9 })]),
        ),
      },
    });
    const { service } = makeService(t);
    const r = await service.bulkUpdate('w1', 'u1', {
      projectId: 'p1',
      items,
      patch: { labels: { add: ['l1'] } },
    });
    expect(t.issueLabel.createMany).toHaveBeenCalledWith({
      data: [{ issueId: 'a', labelId: 'l1' }],
      skipDuplicates: true,
    });
    expect(r.conflicts).toEqual([{ id: 'b', version: 9 }]);
  });
  it('labels.remove: gỡ đúng nhãn khỏi các hàng còn khớp version', async () => {
    const t = b7Tx();
    const { service } = makeService(t);
    await service.bulkUpdate('w1', 'u1', {
      projectId: 'p1',
      items,
      patch: { labels: { remove: ['l1'] } },
    });
    expect(t.issueLabel.deleteMany).toHaveBeenCalledWith({
      where: { issueId: { in: ['a', 'b'] }, labelId: { in: ['l1'] } },
    });
    expect(t.issueLabel.createMany).not.toHaveBeenCalled();
  });
  it('epicId: chuỗi epic của epic được chọn chạm một việc trong lô => 422 (chu trình), chưa ghi', async () => {
    const chain: Record<string, Record<string, unknown>> = {
      e1: { projectId: 'p1', epicId: 'e2', type: { key: 'EPIC', hierarchyLevel: 1 } },
      e2: { projectId: 'p1', epicId: 'a', type: { key: 'EPIC', hierarchyLevel: 1 } },
    };
    const t = b7Tx({
      issue: {
        ...b7Tx().issue,
        findFirst: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(chain[where.id] ?? null),
        ),
      },
    });
    const { service } = makeService(t);
    await expect(
      service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { epicId: 'e1' } }),
    ).rejects.toMatchObject({ status: 422 });
    expect(t.issue.updateMany).not.toHaveBeenCalled();
  });
  it('epicId cho lô có một Epic => 422 (không epic lồng epic), chưa ghi', async () => {
    const epicRowA = issueRow({
      id: 'a',
      type: { ...issueRow().type, key: 'EPIC', hierarchyLevel: 1 },
    });
    const base = b7Tx();
    const t = b7Tx({
      issue: {
        ...base.issue,
        findMany: vi.fn(() => Promise.resolve([epicRowA, issueRow({ id: 'b' })])),
      },
    });
    const { service } = makeService(t);
    await expect(
      service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { epicId: 'e1' } }),
    ).rejects.toMatchObject({ status: 422 });
    expect(t.issue.updateMany).not.toHaveBeenCalled();
  });
  it('epicId: epic đang nằm dưới việc trong lô qua parentId => 422 (vòng theo parentId ?? epicId)', async () => {
    const chain: Record<string, Record<string, unknown>> = {
      e1: {
        projectId: 'p1',
        parentId: 'x1',
        epicId: null,
        type: { key: 'EPIC', hierarchyLevel: 1 },
      },
      x1: { parentId: 'a', epicId: null },
    };
    const t = b7Tx({
      issue: {
        ...b7Tx().issue,
        findFirst: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(chain[where.id] ?? null),
        ),
      },
    });
    const { service } = makeService(t);
    await expect(
      service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { epicId: 'e1' } }),
    ).rejects.toMatchObject({ status: 422 });
    expect(t.issue.updateMany).not.toHaveBeenCalled();
  });
  it('storyPoints: null xoá điểm', async () => {
    const t = b7Tx({
      issue: {
        ...b7Tx().issue,
        findMany: vi.fn((_args: unknown) =>
          Promise.resolve([
            issueRow({ id: 'a', storyPoints: 5 }),
            issueRow({ id: 'b', storyPoints: 5 }),
          ]),
        ),
      },
    });
    const { service } = makeService(t);
    await service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { storyPoints: null } });
    expect(t.issue.updateMany.mock.calls[0]![0].data).toMatchObject({ storyPoints: null });
  });
  it('đọc lại nhãn SAU commit lỗi => vẫn trả thành công (dữ liệu đã ghi), không văng lỗi', async () => {
    const base = b7Tx();
    const findMany = vi
      .fn()
      .mockResolvedValueOnce(rowsAB())
      .mockRejectedValueOnce(new Error('db down'));
    const t = b7Tx({ issue: { ...base.issue, findMany } });
    const { service } = makeService(t);
    const r = await service.bulkUpdate('w1', 'u1', {
      projectId: 'p1',
      items,
      patch: { labels: { add: ['l1'] } },
    });
    expect(r.updated).toHaveLength(2);
    expect(t.issueLabel.createMany).toHaveBeenCalled();
  });
});

describe('IssuesService — Ngày bắt đầu (L14): start <= hạn và cùng luật quyền với Hạn', () => {
  const D18 = '2026-10-18T00:00:00.000Z';
  const D20 = '2026-10-20T00:00:00.000Z';
  function schedTx(rowOver: Record<string, unknown> = {}) {
    return {
      issue: {
        findFirst: vi.fn(() => Promise.resolve(issueRow(rowOver))),
        findFirstOrThrow: vi.fn(() => Promise.resolve(issueRow({ version: 4 }))),
        updateMany: vi.fn(
          (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
            Promise.resolve({ count: 1 }),
        ),
      },
      issueHistory: { createMany: vi.fn(), create: vi.fn() },
    };
  }

  it('update: bắt đầu > hạn (gửi cả hai) => 422 nêu "Ngày bắt đầu", chưa ghi', async () => {
    const tx = schedTx();
    const { service } = makeService(tx);
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, startDate: D20, dueDate: D18 }),
    ).rejects.toMatchObject({ status: 422, message: has('Ngày bắt đầu') });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('update: chỉ đổi startDate vượt dueDate HIỆN CÓ => cũng lỗi; chỉ đổi dueDate sớm hơn startDate hiện có => lỗi', async () => {
    const tx = schedTx({ dueDate: new Date(D18), startDate: new Date(D18) });
    const { service } = makeService(tx);
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, startDate: D20 }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, dueDate: '2026-10-10T00:00:00.000Z' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('update: bằng nhau hợp lệ; xoá một trong hai luôn được; chỉ có một ngày thì không kiểm', async () => {
    const tx = schedTx({ dueDate: new Date(D18) });
    const { service } = makeService(tx);
    await service.update('w1', 'u1', 'i1', { version: 3, startDate: D18 });
    await service.update('w1', 'u1', 'i1', { version: 3, startDate: null });
    const tx2 = schedTx({ startDate: new Date(D20) });
    const svc2 = makeService(tx2).service;
    await svc2.update('w1', 'u1', 'i1', { version: 3, dueDate: null });
    await svc2.update('w1', 'u1', 'i1', { version: 3, summary: 'không đụng ngày' });
    expect(tx.issue.updateMany).toHaveBeenCalledTimes(2);
    expect(tx2.issue.updateMany).toHaveBeenCalledTimes(2);
  });

  it('update: dữ liệu CŨ sai thứ tự (start > due) — sửa trường khác vẫn được; chỉ khi đụng ngày mới bị kiểm', async () => {
    const tx = schedTx({ startDate: new Date(D20), dueDate: new Date(D18) });
    const { service } = makeService(tx);
    await service.update('w1', 'u1', 'i1', { version: 3, summary: 'sửa tiêu đề' });
    await service.update('w1', 'u1', 'i1', { version: 3, storyPoints: 5 }, { automationDepth: 1 });
    expect(tx.issue.updateMany).toHaveBeenCalledTimes(2);
    // đụng vào ngày mà kết quả vẫn sai thứ tự => vẫn bị chặn
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, dueDate: '2026-10-17T00:00:00.000Z' }),
    ).rejects.toMatchObject({ status: 422 });
    // sửa cho đúng thứ tự => qua
    await service.update('w1', 'u1', 'i1', { version: 3, dueDate: '2026-10-25T00:00:00.000Z' });
    expect(tx.issue.updateMany).toHaveBeenCalledTimes(3);
  });

  it('update: người KHÔNG phải người tạo/quản trị gửi startDate => 403 (cùng luật với Hạn)', async () => {
    const tx = schedTx();
    const { service } = makeService(tx, {
      user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: false })) },
    });
    await expect(
      service.update('w1', 'u2', 'i1', { version: 3, startDate: D18 }),
    ).rejects.toMatchObject({ status: 403, message: has('Ngày bắt đầu') });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('update: quản trị dự án (không phải người tạo) đổi được startDate', async () => {
    const tx = schedTx();
    const { service, rbac } = makeService(tx);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:edit', 'project:admin']));
    await service.update('w1', 'u2', 'i1', { version: 3, startDate: D18 });
    expect(tx.issue.updateMany.mock.calls[0]![0].data).toMatchObject({
      startDate: new Date(D18),
    });
  });

  it('update: automation (opts.automationDepth) bỏ qua kiểm quyền startDate như Hạn', async () => {
    const tx = schedTx();
    const { service } = makeService(tx, {
      user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: false })) },
    });
    await service.update('w1', 'u2', 'i1', { version: 3, startDate: D18 }, { automationDepth: 1 });
    expect(tx.issue.updateMany).toHaveBeenCalledTimes(1);
  });

  it('create: bắt đầu > hạn => 422 trước khi đụng bất cứ thứ gì khác', async () => {
    const { service } = makeService({
      project: {
        findFirst: vi.fn(() => Promise.resolve({ id: 'p1', key: 'P', archivedAt: null })),
      },
    });
    await expect(
      service.create('w1', 'u1', {
        projectId: 'p1',
        typeId: 't1',
        summary: 's',
        descriptionFormat: 'MARKDOWN',
        startDate: D20,
        dueDate: D18,
      }),
    ).rejects.toMatchObject({ status: 422, message: has('Ngày bắt đầu') });
  });
});

describe('IssuesService.update — lịch sử mô tả (B19)', () => {
  const tx = (after: Record<string, unknown>) => ({
    issue: {
      findFirst: vi.fn(() => Promise.resolve(issueRow({ description: 'cũ' }))),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      findFirstOrThrow: vi.fn(() => Promise.resolve(after)),
    },
    issueHistory: { createMany: vi.fn() },
  });
  it('đổi mô tả => ghi DESCRIPTION với bản cũ/mới đầy đủ', async () => {
    const t = tx(issueRow({ description: 'mới', version: 4 }));
    const { service } = makeService(t);
    await service.update('w1', 'u1', 'i1', { version: 3, description: 'mới' });
    expect(t.issueHistory.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          field: 'DESCRIPTION',
          oldValue: 'cũ',
          newValue: 'mới',
          actorId: 'u1',
        }),
      ],
    });
  });
  it('null và chuỗi rỗng coi như nhau => không ghi', async () => {
    const t = tx(issueRow({ description: '', version: 4 }));
    t.issue.findFirst.mockResolvedValue(issueRow({ description: null }));
    const { service } = makeService(t);
    await service.update('w1', 'u1', 'i1', { version: 3, description: '' });
    expect(t.issueHistory.createMany).not.toHaveBeenCalled();
  });
});

describe('IssuesService — cây việc: server chặn đích sai của parentId/epicId (B22)', () => {
  const T = {
    task: { key: 'TASK', hierarchyLevel: 0, isSubtask: false },
    epic: { key: 'EPIC', hierarchyLevel: 1, isSubtask: false },
    sub: { key: 'SUBTASK', hierarchyLevel: -1, isSubtask: true },
  };
  const row = (over: Record<string, unknown> = {}) => ({
    projectId: 'p1',
    parentId: null,
    epicId: null,
    type: T.task,
    ...over,
  });

  /** `others`: id → hàng của các việc khác (mọi truy vấn id lạ → null = không tồn tại). */
  function treeTx(current: Record<string, unknown>, others: Record<string, unknown> = {}) {
    return {
      issue: {
        findFirst: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === 'i1' ? current : (others[where.id] ?? null)),
        ),
        updateMany: vi.fn((_args: { data: Record<string, unknown> }) =>
          Promise.resolve({ count: 1 }),
        ),
        findFirstOrThrow: vi.fn(() => Promise.resolve(current)),
      },
      issueHistory: { createMany: vi.fn() },
    };
  }
  const patch = (tx: ReturnType<typeof treeTx>, input: Record<string, unknown>) =>
    makeService(tx).service.update('w1', 'u1', 'i1', { version: 3, ...input });

  it('Epic đặt parentId => 422 (không epic lồng, Epic không có cha), không ghi', async () => {
    const tx = treeTx(issueRow({ type: { ...issueRow().type, ...T.epic } }), { p9: row() });
    await expect(patch(tx, { parentId: 'p9' })).rejects.toMatchObject({ status: 422 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('cha là sub-task => 422', async () => {
    const tx = treeTx(issueRow(), { p9: row({ type: T.sub }) });
    await expect(patch(tx, { parentId: 'p9' })).rejects.toMatchObject({ status: 422 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('cha ở dự án khác => 422; cha không tồn tại/ngoài workspace => 404', async () => {
    const tx = treeTx(issueRow(), { p9: row({ projectId: 'p2' }) });
    await expect(patch(tx, { parentId: 'p9' })).rejects.toMatchObject({ status: 422 });
    await expect(patch(tx, { parentId: 'ghost' })).rejects.toMatchObject({ status: 404 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('vòng trực tiếp: cha là con của chính nó (parentId) => 422', async () => {
    const tx = treeTx(issueRow(), { c1: row({ parentId: 'i1' }) });
    await expect(patch(tx, { parentId: 'c1' })).rejects.toMatchObject({ status: 422 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('vòng HỖN HỢP theo parentId ?? epicId: cha là việc thuộc epic = chính nó => 422', async () => {
    // c1.epicId = i1 (cây thấy c1 dưới i1); chỉ đi theo parentId thì không thấy vòng.
    const tx = treeTx(issueRow(), { c1: row({ epicId: 'i1' }) });
    await expect(patch(tx, { parentId: 'c1' })).rejects.toMatchObject({ status: 422 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('vòng qua epic mới: epic e1 đang nằm dưới một việc con của chính nó => 422', async () => {
    const tx = treeTx(issueRow(), {
      e1: row({ type: T.epic, parentId: 'x1' }),
      x1: row({ parentId: 'i1' }),
    });
    await expect(patch(tx, { epicId: 'e1' })).rejects.toMatchObject({ status: 422 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('chuỗi tổ tiên quá sâu (> 100 cấp) => 422, không treo', async () => {
    const chain: Record<string, unknown> = { p0: row() };
    for (let k = 0; k < 120; k++) chain[`p${k}`] = row({ parentId: `p${k + 1}` });
    const tx = treeTx(issueRow(), chain);
    await expect(patch(tx, { parentId: 'p0' })).rejects.toMatchObject({ status: 422 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('cha hợp lệ (cùng dự án, việc thường) => ghi parentId; vòng cũ không liên quan tới việc này không chặn oan', async () => {
    const tx = treeTx(issueRow(), {
      p9: row({ parentId: 'a1' }),
      a1: row({ parentId: 'a2' }),
      a2: row({ parentId: 'a1' }),
    });
    await expect(patch(tx, { parentId: 'p9' })).resolves.toBeDefined();
    expect(tx.issue.updateMany.mock.calls[0]![0].data).toMatchObject({ parentId: 'p9' });
  });

  it('gỡ parentId (null) hoặc gửi lại cha hiện tại => không áp luật cấu trúc lên dữ liệu cũ', async () => {
    // Epic có cha + cha là sub-task = dữ liệu cũ; gửi lại đúng cha đó (hoặc gỡ) không bị 422 oan.
    const tx = treeTx(issueRow({ parentId: 'old', type: { ...issueRow().type, ...T.epic } }), {
      old: row({ type: T.sub }),
    });
    await expect(patch(tx, { parentId: null })).resolves.toBeDefined();
    await expect(patch(tx, { parentId: 'old' })).resolves.toBeDefined();
  });

  describe('create (đường API)', () => {
    const input = (extra: Record<string, unknown>) => ({
      projectId: 'p1',
      typeId: 't1',
      summary: 's',
      descriptionFormat: 'MARKDOWN' as const,
      ...extra,
    });
    it.each([
      ['cha là sub-task', { p9: row({ type: T.sub }) }],
      ['cha khác dự án', { p9: row({ projectId: 'p2' }) }],
    ])('%s => 422, không tạo', async (_n, others) => {
      const { tx, created } = createTxFor(others);
      const { service } = makeService(tx);
      await expect(service.create('w1', 'u1', input({ parentId: 'p9' }))).rejects.toMatchObject({
        status: 422,
      });
      expect(created).not.toHaveBeenCalled();
    });
    it('tạo Epic có parentId => 422; việc thường với cha hợp lệ => tạo', async () => {
      const bad = createTxFor({ p9: row() });
      bad.tx.issueType.findFirst = vi.fn(() => Promise.resolve({ id: 't1', ...T.epic }));
      await expect(
        makeService(bad.tx).service.create('w1', 'u1', input({ parentId: 'p9' })),
      ).rejects.toMatchObject({ status: 422 });
      expect(bad.created).not.toHaveBeenCalled();
      const ok = createTxFor({ p9: row() });
      await makeService(ok.tx).service.create('w1', 'u1', input({ parentId: 'p9' }));
      expect(ok.created.mock.calls[0]![0].data.parentId).toBe('p9');
    });
  });
});

describe('IssuesService — dự án riêng tư (P13)', () => {
  const visible = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };

  function makeWithAccess(visibleWhere: unknown = visible) {
    const issue = {
      findMany: vi.fn(() => Promise.resolve([])),
      findFirst: vi.fn(() => Promise.resolve(null)),
    };
    const prisma = { issue };
    const access = { visibleWhere: vi.fn(() => Promise.resolve(visibleWhere)) };
    const service = new IssuesService(
      prisma as never,
      { emit: vi.fn() } as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      access as never,
    );
    return { service, prisma, access };
  }
  const whereOf = (fn: ReturnType<typeof vi.fn>) =>
    (fn.mock.calls[0] as unknown as [{ where: unknown }])[0].where;

  it('list(): nhúng điều kiện hiển thị vào project của scope', async () => {
    const { service, prisma, access } = makeWithAccess();
    await service.list('w1', {}, undefined, 20, 'u1');
    expect(access.visibleWhere).toHaveBeenCalledWith('u1', 'w1');
    expect(whereOf(prisma.issue.findMany)).toMatchObject({
      workspaceId: 'w1',
      deletedAt: null,
      project: { deletedAt: null, ...visible },
    });
  });

  it('list(): viewerId trống (đường hệ thống như board) → không lọc riêng tư', async () => {
    const { service, prisma, access } = makeWithAccess();
    await service.list('w1', {}, undefined, 20, null);
    expect(access.visibleWhere).not.toHaveBeenCalled();
    expect(JSON.stringify(whereOf(prisma.issue.findMany))).not.toContain('isPrivate');
    expect(whereOf(prisma.issue.findMany)).toMatchObject({ project: { deletedAt: null } });
  });

  it('query(): scope có điều kiện hiển thị; viewerId trống → không lọc (đường hệ thống)', async () => {
    const a = makeWithAccess();
    await a.service.query('w1', { id: 'x' }, [], undefined, 1, 'u1');
    expect(JSON.stringify(whereOf(a.prisma.issue.findMany))).toContain('"isPrivate":false');
    const b = makeWithAccess();
    await b.service.query('w1', { id: 'x' }, [], undefined, 1, null);
    expect(JSON.stringify(whereOf(b.prisma.issue.findMany))).not.toContain('isPrivate');
  });

  it('query() với rawIds (full-text): scope cuối vẫn lọc dự án riêng tư', async () => {
    const a = makeWithAccess();
    await a.service.query('w1', {}, [], undefined, 5, 'u1', { rawIds: ['i1', 'i2'] });
    expect(JSON.stringify(whereOf(a.prisma.issue.findMany))).toContain('"isPrivate":false');
  });

  it('query() rankHint: cả hai pha đều lọc dự án riêng tư', async () => {
    const a = makeWithAccess();
    await a.service.query('w1', {}, [], undefined, 5, 'u1', { rankHint: ['i1'] });
    for (const c of a.prisma.issue.findMany.mock.calls as unknown as [{ where: unknown }][]) {
      expect(JSON.stringify(c[0].where)).toContain('"isPrivate":false');
    }
  });

  it('getByKey(): dự án riêng tư không thấy → 404 cùng thông điệp với công việc không tồn tại', async () => {
    const { service, prisma } = makeWithAccess();
    const hidden = await service.getByKey('w1', 'HR-1', 'u1').catch((e: unknown) => e);
    expect(whereOf(prisma.issue.findFirst)).toMatchObject({
      workspaceId: 'w1',
      key: 'HR-1',
      project: { deletedAt: null, ...visible },
    });
    // Cùng đường "không tồn tại": gọi lại không viewer (mã không có thật) cho đúng cùng lỗi.
    const missing = await makeWithAccess()
      .service.getByKey('w1', 'NOPE-1', null)
      .catch((e: unknown) => e);
    expect((hidden as Error).message).toBe((missing as Error).message);
    expect((hidden as { getStatus?: () => number }).getStatus?.()).toBe(404);
  });

  it('getByKey(): thành viên thấy dự án riêng tư', async () => {
    const { service, prisma } = makeWithAccess();
    prisma.issue.findFirst.mockResolvedValue(issueRow() as never);
    const dto = await service.getByKey('w1', 'P-TASK-1', 'u1');
    expect(dto.key).toBe('P-TASK-1');
  });
});

describe('IssuesService — người phụ trách phải xem được dự án (P16)', () => {
  const projectTx = () => ({
    project: {
      findFirst: vi.fn(() =>
        Promise.resolve({
          id: 'p1',
          key: 'P',
          defaultWorkflowId: 'wf',
          leadId: null,
          defaultAssigneeMode: 'NONE',
          archivedAt: null,
        }),
      ),
    },
    issueType: { findFirst: vi.fn(() => Promise.resolve({ id: 't1' })) },
    issue: { create: vi.fn() },
  });

  it('create(assigneeId) là thành viên workspace nhưng không thấy dự án riêng tư => 422, chưa ghi', async () => {
    const tx = projectTx();
    const { service, canSee } = makeService(tx);
    canSee.mockResolvedValue(false);
    await expect(
      service.create('w1', 'u1', {
        projectId: 'p1',
        typeId: 't1',
        summary: 's',
        descriptionFormat: 'MARKDOWN',
        assigneeId: 'u2',
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(canSee).toHaveBeenCalledWith('u2', 'w1', 'p1');
    expect(tx.issue.create).not.toHaveBeenCalled();
  });

  it('update(assigneeId) người không thấy dự án => 422, không ghi; thành viên dự án => được', async () => {
    const tx = {
      issue: {
        findFirst: vi.fn(() => Promise.resolve(issueRow())),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
        findFirstOrThrow: vi.fn(() => Promise.resolve(issueRow({ version: 4, assigneeId: 'u2' }))),
      },
      issueHistory: { createMany: vi.fn() },
    };
    const hidden = makeService(tx);
    hidden.canSee.mockResolvedValue(false);
    await expect(
      hidden.service.update('w1', 'u1', 'i1', { version: 3, assigneeId: 'u2' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(hidden.canSee).toHaveBeenCalledWith('u2', 'w1', 'p1');
    expect(tx.issue.updateMany).not.toHaveBeenCalled();

    const member = makeService(tx);
    await expect(
      member.service.update('w1', 'u1', 'i1', { version: 3, assigneeId: 'u2' }),
    ).resolves.toBeDefined();
  });

  it('isAssignableMember không có projectId (rule-engine/hệ thống) không kiểm quyền xem', async () => {
    const { service, canSee } = makeService({});
    await expect(service.isAssignableMember('w1', 'u2')).resolves.toBe(true);
    expect(canSee).not.toHaveBeenCalled();
  });
});
