import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { DOMAIN_EVENTS } from '@tirapro/types';
import { Prisma } from '@prisma/client';
import { rankBetween, RANK_MAX_LEN } from '@tirapro/shared';
import { ProjectAccessService } from '../rbac/project-access.service';
import { IssuesService } from './issues.service';
import { PointsService } from './points.service';

// Phát cập nhật tổng điểm Epic chỉ ghi cảnh báo khi lỗi (dữ liệu đã commit) — nên một mock thiếu `issue.findMany` sẽ im lặng
// bỏ qua nhánh phát sự kiện. Chặn điều đó: mọi test phải thật sự chạy được nhánh phát (mock đủ hàng Epic).
const warnSpy = vi.spyOn(Logger.prototype, 'warn');
afterEach(() => {
  const epicEmitFailures = warnSpy.mock.calls.filter((c) =>
    String(c[0]).includes('Không phát được cập nhật tổng điểm Epic'),
  );
  warnSpy.mockClear();
  expect(epicEmitFailures).toEqual([]);
});

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
    difficulty: 'MEDIUM',
    pointsManual: false,
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
    // Không có liên kết "Blocks" chưa xong (kiểm chặn khi chuyển sang Done, logbug #23).
    issueLink: { findMany: vi.fn(() => Promise.resolve([])) },
    // Người gọi không phải SA (ca ghi đè điểm); ca SA ghi đè qua prismaExtra.user.
    user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: false })) },
    // Bảng hệ số: không có dòng → công thức mặc định (spec công thức nằm ở points.spec.ts của @tirapro/shared).
    pointsFormulaConfig: { findUnique: vi.fn(() => Promise.resolve(null)) },
  };
  // Tra Loại/Ưu tiên cho điểm tự tính: mặc định Task / không tên ưu tiên đặc biệt; spec riêng ghi đè qua `tx`.
  const txFull = {
    // Khoá dòng Epic (FOR UPDATE) trước khi cộng lại tổng điểm.
    $queryRaw: vi.fn(() => Promise.resolve([])),
    issueType: { findUnique: vi.fn(() => Promise.resolve({ key: 'TASK' })) },
    priority: { findUnique: vi.fn(() => Promise.resolve({ name: 'Medium' })) },
    ...tx,
  };
  // Việc con còn sống / Epic của việc con (liveDescendants, childEpicIds...): mặc định không có; spec riêng ghi đè findMany.
  const issueTable = tx.issue as Record<string, unknown> | undefined;
  if (issueTable && !issueTable.findMany) issueTable.findMany = vi.fn(() => Promise.resolve([]));
  const prisma = {
    $transaction: (fn: (t: unknown) => unknown) => fn(txFull),
    ...base,
    ...txFull,
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
    new PointsService(prisma as never),
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
    // Cờ "đã rebalance" bật khi chạy câu UPDATE raw (project.update giờ còn là KHOÁ dự án của move, chạy trước khi đọc mốc).
    const executeRaw = vi.fn(async () => {
      await Promise.resolve();
      rebalanced = true;
      return 3;
    });
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
      project: { update: vi.fn(() => Promise.resolve({ id: 'p1' })) },
      $executeRaw: executeRaw,
    };
    const { service, events } = makeService(tx);

    const dto = await service.move('w1', 'u1', 'i1', { version: 3, afterId: 'a', beforeId: 'b' });

    expect(tx.project.update).toHaveBeenCalledTimes(2); // khoá dự án của move + khoá của rebalance
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
      project: { update: vi.fn(() => Promise.resolve({ id: 'p1' })) },
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
        findMany: vi.fn(() => Promise.resolve([])), // việc con còn sống (xoá/đổi sprint): không có
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
      findMany: vi.fn(() => Promise.resolve([])), // childEpicIds khi xoá
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
      // Tổng điểm Epic sau khi khôi phục (khôi phục vào Epic còn sống phải tính lại tổng).
      aggregate: vi.fn(() => Promise.resolve({ _sum: { storyPoints: 0 } })),
      // `idsWithLiveChildren` (việc khôi phục có đang là việc cha không)
      findMany: vi.fn((_a?: unknown) => Promise.resolve([] as unknown[])),
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
    const found = { deletedAt: new Date(), parentId: 'gone', epicId: 'live', storyPoints: 0 };
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
    // 2 ISSUE_TRANSITIONED (cùng batch) + 1 ISSUES_BULK_UPDATED gộp cho cả lô (N1).
    expect(events.emit).toHaveBeenCalledTimes(3);
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
      // khoá hàng dự án khi move có mốc rank
      update: vi.fn(() => Promise.resolve({ id: 'p1' })),
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

  it('createWithin(overrides.reporterId) đặt người báo cáo NGAY lúc tạo; không truyền thì là người nhập', async () => {
    const input = {
      projectId: 'p1',
      typeId: 't1',
      summary: 's',
      descriptionFormat: 'MARKDOWN' as const,
    };
    const w = createTx([{ id: 's1', category: 'TODO', isInitial: true }]);
    const { service } = makeService(w.tx);
    await service.createWithin(w.tx as never, 'w1', 'u1', input, [], undefined, {
      reporterId: 'u7',
    });
    expect(w.created.mock.calls[0]![0].data.reporterId).toBe('u7');
    await service.createWithin(w.tx as never, 'w1', 'u1', input, []);
    expect(w.created.mock.calls[1]![0].data.reporterId).toBe('u1');
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
    $queryRaw: vi.fn(() => Promise.resolve([{ max: 0 }])),
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

describe('IssuesService.create — rank "cuối danh sách" đọc SAU khi giữ khoá dự án (smoke: 10 POST song song trùng rank)', () => {
  const input = {
    projectId: 'p1',
    typeId: 't1',
    summary: 's',
    descriptionFormat: 'MARKDOWN' as const,
  };

  /** tx giả ghi thứ tự: `project.update` (tăng issueSequence = giữ khoá hàng dự án) và lần đọc rank cuối. */
  function setup() {
    const { tx, created } = createTx(WF_DEFAULT);
    const order: string[] = [];
    const rankReads: string[] = [];
    const baseFindFirst = tx.issue.findFirst;
    tx.issue.findFirst = vi.fn((args: { where: { id?: string; projectId?: string } }) => {
      if (args.where.projectId && !args.where.id) {
        order.push('rank-read');
        rankReads.push('tx');
        return Promise.resolve({ rank: 'n' });
      }
      return baseFindFirst(args);
    });
    const baseUpdate = tx.project.update;
    tx.project.update = vi.fn(() => {
      order.push('sequence-update');
      return baseUpdate();
    });
    // đường NGOÀI transaction (this.prisma): nếu rank còn đọc ở đây thì nó chạy trước khi giữ khoá
    const outside = vi.fn((_args: unknown) => {
      rankReads.push('outside');
      return Promise.resolve({ rank: 'n' });
    });
    return { tx, created, order, rankReads, outside };
  }

  it('rank cuối danh sách được đọc qua tx, SAU bước tăng issueSequence', async () => {
    const { tx, order, rankReads, outside } = setup();
    const { service } = makeService(tx, { issue: { ...tx.issue, findFirst: outside } });
    await service.create('w1', 'u1', input);
    expect(order).toEqual(['sequence-update', 'rank-read']);
    expect(rankReads).toEqual(['tx']);
    expect(outside).not.toHaveBeenCalled();
  });

  it('rank ghi vào việc mới = rankBetween(rank cuối đọc được, null) — vẫn xếp cuối danh sách', async () => {
    const { tx, created } = setup();
    const { service } = makeService(tx);
    await service.create('w1', 'u1', input);
    const data = (created.mock.calls[0] as unknown as [{ data: { rank: string } }])[0].data;
    expect(data.rank).toBe(rankBetween('n', null));
    expect(data.rank > 'n').toBe(true);
  });

  it('createWithin (import, tx của bên gọi): cũng đọc rank trong tx sau khi tăng issueSequence', async () => {
    const { tx, order } = setup();
    const { service } = makeService(tx);
    await service.createWithin(tx as never, 'w1', 'u1', input, []);
    expect(order).toEqual(['sequence-update', 'rank-read']);
  });
});

describe('IssuesService.create — hết chỗ chèn rank: rebalance trong tx, sự kiện chỉ phát sau commit', () => {
  const input = {
    projectId: 'p1',
    typeId: 't1',
    summary: 's',
    descriptionFormat: 'MARKDOWN' as const,
  };
  /** rank cuối đã dài tối đa → rankBetween(last, null) ném RankGapError → phải đánh số lại cả dự án */
  const FULL = 'z'.repeat(RANK_MAX_LEN);

  function setup() {
    const { tx, created } = createTx(WF_DEFAULT);
    const log: string[] = [];
    let rebalanced = false;
    const txx = tx as unknown as Record<string, unknown> & {
      issue: Record<string, unknown>;
    };
    txx.issue.findFirst = vi.fn((args: { where: { id?: string } }) => {
      if (args.where.id) return Promise.resolve(null);
      return Promise.resolve({ rank: rebalanced ? 'r' : FULL });
    });
    txx.issue.findMany = vi.fn(() => Promise.resolve([{ id: 'i1' }, { id: 'i2' }]));
    txx.$executeRaw = vi.fn(() => {
      rebalanced = true;
      log.push('rebalance-update');
      return Promise.resolve(2);
    });
    const outside = { $executeRaw: vi.fn() };
    const transaction = vi.fn(async (fn: (t: unknown) => Promise<unknown>, _opts?: unknown) => {
      const r = await fn(tx);
      log.push('commit');
      return r;
    });
    return { tx, created, log, outside, transaction };
  }
  const rebalanceEmits = (events: { emit: ReturnType<typeof vi.fn> }) =>
    events.emit.mock.calls.filter((c) => c[0] === DOMAIN_EVENTS.PROJECT_RANKS_REBALANCED);

  it('create(): rebalance chạy qua tx (không qua this.prisma), PROJECT_RANKS_REBALANCED phát SAU commit, tx có timeout 30s', async () => {
    const { tx, log, outside, transaction } = setup();
    const { service, events } = makeService(tx, { $transaction: transaction, ...outside });
    events.emit.mockImplementation((name: string) => {
      if (name === DOMAIN_EVENTS.PROJECT_RANKS_REBALANCED) log.push('emit-rebalanced');
    });
    await service.create('w1', 'u1', input);
    expect(outside.$executeRaw).not.toHaveBeenCalled();
    expect(log).toEqual(['rebalance-update', 'commit', 'emit-rebalanced']);
    expect(rebalanceEmits(events)).toEqual([
      [DOMAIN_EVENTS.PROJECT_RANKS_REBALANCED, { projectId: 'p1' }],
    ]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0]![1]).toEqual({ timeout: 30_000 });
  });

  it('create(): tx ném lỗi sau khi đã rebalance => KHÔNG phát PROJECT_RANKS_REBALANCED', async () => {
    const { tx, created, log, transaction } = setup();
    created.mockRejectedValueOnce(new Error('boom'));
    const { service, events } = makeService(tx, { $transaction: transaction });
    await expect(service.create('w1', 'u1', input)).rejects.toThrow('boom');
    expect(log).toEqual(['rebalance-update']); // chưa commit
    expect(rebalanceEmits(events)).toHaveLength(0);
  });

  it('createWithin (tx của bên gọi): sự kiện đi vào `deferred`, không phát cho tới khi bên gọi chạy nó', async () => {
    const { tx } = setup();
    const { service, events } = makeService(tx);
    const deferred: Array<() => void> = [];
    await service.createWithin(tx as never, 'w1', 'u1', input, deferred);
    expect(deferred).toHaveLength(1);
    expect(rebalanceEmits(events)).toHaveLength(0);
    deferred[0]!();
    expect(rebalanceEmits(events)).toHaveLength(1);
  });

  it('không hết chỗ chèn => không rebalance, không sự kiện, vẫn tx timeout 30s', async () => {
    const { tx, transaction } = setup();
    (tx.issue as { findFirst: unknown }).findFirst = vi.fn(() => Promise.resolve({ rank: 'n' }));
    const { service, events } = makeService(tx, { $transaction: transaction });
    await service.create('w1', 'u1', input);
    expect(
      (tx as unknown as { $executeRaw: ReturnType<typeof vi.fn> }).$executeRaw,
    ).not.toHaveBeenCalled();
    expect(rebalanceEmits(events)).toHaveLength(0);
    expect(transaction.mock.calls[0]![1]).toEqual({ timeout: 30_000 });
  });
});

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

  it('không có fixedKey: số kế tiếp = số LỚN NHẤT đang có trong dải mã cùng tiền tố của dự án + 1', async () => {
    const { tx, created } = createTx(WF);
    tx.$queryRaw = vi.fn(() => Promise.resolve([{ max: 2 }]));
    const { service } = makeService(tx);
    await service.createWithin(tx as never, 'w1', 'u1', baseInput, []);
    expect(created.mock.calls[0]![0].data.key).toBe('P-TASK-3');
    expect(tx.issue.count).not.toHaveBeenCalled();
  });

  it('dải mã có lỗ hổng (việc đổi loại / xoá cứng): lấy max chứ không đếm ⇒ không sinh mã trùng', async () => {
    // P-TASK-1, P-TASK-5 còn lại (2..4 đã đổi loại hoặc bị xoá): đếm sẽ ra P-TASK-3 hoặc trùng; max ra P-TASK-6
    const { tx, created } = createTx(WF);
    tx.$queryRaw = vi.fn(() => Promise.resolve([{ max: 5 }]));
    const { service } = makeService(tx);
    await service.createWithin(tx as never, 'w1', 'u1', baseInput, []);
    expect(created.mock.calls[0]![0].data.key).toBe('P-TASK-6');
  });

  it('đường API (create) bỏ qua fixedKey: người dùng không tự đặt được mã', async () => {
    const { tx, created } = createTx(WF);
    const { service } = makeService(tx);
    // createCore là private; `create` không có tham số mã ⇒ luôn sinh mã Tirapro.
    await service.create('w1', 'u1', { ...baseInput, key: 'JRA-1' } as never);
    expect(created.mock.calls[0]![0].data.key).toBe('P-TASK-1');
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
        aggregate: vi.fn(() => Promise.resolve({ _sum: { storyPoints: 0 } })),
        // đọc lại Epic vừa đổi tổng để phát ISSUE_UPDATED (getDtosByIdsForSystem)
        findMany: vi.fn((a: { where: { id: { in: string[] } } }) =>
          Promise.resolve(a.where.id.in.map((id) => issueRow({ id }))),
        ),
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
    // Epic đổi tổng (0 → …) được đọc lại và phát ISSUE_UPDATED do hệ thống suy ra (`bulk: true`)
    expect(events.emit).toHaveBeenCalledWith(
      DOMAIN_EVENTS.ISSUE_UPDATED,
      expect.objectContaining({
        issue: expect.objectContaining({ id: 'e1' }) as unknown,
        changedFields: ['storyPoints'],
        bulk: true,
      }),
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
      findMany.mock.calls as unknown as Array<[{ where: { AND: Array<{ OR: unknown[] }> } }]>
    ).map((c) => c[0].where.AND[0]!.OR);
    expect(wheres[0]).toEqual([
      { summary: { contains: '\\_', mode: 'insensitive' } },
      { key: { contains: '\\_', mode: 'insensitive' } },
    ]);
    expect(wheres[1]![0]).toEqual({ summary: { contains: '50\\%\\\\', mode: 'insensitive' } });
  });

  it('list với search khớp cả MÃ công việc (logbug #29) mà không bị TRIAGE_VISIBLE đè', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const { service } = makeService({ issue: { findMany } });
    await service.list('w1', { search: 'bug-3' }, undefined, 50, null);
    const where = (findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0]
      .where;
    expect(JSON.stringify(where.AND)).toContain('"key":{"contains":"bug-3"');
    expect(where.OR).toEqual([{ triageState: null }, { triageState: 'ACCEPTED' }]);
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
  function tx2(afterOver: Record<string, unknown>, ids: string[] = ['a']) {
    const rows = ids.map((id) => issueRow({ id }));
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
    // N1: status-only cũng thuộc lô — TRANSITIONED mang `batch` + MỘT ISSUES_BULK_UPDATED (Telegram gộp 1 tin).
    expect(events.emit.mock.calls.map((c) => c[0] as string)).toEqual([
      'issue.transitioned',
      'issue.bulk_updated',
    ]);
    expect(events.emit).toHaveBeenCalledWith(
      'issue.transitioned',
      expect.objectContaining({
        actorId: 'u1',
        batch: { id: expect.any(String) as string, size: 1 },
      }),
    );
  });

  it('N1: lô 30 việc chỉ đổi status => 30 TRANSITIONED cùng batch {id,size:30} + đúng MỘT ISSUES_BULK_UPDATED count 30', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `i${i}`);
    const tx = tx2({ statusId: 's2', status: stage2 }, ids);
    const { service, events, rbac } = makeService(tx);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:transition']));
    await service.bulkUpdate('w1', 'u1', {
      projectId: 'p1',
      items: ids.map((id) => ({ id, version: 3 })),
      patch: { statusId: 's2' },
    });
    const calls = events.emit.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
    const transitioned = calls.filter(([n]) => n === 'issue.transitioned').map(([, p]) => p);
    expect(transitioned).toHaveLength(30);
    const batchId = (transitioned[0]!.batch as { id: string }).id;
    for (const p of transitioned) expect(p.batch).toEqual({ id: batchId, size: 30 });
    expect(calls.filter(([n]) => n === 'issue.updated')).toHaveLength(0);
    const summary = calls.filter(([n]) => n === 'issue.bulk_updated');
    expect(summary).toHaveLength(1);
    expect(summary[0]![1]).toMatchObject({ projectId: 'p1', actorId: 'u1', count: 30 });
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
      // project.update = khoá dự án của move (và của rebalance); cờ rebalance bật ở câu UPDATE raw.
      project: { update: vi.fn(() => Promise.resolve({ id: 'p1' })) },
      $executeRaw: vi.fn(async () => {
        await Promise.resolve();
        rebalanced = true;
        return 3;
      }),
    };
    return tx;
  }

  it('hai mốc bị đảo thứ tự (client cũ) => 409 RANK_NEIGHBORS_STALE, KHÔNG rebalance, không ghi', async () => {
    const tx = makeTx({ a: ['r', 'r'], b: ['i', 'i'] }); // after=a(r) nhưng before=b(i) ⇒ prev > next
    const { service, events } = makeService(tx);
    await expect(
      service.move('w1', 'u1', 'i1', { version: 3, afterId: 'a', beforeId: 'b' }),
    ).rejects.toMatchObject({ status: 409, code: 'RANK_NEIGHBORS_STALE' });
    expect(tx.project.update).toHaveBeenCalledTimes(1); // chỉ khoá dự án của move, không có khoá rebalance
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it("hai mốc trùng rank ('n','n') => vẫn là cạn chỗ: rebalance rồi tính lại", async () => {
    const tx = makeTx({ a: ['n', 'i'], b: ['n', 'r'] });
    const { service, events } = makeService(tx);
    const dto = await service.move('w1', 'u1', 'i1', { version: 3, afterId: 'a', beforeId: 'b' });
    expect(tx.project.update).toHaveBeenCalledTimes(2); // khoá move + khoá rebalance
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

/**
 * `tx` và `this.prisma` tách bạch để biết mỗi lần đọc/ghi đi đường nào. `log` ghi đúng thứ tự:
 * begin → lock (khoá hàng dự án) → tx-rank-read (mốc) → wip-lock (cột) → write → commit.
 */
function moveRankSetup(
  opts: {
    ranks?: Record<string, [string, string]>;
    count?: number;
    emitLog?: boolean;
  } = {},
) {
  const ranks = opts.ranks ?? { a: ['i', 'i'], b: ['r', 'r'] };
  const log: string[] = [];
  let rebalanced = false;
  const tx = wipTx({ count: opts.count ?? 0 });
  tx.project = {
    ...tx.project,
    update: vi.fn(() => {
      log.push('lock');
      return Promise.resolve({ id: 'p1' });
    }),
  };
  tx.$queryRaw = vi.fn(() => {
    log.push('wip-lock');
    return Promise.resolve([]);
  });
  const rankFor = (id: string) => {
    const r = ranks[id];
    return r ? { rank: rebalanced ? r[1] : r[0] } : null;
  };
  tx.issue.findFirst = vi.fn(({ where }: { where: { id: string } }) => {
    if (where.id === 'i1') return Promise.resolve(issueRow());
    log.push(`tx-rank-read:${where.id}`);
    return Promise.resolve(rankFor(where.id));
  });
  tx.issue.findMany = vi.fn(() => Promise.resolve([{ id: 'a' }, { id: 'i1' }, { id: 'b' }]));
  tx.issue.updateMany = vi.fn(() => {
    log.push('write');
    return Promise.resolve({ count: 1 });
  });
  (tx as unknown as { $executeRaw: unknown }).$executeRaw = vi.fn(() => {
    rebalanced = true;
    log.push('rebalance-update');
    return Promise.resolve(3);
  });
  // ĐƯỜNG NGOÀI transaction (this.prisma): chỉ requireIssue được đọc ở đây; đọc mốc ở đây = lỗi (chạy trước khi giữ khoá).
  const outsideIssue = {
    findFirst: vi.fn(({ where }: { where: { id: string } }) => {
      if (where.id === 'i1') return Promise.resolve(issueRow());
      log.push(`OUTSIDE-rank-read:${where.id}`);
      return Promise.resolve(rankFor(where.id));
    }),
  };
  const transaction = vi.fn(async (fn: (t: unknown) => Promise<unknown>, _o?: unknown) => {
    log.push('begin');
    const r = await fn(tx);
    log.push('commit');
    return r;
  });
  const made = makeService(tx, { issue: outsideIssue, $transaction: transaction });
  made.events.emit.mockImplementation((name: string) => {
    if (name === DOMAIN_EVENTS.PROJECT_RANKS_REBALANCED) log.push('emit-rebalanced');
    if (name === DOMAIN_EVENTS.ISSUE_MOVED) log.push('emit-moved');
  });
  return { ...made, tx, log, transaction, outsideIssue };
}

describe('IssuesService.move — rank tính TRONG tx, sau khoá dự án và khoá cột WIP (R3)', () => {
  it('kéo vào GIỮA hai mốc: khoá dự án trước, rồi đọc cả hai mốc qua tx, rồi ghi; không đọc mốc ngoài tx', async () => {
    const { service, log, outsideIssue } = moveRankSetup();
    await service.move('w1', 'u1', 'i1', { version: 3, afterId: 'a', beforeId: 'b' });
    expect(log).toEqual([
      'begin',
      'lock',
      'tx-rank-read:a',
      'tx-rank-read:b',
      'write',
      'commit',
      'emit-moved',
    ]);
    expect(log.some((l) => l.startsWith('OUTSIDE'))).toBe(false);
    // chỉ requireIssue đọc ngoài tx
    expect(outsideIssue.findFirst).toHaveBeenCalledTimes(1);
  });

  it('kéo xuống CUỐI (chỉ afterId): cũng đi qua khoá dự án rồi mới đọc mốc qua tx', async () => {
    const { service, log } = moveRankSetup();
    await service.move('w1', 'u1', 'i1', { version: 3, afterId: 'b' });
    expect(log.slice(0, 3)).toEqual(['begin', 'lock', 'tx-rank-read:b']);
    expect(log.some((l) => l.startsWith('OUTSIDE'))).toBe(false);
  });

  it('kéo lên ĐẦU (chỉ beforeId): cũng đi qua khoá dự án', async () => {
    const { service, log } = moveRankSetup();
    await service.move('w1', 'u1', 'i1', { version: 3, beforeId: 'a' });
    expect(log.slice(0, 3)).toEqual(['begin', 'lock', 'tx-rank-read:a']);
  });

  it('kéo sang cột khác có WIP: thứ tự khoá dự án → khoá cột (WIP) → mốc rank → ghi (cùng thứ tự cột-trước-dòng với mọi đường khác, tránh deadlock khi rebalance)', async () => {
    const { service, log } = moveRankSetup();
    await service.move('w1', 'u1', 'i1', {
      version: 3,
      statusId: 's2',
      boardId: 'b1',
      afterId: 'a',
      beforeId: 'b',
    });
    const at = (x: string) => log.indexOf(x);
    expect(at('lock')).toBeGreaterThan(at('begin'));
    expect(at('wip-lock')).toBeGreaterThan(at('lock'));
    expect(at('tx-rank-read:a')).toBeGreaterThan(at('wip-lock'));
    expect(at('tx-rank-read:b')).toBeGreaterThan(at('wip-lock'));
    expect(at('write')).toBeGreaterThan(at('tx-rank-read:b'));
    expect(at('commit')).toBeGreaterThan(at('write'));
  });

  it('move có mốc nhưng KHÔNG có WIP (cùng cột): vẫn khoá dự án rồi đọc mốc, KHÔNG khoá cột', async () => {
    const { service, log } = moveRankSetup();
    await service.move('w1', 'u1', 'i1', { version: 3, afterId: 'a', beforeId: 'b' });
    expect(log).not.toContain('wip-lock');
    expect(log.slice(0, 4)).toEqual(['begin', 'lock', 'tx-rank-read:a', 'tx-rank-read:b']);
  });

  it('WIP vẫn chặn đúng khi có mốc rank: cột đầy => 422, không ghi, không emit (khoá dự án đã nhả do rollback)', async () => {
    const { service, log, events, tx } = moveRankSetup({ count: 2 });
    await expect(
      service.move('w1', 'u1', 'i1', {
        version: 3,
        statusId: 's2',
        boardId: 'b1',
        afterId: 'a',
        beforeId: 'b',
      }),
    ).rejects.toMatchObject({ response: { code: 'WIP_LIMIT_REACHED' } });
    expect(log).toEqual(['begin', 'lock', 'wip-lock']); // WIP chặn TRƯỚC khi đọc mốc/rebalance
    expect(log).not.toContain('write');
    expect(log).not.toContain('commit');
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('không có mốc rank: KHÔNG khoá dự án, không đọc mốc, giữ rank cũ', async () => {
    const { service, log, tx } = moveRankSetup();
    await service.move('w1', 'u1', 'i1', { version: 3 });
    expect(tx.project.update).not.toHaveBeenCalled();
    expect(log.some((l) => l.includes('rank-read'))).toBe(false);
    const where = (tx.issue.updateMany.mock.calls[0] as unknown as [{ data: { rank: string } }])[0];
    expect(where.data.rank).toBe('n');
  });

  it('có mốc ⇒ transaction timeout 30s (có thể rebalance cả dự án); không mốc ⇒ mặc định', async () => {
    const withNeighbor = moveRankSetup();
    await withNeighbor.service.move('w1', 'u1', 'i1', { version: 3, afterId: 'a' });
    expect(withNeighbor.transaction.mock.calls[0]![1]).toEqual({ timeout: 30_000 });
    const without = moveRankSetup();
    await without.service.move('w1', 'u1', 'i1', { version: 3 });
    expect(without.transaction.mock.calls[0]![1]).toBeUndefined();
  });
});

describe('IssuesService.move — rebalance trong tx, sự kiện chỉ phát sau commit (R3)', () => {
  it('hết chỗ chèn: rebalance chạy trong tx (sau khoá), PROJECT_RANKS_REBALANCED chỉ phát SAU commit', async () => {
    const { service, log, events } = moveRankSetup({ ranks: { a: ['n', 'i'], b: ['n0', 'r'] } });
    await service.move('w1', 'u1', 'i1', { version: 3, afterId: 'a', beforeId: 'b' });
    expect(log.indexOf('rebalance-update')).toBeGreaterThan(log.indexOf('lock'));
    expect(log.indexOf('emit-rebalanced')).toBeGreaterThan(log.indexOf('commit'));
    expect(log.indexOf('rebalance-update')).toBeLessThan(log.indexOf('commit'));
    expect(
      events.emit.mock.calls.filter((c) => c[0] === DOMAIN_EVENTS.PROJECT_RANKS_REBALANCED),
    ).toHaveLength(1);
  });

  it('rebalance + WIP: khoá dự án → khoá cột → rebalance (khoá các dòng) — không khoá dòng trước khoá cột', async () => {
    const { service, log } = moveRankSetup({ ranks: { a: ['n', 'i'], b: ['n0', 'r'] } });
    await service.move('w1', 'u1', 'i1', {
      version: 3,
      statusId: 's2',
      boardId: 'b1',
      afterId: 'a',
      beforeId: 'b',
    });
    expect(log.indexOf('lock')).toBeLessThan(log.indexOf('wip-lock'));
    expect(log.indexOf('wip-lock')).toBeLessThan(log.indexOf('rebalance-update'));
  });

  it('rebalance xong nhưng ghi thất bại (OCC) => rollback, KHÔNG phát PROJECT_RANKS_REBALANCED', async () => {
    const { service, log, events, tx } = moveRankSetup({
      ranks: { a: ['n', 'i'], b: ['n0', 'r'] },
    });
    tx.issue.updateMany = vi.fn(() => Promise.resolve({ count: 0 }));
    await expect(
      service.move('w1', 'u1', 'i1', { version: 3, afterId: 'a', beforeId: 'b' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(log).toContain('rebalance-update');
    expect(log).not.toContain('commit');
    expect(log).not.toContain('emit-rebalanced');
    expect(events.emit).not.toHaveBeenCalled();
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
      findMany: vi.fn(() => Promise.resolve([])), // idsWithLiveChildren: không có việc con
    },
    issueHistory: { createMany: vi.fn() },
    user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: false })) }, // nhánh kiểm system admin của luật hạn
  });
  it('Quản trị dự án (project:admin) ghi đè điểm => storyPoints + pointsManual=true', async () => {
    const t = tx(issueRow({ storyPoints: 5, pointsManual: true, version: 4 }));
    const { service, rbac } = makeService(t);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:edit', 'project:admin']));
    const dto = await service.update('w1', 'u2', 'i1', { version: 3, storyPoints: 5 });
    expect(dto.storyPoints).toBe(5);
    expect(t.issue.updateMany.mock.calls[0]![0].data).toMatchObject({
      storyPoints: 5,
      pointsManual: true,
    });
  });
  it('SA (isSystemAdmin) ghi đè điểm dù không có project:admin', async () => {
    const t = tx(issueRow({ storyPoints: 13, pointsManual: true, version: 4 }));
    const { service, rbac } = makeService(t, {
      user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: true })) },
    });
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:edit']));
    await service.update('w1', 'u2', 'i1', { version: 3, storyPoints: 13 });
    expect(t.issue.updateMany.mock.calls[0]![0].data).toMatchObject({
      storyPoints: 13,
      pointsManual: true,
    });
  });
  it('người khác (chỉ issue:edit) gửi điểm KHÁC hiện tại => 403 POINTS_OVERRIDE_FORBIDDEN, chưa ghi gì', async () => {
    const t = tx(issueRow());
    const { service, rbac } = makeService(t);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:edit']));
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, storyPoints: 5 }),
    ).rejects.toMatchObject({ status: 403, code: 'POINTS_OVERRIDE_FORBIDDEN' });
    expect(t.issue.updateMany).not.toHaveBeenCalled();
  });
  it('người khác gửi lại ĐÚNG điểm hiện có (form gửi cả đối tượng) => không phải sửa điểm, không 403, không đổi điểm', async () => {
    const t = tx(issueRow({ storyPoints: 4, version: 4 }));
    t.issue.findFirst.mockResolvedValue(
      issueRow({ reporterId: 'u1', createdById: 'u1', storyPoints: 4 }),
    );
    const { service, rbac } = makeService(t);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:edit']));
    await service.update('w1', 'u1', 'i1', { version: 3, storyPoints: 4, summary: 'x' });
    const data = t.issue.updateMany.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty('storyPoints');
    expect(data).not.toHaveProperty('pointsManual');
  });
  it('ghi đè phải là số nguyên 0–100: 2.5 / 101 / null => 422, chưa ghi', async () => {
    const t = tx(issueRow());
    // điểm hiện tại 4: `null` là thay đổi thật (gửi lại đúng 4 thì không phải ghi đè)
    t.issue.findFirst.mockResolvedValue(
      issueRow({ reporterId: 'u1', createdById: 'u1', storyPoints: 4 }),
    );
    const { service, rbac } = makeService(t);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['project:admin']));
    for (const storyPoints of [2.5, 101, -1, null])
      await expect(
        service.update('w1', 'u1', 'i1', { version: 3, storyPoints }),
      ).rejects.toMatchObject({ status: 422 });
    expect(t.issue.updateMany).not.toHaveBeenCalled();
  });
  it('Quản trị dự án/SA gửi lại ĐÚNG điểm hiện có (việc chưa chỉnh tay) => không bật pointsManual, không ghi điểm', async () => {
    const t = tx(issueRow({ storyPoints: 4, version: 4 }));
    t.issue.findFirst.mockResolvedValue(
      issueRow({ reporterId: 'u1', createdById: 'u1', storyPoints: 4, pointsManual: false }),
    );
    const { service, rbac } = makeService(t);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:edit', 'project:admin']));
    await service.update('w1', 'u1', 'i1', { version: 3, storyPoints: 4, summary: 'x' });
    const data = t.issue.updateMany.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty('storyPoints');
    expect(data).not.toHaveProperty('pointsManual');
    // đối chứng: điểm KHÁC hiện tại thì mới là ghi đè
    await service.update('w1', 'u1', 'i1', { version: 3, storyPoints: 5 });
    expect(t.issue.updateMany.mock.calls[1]![0].data).toMatchObject({
      storyPoints: 5,
      pointsManual: true,
    });
  });
  it('Epic không ghi đè tay được => 422', async () => {
    const t = tx(issueRow());
    t.issue.findFirst.mockResolvedValue(
      issueRow({ type: { ...issueRow().type, key: 'EPIC' }, reporterId: 'u1' }),
    );
    const { service, rbac } = makeService(t);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['project:admin']));
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, storyPoints: 5 }),
    ).rejects.toMatchObject({ status: 422 });
    expect(t.issue.updateMany).not.toHaveBeenCalled();
  });
  it(':own — việc của người khác => 403 (quy tắc sở hữu cũ) trước cả kiểm điểm', async () => {
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
      aggregate: vi.fn(() => Promise.resolve({ _sum: { storyPoints: 0 } })),
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
  it('Quản trị dự án: storyPoints cho lô => ghi điểm + pointsManual=true', async () => {
    const t = b7Tx();
    const { service, rbac } = makeService(t);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:edit', 'project:admin']));
    const r = await service.bulkUpdate('w1', 'u2', {
      projectId: 'p1',
      items,
      patch: { storyPoints: 8 },
    });
    expect(r.updated).toHaveLength(2);
    expect(t.issue.updateMany.mock.calls[0]![0].data).toMatchObject({
      storyPoints: 8,
      pointsManual: true,
    });
  });
  it('storyPoints (chỉ issue:edit): 403 POINTS_OVERRIDE_FORBIDDEN cho cả lô, chưa ghi gì', async () => {
    const t = b7Tx();
    const { service, rbac } = makeService(t);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:edit']));
    await expect(
      service.bulkUpdate('w1', 'u2', { projectId: 'p1', items, patch: { storyPoints: 8 } }),
    ).rejects.toMatchObject({ status: 403, code: 'POINTS_OVERRIDE_FORBIDDEN' });
    expect(t.issue.updateMany).not.toHaveBeenCalled();
  });
  it('storyPoints với :own: một việc của người khác => 403 cả lô, chưa ghi', async () => {
    const t = b7Tx(); // rowsAB: reporterId/createdById = u1, assigneeId null
    const { service, rbac } = makeService(t);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:edit', 'project:admin']));
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
  it('storyPoints: null (hay số lẻ) từ Quản trị dự án => 422 (muốn tính lại dùng "Tính lại theo công thức"), chưa ghi', async () => {
    const t = b7Tx({
      issue: {
        ...b7Tx().issue,
        // điểm hiện tại 4: `null`/2.5 là thay đổi thật (gửi lại đúng 4 thì không phải ghi đè)
        findMany: vi.fn(() =>
          Promise.resolve([
            issueRow({ id: 'a', storyPoints: 4 }),
            issueRow({ id: 'b', storyPoints: 4 }),
          ]),
        ),
      },
    });
    const { service, rbac } = makeService(t);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['project:admin']));
    for (const storyPoints of [null, 2.5])
      await expect(
        service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { storyPoints } }),
      ).rejects.toMatchObject({ status: 422 });
    expect(t.issue.updateMany).not.toHaveBeenCalled();
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

  it('update: bằng nhau hợp lệ; xoá Ngày bắt đầu luôn được; chỉ có một ngày thì không kiểm', async () => {
    const tx = schedTx({ dueDate: new Date(D18) });
    const { service } = makeService(tx);
    await service.update('w1', 'u1', 'i1', { version: 3, startDate: D18 });
    await service.update('w1', 'u1', 'i1', { version: 3, startDate: null });
    const tx2 = schedTx({ startDate: new Date(D20) });
    const svc2 = makeService(tx2).service;
    await svc2.update('w1', 'u1', 'i1', { version: 3, summary: 'không đụng ngày' });
    expect(tx.issue.updateMany).toHaveBeenCalledTimes(2);
    expect(tx2.issue.updateMany).toHaveBeenCalledTimes(1);
  });

  it('update: dữ liệu CŨ sai thứ tự (start > due) — sửa trường khác vẫn được; chỉ khi đụng ngày mới bị kiểm', async () => {
    const tx = schedTx({ startDate: new Date(D20), dueDate: new Date(D18) });
    const { service } = makeService(tx);
    await service.update('w1', 'u1', 'i1', { version: 3, summary: 'sửa tiêu đề' });
    await service.update(
      'w1',
      'u1',
      'i1',
      { version: 3, summary: 'qua automation' },
      { automationDepth: 1 },
    );
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

// eslint-disable-next-line max-lines-per-function -- một describe dùng chung bộ dựng tx cho mọi ca của cây việc
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

  describe('parentId trỏ Epic => chuyển thành epicId (như Jira)', () => {
    it('update: parentId = Epic => ghi epicId = Epic và parentId = null, không 422', async () => {
      const tx = treeTx(issueRow({ parentId: 'old' }), {
        e9: row({ type: T.epic }),
        old: row(),
      });
      await expect(patch(tx, { parentId: 'e9' })).resolves.toBeDefined();
      expect(tx.issue.updateMany.mock.calls[0]![0].data).toMatchObject({
        epicId: 'e9',
        parentId: null,
      });
    });

    it('update: parentId = Epic kèm epicId KHÁC => 422 PARENT_CANNOT_BE_EPIC, không ghi', async () => {
      const tx = treeTx(issueRow(), { e9: row({ type: T.epic }), e2: row({ type: T.epic }) });
      await expect(patch(tx, { parentId: 'e9', epicId: 'e2' })).rejects.toMatchObject({
        status: 422,
        code: 'PARENT_CANNOT_BE_EPIC',
      });
      expect(tx.issue.updateMany).not.toHaveBeenCalled();
    });

    it('update: parentId = Epic kèm đúng epicId đó => như gắn vào Epic', async () => {
      const tx = treeTx(issueRow(), { e9: row({ type: T.epic }) });
      await expect(patch(tx, { parentId: 'e9', epicId: 'e9' })).resolves.toBeDefined();
      expect(tx.issue.updateMany.mock.calls[0]![0].data).toMatchObject({
        epicId: 'e9',
        parentId: null,
      });
    });

    it('create: parentId = Epic => tạo với epicId = Epic, parentId = null', async () => {
      const { tx, created } = createTxFor({ e9: row({ type: T.epic }) });
      await makeService(tx).service.create('w1', 'u1', {
        projectId: 'p1',
        typeId: 't1',
        summary: 's',
        descriptionFormat: 'MARKDOWN',
        parentId: 'e9',
      });
      expect(created.mock.calls[0]![0].data).toMatchObject({ epicId: 'e9', parentId: null });
    });
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

describe('IssuesService.assertDueNotBeforeCreated (logbug #10)', () => {
  const svc = new IssuesService(
    {} as never,
    { emit: vi.fn() } as never,
    {} as never,
    undefined,
    undefined,
    undefined,
    {} as never,
  ) as unknown as {
    assertDueNotBeforeCreated(due: string | null, created: Date | null): void;
  };
  it('hạn trước ngày tạo (giờ VN) bị chặn bằng thông báo tiếng Việt', () => {
    const created = new Date('2026-11-03T10:00:00Z'); // 03/11 17:00 VN
    expect(() => svc.assertDueNotBeforeCreated('2026-11-02T00:00:00.000Z', created)).toThrow(
      /không được trước ngày tạo/,
    );
  });
  it('hạn đúng ngày tạo hoặc sau đó, hoặc không có hạn → hợp lệ', () => {
    const created = new Date('2026-11-03T10:00:00Z');
    expect(() => svc.assertDueNotBeforeCreated('2026-11-03T00:00:00.000Z', created)).not.toThrow();
    expect(() => svc.assertDueNotBeforeCreated('2026-12-01T00:00:00.000Z', created)).not.toThrow();
    expect(() => svc.assertDueNotBeforeCreated(null, created)).not.toThrow();
  });
});

describe('IssuesService.assertNotBlockedForDone (logbug #23, phương án 3)', () => {
  const make = (links: Array<{ targetIssueId: string; source: { key: string } }>) => {
    const findMany = vi.fn(() => Promise.resolve(links));
    const svc = new IssuesService(
      { issueLink: { findMany } } as never,
      { emit: vi.fn() } as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      {} as never,
    ) as unknown as {
      assertNotBlockedForDone(i: Array<{ id: string; key: string }>): Promise<void>;
    };
    return { svc, findMany };
  };
  it('còn việc chặn chưa DONE → báo tên mã người chặn', async () => {
    const { svc } = make([
      { targetIssueId: 'i1', source: { key: 'P-9' } },
      { targetIssueId: 'i1', source: { key: 'P-8' } },
    ]);
    await expect(svc.assertNotBlockedForDone([{ id: 'i1', key: 'P-1' }])).rejects.toThrow(
      /P-1 đang bị chặn bởi P-9, P-8/,
    );
  });
  it('không có liên kết chặn chưa xong → cho qua; chỉ tra liên kết Blocks còn sống & chưa DONE', async () => {
    const { svc, findMany } = make([]);
    await expect(svc.assertNotBlockedForDone([{ id: 'i1', key: 'P-1' }])).resolves.toBeUndefined();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source: { deletedAt: null, status: { category: { not: 'DONE' } } },
        }) as unknown,
      }),
    );
  });
  it('danh sách rỗng không truy vấn', async () => {
    const { svc, findMany } = make([]);
    await svc.assertNotBlockedForDone([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Điểm tự tính theo Loại × Độ khó × Ưu tiên + tổng điểm Epic + ghi đè tay (spec 2026-11-04, mục 1)
// ---------------------------------------------------------------------------------------------------------------------
const typeBug = { ...issueRow().type, id: 't-bug', name: 'Bug', key: 'BUG' };
const epicLike = (over: Record<string, unknown> = {}) => ({
  projectId: 'p1',
  epicId: null,
  type: { key: 'EPIC', hierarchyLevel: 1 },
  ...over,
});

/** Điều kiện tổng Epic: việc cấp trên = không cha, hoặc cha đã xoá mềm (việc con mồ côi). */
const epicTopLevelWhere = (epicId: string) => ({
  epicId,
  deletedAt: null,
  OR: [{ parentId: null }, { parent: { deletedAt: { not: null } } }],
});

/** Tx cho update/reset/xoá/khôi phục: `sums` = tổng điểm việc con theo epicId; `epics` = hàng epic (đọc `storyPoints`). */
function pTx(
  current: Record<string, unknown>,
  after: Record<string, unknown>,
  o: {
    epics?: Record<string, Record<string, unknown>>;
    sums?: Record<string, number>;
    typeKeys?: Record<string, string>;
    priorityNames?: Record<string, string>;
    /** Việc cha (id) → điểm các việc con chưa xoá của nó (cho `rollupParents` / kiểm "có việc con"). */
    children?: Record<string, number[]>;
    /** Việc cha cũng có thể là hàng khác `i1` (vd. cha của việc đang sửa). */
    rows?: Record<string, Record<string, unknown>>;
  } = {},
) {
  return {
    issue: {
      findFirst: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === 'i1' ? current : (o.epics?.[where.id] ?? o.rows?.[where.id] ?? null),
        ),
      ),
      findFirstOrThrow: vi.fn(() => Promise.resolve(after)),
      // `idsWithLiveChildren`: where.parentId.in → mỗi cha có việc con được trả một dòng
      findMany: vi.fn((a?: { where?: { parentId?: { in: string[] } } }) =>
        Promise.resolve(
          (a?.where?.parentId?.in ?? [])
            .filter((id) => (o.children?.[id]?.length ?? 0) > 0)
            .map((id) => ({ parentId: id })),
        ),
      ),
      updateMany: vi.fn((_a: { where: { id: string }; data: Record<string, unknown> }) =>
        Promise.resolve({ count: 1 }),
      ),
      aggregate: vi.fn(({ where }: { where: { epicId?: string; parentId?: string } }) => {
        // việc cha: cộng điểm các việc con; Epic: tổng đặt sẵn theo epicId
        if (where.parentId !== undefined && where.epicId === undefined) {
          const kids = o.children?.[where.parentId] ?? [];
          return Promise.resolve({
            _sum: { storyPoints: kids.length ? kids.reduce((a, b) => a + b, 0) : null },
            _count: { _all: kids.length },
          });
        }
        return Promise.resolve({ _sum: { storyPoints: o.sums?.[where.epicId!] ?? 0 } });
      }),
    },
    issueHistory: { createMany: vi.fn() },
    issueType: {
      findFirst: vi.fn(() => Promise.resolve({ id: 'x' })),
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({ key: o.typeKeys?.[where.id] ?? 'TASK' }),
      ),
    },
    priority: {
      findFirst: vi.fn(() => Promise.resolve({ id: 'x' })),
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({ name: o.priorityNames?.[where.id] ?? 'Medium' }),
      ),
    },
  };
}
/** Dữ liệu của lần `updateMany` đầu (ghi chính việc i1). */
const firstData = (t: ReturnType<typeof pTx>) => t.issue.updateMany.mock.calls[0]![0].data;
/** Lần `updateMany` ghi Epic `id` (tổng điểm). */
const epicWrite = (t: ReturnType<typeof pTx>, id: string) =>
  t.issue.updateMany.mock.calls.find((c) => c[0].where.id === id)?.[0];

describe('IssuesService — điểm tự tính: create / createWithin', () => {
  const input = {
    projectId: 'p1',
    typeId: 't-bug',
    summary: 's',
    descriptionFormat: 'MARKDOWN' as const,
    priorityId: 'pr-high',
  };
  function cTx(typeKey = 'BUG', priorityName = 'High') {
    const { tx, created } = createTx(WF_DEFAULT, { e1: epicLike() });
    tx.issueType.findUnique = vi.fn(() => Promise.resolve({ key: typeKey, name: typeKey }));
    (tx as Record<string, unknown>).priority = {
      findFirst: vi.fn(() => Promise.resolve({ id: 'pr-high' })),
      findUnique: vi.fn(() => Promise.resolve({ name: priorityName })),
    };
    const updateMany = vi.fn((_a: { where: { id: string }; data: unknown }) =>
      Promise.resolve({ count: 1 }),
    );
    (tx.issue as Record<string, unknown>).updateMany = updateMany;
    (tx.issue as Record<string, unknown>).aggregate = vi.fn(() =>
      Promise.resolve({ _sum: { storyPoints: 3 } }),
    );
    const data = () => created.mock.calls[0]![0].data;
    return { tx, created, data, updateMany };
  }

  it('Bug · Khó · High, không gửi điểm => 9, pointsManual=false', async () => {
    const { tx, data } = cTx();
    await makeService(tx).service.create('w1', 'u1', { ...input, difficulty: 'HARD' });
    expect(data()).toMatchObject({ storyPoints: 9, difficulty: 'HARD', pointsManual: false });
  });
  it('không gửi độ khó => Trung bình; Task · Medium · TB = 2×2×1 = 4', async () => {
    const { tx, data } = cTx('TASK', 'Medium');
    await makeService(tx).service.create('w1', 'u1', input);
    expect(data()).toMatchObject({ storyPoints: 4, difficulty: 'MEDIUM', pointsManual: false });
  });
  it('người không có quyền ghi đè gửi storyPoints => bị bỏ qua, điểm theo công thức', async () => {
    const { tx, data } = cTx('TASK', 'Medium');
    await makeService(tx).service.create('w1', 'u1', { ...input, storyPoints: 50 });
    expect(data()).toMatchObject({ storyPoints: 4, pointsManual: false });
  });
  it('Quản trị dự án gửi storyPoints => điểm chỉnh tay (nguyên 0–100); số lẻ => 422', async () => {
    const { tx, data } = cTx('TASK', 'Medium');
    const { service, rbac } = makeService(tx);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:create', 'project:admin']));
    await service.create('w1', 'u1', { ...input, storyPoints: 7 });
    expect(data()).toMatchObject({ storyPoints: 7, pointsManual: true });
    await expect(service.create('w1', 'u1', { ...input, storyPoints: 2.5 })).rejects.toMatchObject({
      status: 422,
    });
  });
  it('Epic mới: điểm = tổng việc con = 0, không chỉnh tay dù gửi storyPoints', async () => {
    const { tx, data } = cTx('EPIC', 'High');
    const { service, rbac } = makeService(tx);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['project:admin']));
    await service.create('w1', 'u1', { ...input, storyPoints: 9 });
    expect(data()).toMatchObject({ storyPoints: 0, pointsManual: false });
  });
  it('createWithin (import): bỏ qua storyPoints gửi kèm, không hỏi quyền, tính theo công thức', async () => {
    const { tx, data } = cTx('BUG', 'High');
    const { service, rbac } = makeService(tx);
    await service.createWithin(
      tx as never,
      'w1',
      'u1',
      { ...input, difficulty: 'HARD', storyPoints: 80 },
      [],
    );
    expect(data()).toMatchObject({ storyPoints: 9, pointsManual: false });
    expect(rbac.getEffectivePermissions).not.toHaveBeenCalled();
  });
  it('gắn vào Epic => tổng điểm Epic được tính lại trong cùng transaction', async () => {
    const { tx, created, updateMany } = cTx('BUG', 'High');
    // createTx.created trả issueRow() không có epicId → ép epicId của hàng vừa tạo
    created.mockResolvedValue(issueRow({ epicId: 'e1', storyPoints: 3 }));
    const baseFindFirst = tx.issue.findFirst;
    tx.issue.findFirst = vi.fn((a: { where: { id?: string } }) =>
      a.where.id === 'e1' ? Promise.resolve(epicLike({ storyPoints: 0 })) : baseFindFirst(a),
    );
    (tx.issue as Record<string, unknown>).findMany = vi.fn(
      (a: { where: { id: { in: string[] } } }) =>
        Promise.resolve(a.where.id.in.map((id) => issueRow({ id }))),
    );
    const { service, events } = makeService(tx);
    await service.create('w1', 'u1', { ...input, epicId: 'e1' });
    const calls = updateMany.mock.calls;
    // sự kiện của Epic phát SAU commit (không chờ được từ create) — chờ tới khi phát
    await vi.waitFor(() =>
      expect(events.emit).toHaveBeenCalledWith(
        DOMAIN_EVENTS.ISSUE_UPDATED,
        expect.objectContaining({
          issue: expect.objectContaining({ id: 'e1' }) as unknown,
          changedFields: ['storyPoints'],
          bulk: true,
        }),
      ),
    );
    expect(calls[0]![0]).toEqual({
      where: { id: 'e1', deletedAt: null },
      data: { storyPoints: 3, version: { increment: 1 } },
    });
  });
});

describe('IssuesService — điểm tự tính: update — tự tính lại', () => {
  const bugHard = (over: Record<string, unknown> = {}) =>
    issueRow({
      typeId: 't-bug',
      type: typeBug,
      difficulty: 'HARD',
      priorityId: 'pr-med',
      priority: { id: 'pr-med', name: 'Medium' },
      storyPoints: 6,
      ...over,
    });

  it('đổi Ưu tiên của việc không chỉnh tay => tính lại (Bug · Khó · High = 9)', async () => {
    const t = pTx(bugHard(), bugHard({ priorityId: 'pr-high', storyPoints: 9, version: 4 }), {
      typeKeys: { 't-bug': 'BUG' },
      priorityNames: { 'pr-high': 'High' },
    });
    await makeService(t).service.update('w1', 'u1', 'i1', { version: 3, priorityId: 'pr-high' });
    expect(firstData(t)).toMatchObject({ priorityId: 'pr-high', storyPoints: 9 });
  });
  it('đổi Độ khó => tính lại (Task · Dễ → Khó, Medium: 2 → 6)', async () => {
    const cur = issueRow({ difficulty: 'EASY', storyPoints: 2 });
    const t = pTx(cur, issueRow({ difficulty: 'HARD', storyPoints: 6, version: 4 }));
    await makeService(t).service.update('w1', 'u1', 'i1', { version: 3, difficulty: 'HARD' });
    expect(firstData(t)).toMatchObject({ difficulty: 'HARD', storyPoints: 6 });
  });
  it('đổi Loại => tính lại theo điểm gốc của loại mới (Task → Story, Medium: 4 → 6)', async () => {
    const cur = issueRow({ storyPoints: 4 });
    const t = pTx(cur, issueRow({ storyPoints: 6, version: 4 }), {
      typeKeys: { 't-story': 'STORY' },
    });
    await makeService(t).service.update('w1', 'u1', 'i1', { version: 3, typeId: 't-story' });
    expect(firstData(t)).toMatchObject({ typeId: 't-story', storyPoints: 6 });
  });
  it('việc đã chỉnh tay giữ điểm khi đổi Ưu tiên/Độ khó/Loại', async () => {
    const cur = bugHard({ pointsManual: true, storyPoints: 20 });
    const t = pTx(cur, bugHard({ pointsManual: true, storyPoints: 20, version: 4 }), {
      typeKeys: { 't-bug': 'BUG' },
      priorityNames: { 'pr-high': 'High' },
    });
    await makeService(t).service.update('w1', 'u1', 'i1', {
      version: 3,
      priorityId: 'pr-high',
      difficulty: 'EASY',
    });
    expect(firstData(t)).not.toHaveProperty('storyPoints');
    expect(firstData(t)).not.toHaveProperty('pointsManual');
  });
  it('sửa trường khác (tiêu đề) không tra loại/ưu tiên và không đụng điểm', async () => {
    const t = pTx(issueRow(), issueRow({ summary: 'mới', version: 4 }));
    await makeService(t).service.update('w1', 'u1', 'i1', { version: 3, summary: 'mới' });
    expect(firstData(t)).not.toHaveProperty('storyPoints');
    expect(t.issueType.findUnique).not.toHaveBeenCalled();
    expect(t.issue.aggregate).not.toHaveBeenCalled();
  });
  it('đổi sang loại Epic => điểm = tổng việc con, bỏ chỉnh tay', async () => {
    const cur = issueRow({ pointsManual: true, storyPoints: 20 });
    const t = pTx(cur, issueRow({ storyPoints: 7, version: 4 }), {
      typeKeys: { 't-epic': 'EPIC' },
      sums: { i1: 7 },
    });
    await makeService(t).service.update('w1', 'u1', 'i1', { version: 3, typeId: 't-epic' });
    expect(firstData(t)).toMatchObject({ typeId: 't-epic', storyPoints: 7, pointsManual: false });
  });
});

describe('IssuesService — điểm tự tính: Epic — tổng điểm việc con', () => {
  it('đổi epicId A → B (việc 3 điểm): Epic A giảm, Epic B tăng, cả hai tăng version; phát cập nhật cho cả hai', async () => {
    const cur = issueRow({ epicId: 'eA', storyPoints: 3 });
    const after = issueRow({ epicId: 'eB', storyPoints: 3, version: 4 });
    const t = pTx(cur, after, {
      epics: { eA: epicLike({ storyPoints: 10 }), eB: epicLike({ storyPoints: 10 }) },
      sums: { eA: 7, eB: 13 }, // tổng SAU khi việc đã chuyển
    });
    t.issue.findMany.mockResolvedValue([issueRow({ id: 'eA' })] as never);
    const { service, events } = makeService(t);
    await service.update('w1', 'u1', 'i1', { version: 3, epicId: 'eB' });
    expect(epicWrite(t, 'eA')).toEqual({
      where: { id: 'eA', deletedAt: null },
      data: { storyPoints: 7, version: { increment: 1 } },
    });
    expect(epicWrite(t, 'eB')).toEqual({
      where: { id: 'eB', deletedAt: null },
      data: { storyPoints: 13, version: { increment: 1 } },
    });
    expect(events.emit).toHaveBeenCalledWith(
      DOMAIN_EVENTS.ISSUE_UPDATED,
      // Do hệ thống suy ra từ việc con: `bulk: true` để người theo dõi/tự động hoá/Telegram bỏ qua (realtime vẫn đi).
      expect.objectContaining({ changedFields: ['storyPoints'], bulk: true }),
    );
  });
  it('điểm việc đổi (cùng Epic) => chỉ tính lại Epic đó; Epic không đổi tổng thì không ghi', async () => {
    const cur = issueRow({ epicId: 'eA', storyPoints: 4 });
    const after = issueRow({ epicId: 'eA', storyPoints: 6, version: 4 });
    const t = pTx(cur, after, {
      epics: { eA: epicLike({ storyPoints: 6 }) },
      sums: { eA: 6 }, // Epic đã đúng tổng
    });
    await makeService(t).service.update('w1', 'u1', 'i1', { version: 3, difficulty: 'HARD' });
    expect(epicWrite(t, 'eA')).toBeUndefined();
    expect(t.issue.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: epicTopLevelWhere('eA') }),
    );
  });
  it('xoá việc (có epicId) => trừ điểm khỏi Epic trong cùng transaction', async () => {
    const t = pTx(issueRow({ epicId: 'eA', storyPoints: 3 }), issueRow(), {
      epics: { eA: epicLike({ storyPoints: 10 }) },
      sums: { eA: 7 },
    });
    await makeService(t).service.softDelete('w1', 'u1', 'i1');
    expect(t.issue.updateMany.mock.calls[0]![0].data).toMatchObject({
      deletedAt: expect.any(Date) as unknown,
    });
    expect(epicWrite(t, 'eA')?.data).toMatchObject({ storyPoints: 7 });
  });
  it('xoá việc không thuộc Epic => không tính tổng', async () => {
    const t = pTx(issueRow(), issueRow());
    await makeService(t).service.softDelete('w1', 'u1', 'i1');
    expect(t.issue.aggregate).not.toHaveBeenCalled();
  });
  it('khôi phục CHÍNH một Epic => tính lại tổng của nó (việc con đổi lúc nó nằm trong Thùng rác)', async () => {
    const epicType = { ...issueRow().type, key: 'EPIC' };
    const t = pTx(issueRow({ deletedAt: new Date(), type: epicType, storyPoints: 5 }), issueRow(), {
      epics: { i1: epicLike({ storyPoints: 5 }) },
      sums: { i1: 9 },
    });
    await makeService(t).service.restore('w1', 'u1', 'p1', 'i1');
    // lần ghi tổng của rollup (where.deletedAt = null), không phải UPDATE khôi phục (deletedAt: { not: null })
    const rollup = (
      t.issue.updateMany.mock.calls as unknown as Array<
        [{ where: { deletedAt: unknown }; data: unknown }]
      >
    ).find((c) => c[0].where.deletedAt === null);
    expect(rollup?.[0].data).toMatchObject({ storyPoints: 9 });
  });
  it('khôi phục việc (Epic còn sống) => cộng điểm lại; Epic đã xoá (bị gỡ epicId) => không tính', async () => {
    const deleted = { deletedAt: new Date(), epicId: 'eA', storyPoints: 3 };
    const alive = pTx(issueRow(deleted), issueRow(), {
      epics: { eA: epicLike({ storyPoints: 7 }) },
      sums: { eA: 10 },
    });
    // lần đọc kiểm "cha/epic còn sống" (select id) khác lần đọc lại Epic để phát sự kiện (include)
    alive.issue.findMany.mockImplementation(((a: { include?: unknown }) =>
      Promise.resolve(a.include ? [issueRow({ id: 'eA' })] : [{ id: 'eA' }])) as never);
    const { service, events } = makeService(alive);
    await service.restore('w1', 'u1', 'p1', 'i1');
    expect(epicWrite(alive, 'eA')?.data).toMatchObject({ storyPoints: 10 });
    expect(events.emit).toHaveBeenCalledWith(
      DOMAIN_EVENTS.ISSUE_UPDATED,
      expect.objectContaining({ changedFields: ['storyPoints'], bulk: true }),
    );

    const gone = pTx(issueRow(deleted), issueRow());
    gone.issue.findMany.mockResolvedValue([]); // Epic không còn → restore gỡ epicId
    await makeService(gone).service.restore('w1', 'u1', 'p1', 'i1');
    expect(gone.issue.aggregate).not.toHaveBeenCalled();
  });
});

describe('IssuesService — điểm tự tính: bulkUpdate — Độ khó / Ưu tiên / Epic', () => {
  const rowsTM = () => [
    issueRow({
      id: 'a',
      difficulty: 'MEDIUM',
      storyPoints: 4,
      type: { ...issueRow().type, key: 'TASK' },
    }),
    issueRow({
      id: 'b',
      difficulty: 'MEDIUM',
      storyPoints: 20,
      pointsManual: true,
      type: { ...issueRow().type, key: 'TASK' },
    }),
  ];
  const bulkItems = [
    { id: 'a', version: 3 },
    { id: 'b', version: 3 },
  ];
  const bTx = (extra: Record<string, unknown> = {}) =>
    b7Tx({
      issue: { ...b7Tx().issue, findMany: vi.fn(() => Promise.resolve(rowsTM())) },
      ...extra,
    });

  it('Quản trị dự án gửi lại ĐÚNG điểm hiện có: việc chưa chỉnh tay không bật pointsManual; chỉ việc có điểm khác bị ghi đè', async () => {
    const rowsAt = (a: number, b: number) =>
      b7Tx({
        issue: {
          ...b7Tx().issue,
          findMany: vi.fn(() =>
            Promise.resolve([
              issueRow({ id: 'a', storyPoints: a }),
              issueRow({ id: 'b', storyPoints: b }),
            ]),
          ),
        },
      });
    // cả lô đã đúng điểm 4 → không có gì để ghi
    const same = rowsAt(4, 4);
    const m1 = makeService(same);
    m1.rbac.getEffectivePermissions.mockResolvedValue(new Set(['project:admin']));
    await m1.service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { storyPoints: 4 } });
    expect(same.issue.updateMany).not.toHaveBeenCalled();
    // lô lẫn: a đã 4 (bỏ qua), b đang 6 (ghi đè thành 4, bật cờ)
    const mixed = rowsAt(4, 6);
    const m2 = makeService(mixed);
    m2.rbac.getEffectivePermissions.mockResolvedValue(new Set(['project:admin']));
    await m2.service.bulkUpdate('w1', 'u1', { projectId: 'p1', items, patch: { storyPoints: 4 } });
    // (lần ghi thứ hai nếu có là cộng lại tổng Epic của mock, không phải ghi việc)
    const rowWrites = (
      mixed.issue.updateMany.mock.calls as unknown as Array<[{ where: { id: string } }]>
    ).filter((c) => ['a', 'b'].includes(c[0].where.id));
    expect(rowWrites).toHaveLength(1);
    expect(rowWrites[0]![0]).toMatchObject({
      where: { id: 'b' },
      data: { storyPoints: 4, pointsManual: true },
    });
  });
  it('patch difficulty: việc không chỉnh tay được tính lại, việc chỉnh tay giữ điểm', async () => {
    const t = bTx();
    await makeService(t).service.bulkUpdate('w1', 'u1', {
      projectId: 'p1',
      items: bulkItems,
      patch: { difficulty: 'HARD' },
    });
    const [a, b] = t.issue.updateMany.mock.calls.map((c) => c[0].data);
    expect(a).toMatchObject({ difficulty: 'HARD', storyPoints: 6 });
    expect(b).toMatchObject({ difficulty: 'HARD' });
    expect(b).not.toHaveProperty('storyPoints');
  });
  it('patch priorityId => tính lại theo tên ưu tiên mới (Medium → High: 4 → 6), tra ưu tiên MỘT lần', async () => {
    const priority = {
      findFirst: vi.fn(() => Promise.resolve({ id: 'pr-high' })),
      findUnique: vi.fn(() => Promise.resolve({ name: 'High' })),
    };
    const t = bTx({ priority });
    await makeService(t).service.bulkUpdate('w1', 'u1', {
      projectId: 'p1',
      items: bulkItems,
      patch: { priorityId: 'pr-high' },
    });
    const [a, b] = t.issue.updateMany.mock.calls.map((c) => c[0].data);
    expect(a).toMatchObject({ priorityId: 'pr-high', storyPoints: 6 });
    expect(b).not.toHaveProperty('storyPoints');
    expect(priority.findUnique).toHaveBeenCalledTimes(1);
  });
  it('Quản trị dự án gửi storyPoints cho lô có Epic => 422, chưa ghi', async () => {
    const t = bTx({
      issue: {
        ...b7Tx().issue,
        findMany: vi.fn(() =>
          Promise.resolve([
            issueRow({ id: 'a', type: { ...issueRow().type, key: 'EPIC' } }),
            issueRow({ id: 'b' }),
          ]),
        ),
      },
    });
    const { service, rbac } = makeService(t);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['project:admin']));
    await expect(
      service.bulkUpdate('w1', 'u1', {
        projectId: 'p1',
        items: bulkItems,
        patch: { storyPoints: 5 },
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(t.issue.updateMany).not.toHaveBeenCalled();
  });
  it('patch epicId => tổng điểm Epic mới được tính lại một lần cho cả lô', async () => {
    const t = bTx();
    await makeService(t).service.bulkUpdate('w1', 'u1', {
      projectId: 'p1',
      items: bulkItems,
      patch: { epicId: 'e1' },
    });
    const aggregates = (
      t.issue.aggregate.mock.calls as unknown as Array<[{ where: { epicId: string } }]>
    ).filter((c) => c[0].where.epicId === 'e1');
    expect(aggregates).toHaveLength(1);
  });
});

describe('IssuesService — điểm tự tính: resetPoints — "Tính lại theo công thức"', () => {
  const manualBug = () =>
    issueRow({
      typeId: 't-bug',
      type: typeBug,
      difficulty: 'HARD',
      priorityId: 'pr-high',
      priority: { id: 'pr-high', name: 'High' },
      pointsManual: true,
      storyPoints: 20,
    });
  it('Quản trị dự án: pointsManual=false và điểm tính lại (9), phát ISSUE_UPDATED', async () => {
    const t = pTx(manualBug(), issueRow({ storyPoints: 9, pointsManual: false, version: 4 }), {
      typeKeys: { 't-bug': 'BUG' },
      priorityNames: { 'pr-high': 'High' },
    });
    const { service, rbac, events } = makeService(t);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['project:admin']));
    const dto = await service.resetPoints('w1', 'u1', 'i1');
    expect(firstData(t)).toMatchObject({ pointsManual: false, storyPoints: 9 });
    expect(dto.pointsManual).toBe(false);
    expect(events.emit).toHaveBeenCalledWith(
      DOMAIN_EVENTS.ISSUE_UPDATED,
      expect.objectContaining({
        changedFields: expect.arrayContaining(['storyPoints', 'pointsManual']) as unknown,
      }),
    );
  });
  it('người không có quyền => 403 POINTS_OVERRIDE_FORBIDDEN, chưa ghi', async () => {
    const t = pTx(manualBug(), issueRow());
    await expect(makeService(t).service.resetPoints('w1', 'u1', 'i1')).rejects.toMatchObject({
      status: 403,
      code: 'POINTS_OVERRIDE_FORBIDDEN',
    });
    expect(t.issue.updateMany).not.toHaveBeenCalled();
  });
  it('Epic => 422 (không có điểm chỉnh tay)', async () => {
    const t = pTx(issueRow({ type: { ...issueRow().type, key: 'EPIC' } }), issueRow());
    const { service, rbac } = makeService(t);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['project:admin']));
    await expect(service.resetPoints('w1', 'u1', 'i1')).rejects.toMatchObject({ status: 422 });
  });
});

describe('IssuesService — điểm tự tính: IssueDto', () => {
  it('trả difficulty, pointsManual và pointsExplain ("Bug · Khó · High = 2×3×1.5 = 9")', async () => {
    const row = issueRow({
      type: typeBug,
      difficulty: 'HARD',
      priority: {
        id: 'pr-high',
        name: 'High',
        iconKey: null,
        color: null,
        rank: 4,
        isDefault: false,
      },
      storyPoints: 9,
    });
    const { service } = makeService({ issue: { findFirst: vi.fn(() => Promise.resolve(row)) } });
    const dto = await service.getByKey('w1', 'P-TASK-1', null);
    expect(dto).toMatchObject({
      difficulty: 'HARD',
      pointsManual: false,
      pointsExplain: 'Bug · Khó · High = 2×3×1.5 = 9',
    });
  });
  it('điểm chỉnh tay: giải thích nêu rõ đã chỉnh tay', async () => {
    const row = issueRow({ pointsManual: true, storyPoints: 20 });
    const { service } = makeService({ issue: { findFirst: vi.fn(() => Promise.resolve(row)) } });
    const dto = await service.getByKey('w1', 'P-TASK-1', null);
    expect(dto.pointsExplain).toMatch(/^Đã chỉnh tay \(theo công thức: /);
  });
});

describe('IssuesService — Hạn mặc định khi tạo và không xoá được (Task 5)', () => {
  const NOW = new Date('2026-11-04T17:30:00Z'); // 00:30 ngày 05/11 giờ VN => hạn mặc định 06/11
  const DEFAULT_DUE = '2026-11-06T00:00:00.000Z';
  const input = {
    projectId: 'p1',
    typeId: 't-bug',
    summary: 's',
    descriptionFormat: 'MARKDOWN' as const,
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('create không gửi hạn => ngày VN + 1 (00:00Z)', async () => {
    const { tx, created } = createTx(WF_DEFAULT, {});
    await makeService(tx).service.create('w1', 'u1', input);
    expect(created.mock.calls[0]![0].data.dueDate).toEqual(new Date(DEFAULT_DUE));
  });
  it('create với dueDate null => cũng nhận mặc định; hạn gửi lên được giữ nguyên', async () => {
    const a = createTx(WF_DEFAULT, {});
    await makeService(a.tx).service.create('w1', 'u1', { ...input, dueDate: null });
    expect(a.created.mock.calls[0]![0].data.dueDate).toEqual(new Date(DEFAULT_DUE));
    const b = createTx(WF_DEFAULT, {});
    await makeService(b.tx).service.create('w1', 'u1', {
      ...input,
      dueDate: '2026-12-01T00:00:00.000Z',
    });
    expect(b.created.mock.calls[0]![0].data.dueDate).toEqual(new Date('2026-12-01T00:00:00.000Z'));
  });
  it('create: ngày bắt đầu xa hơn mặc định và không gửi hạn => hạn = ngày bắt đầu (không 422)', async () => {
    const { tx, created } = createTx(WF_DEFAULT, {});
    await makeService(tx).service.create('w1', 'u1', {
      ...input,
      startDate: '2026-11-20T00:00:00.000Z',
    });
    expect(created.mock.calls[0]![0].data.dueDate).toEqual(new Date('2026-11-20T00:00:00.000Z'));
  });
  it('createWithin (import) không có hạn => cũng nhận mặc định; hạn lịch sử được giữ', async () => {
    const a = createTx(WF_DEFAULT, {});
    await makeService(a.tx).service.createWithin(a.tx as never, 'w1', 'u1', input, []);
    expect(a.created.mock.calls[0]![0].data.dueDate).toEqual(new Date(DEFAULT_DUE));
    const b = createTx(WF_DEFAULT, {});
    await makeService(b.tx).service.createWithin(
      b.tx as never,
      'w1',
      'u1',
      { ...input, dueDate: '2020-01-01T00:00:00.000Z' },
      [],
    );
    expect(b.created.mock.calls[0]![0].data.dueDate).toEqual(new Date('2020-01-01T00:00:00.000Z'));
  });

  function updTx() {
    return {
      issue: {
        findFirst: vi.fn(() =>
          Promise.resolve(issueRow({ dueDate: new Date('2026-11-10T00:00:00Z') })),
        ),
        findFirstOrThrow: vi.fn(() => Promise.resolve(issueRow({ version: 4 }))),
        updateMany: vi.fn((_a: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
          Promise.resolve({ count: 1 }),
        ),
      },
      issueHistory: { createMany: vi.fn(), create: vi.fn() },
    };
  }
  it('update({dueDate:null}) => 422 DUE_DATE_REQUIRED, chưa ghi gì', async () => {
    const tx = updTx();
    const { service } = makeService(tx);
    await expect(
      service.update('w1', 'u1', 'i1', { version: 3, dueDate: null }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'DUE_DATE_REQUIRED',
      message: 'Hạn là bắt buộc — chọn một ngày thay vì xoá trống',
    });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });
  it('update({dueDate: ngày hợp lệ}) vẫn được và ghi đúng ngày', async () => {
    const tx = updTx();
    await makeService(tx).service.update('w1', 'u1', 'i1', {
      version: 3,
      dueDate: '2026-12-01T00:00:00.000Z',
    });
    expect(tx.issue.updateMany.mock.calls[0]![0].data.dueDate).toEqual(
      new Date('2026-12-01T00:00:00.000Z'),
    );
  });
  it('bulkUpdate với patch.dueDate = null => 422 DUE_DATE_REQUIRED, không đọc/ghi gì', async () => {
    const tx = updTx();
    const { service } = makeService(tx);
    await expect(
      service.bulkUpdate('w1', 'u1', {
        projectId: 'p1',
        items: [{ id: 'i1', version: 3 }],
        patch: { dueDate: null },
      }),
    ).rejects.toMatchObject({ status: 422, code: 'DUE_DATE_REQUIRED' });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });
});

describe('IssuesService — điểm việc cha = tổng điểm việc con (Task 13)', () => {
  /** Hàng việc cha `pt` (thuộc Epic eA) với điểm hiện có; `kids` = điểm các việc con còn sống SAU thao tác. */
  const parentRow = (storyPoints: number, over: Record<string, unknown> = {}) =>
    issueRow({ id: 'pt', epicId: 'eA', parentId: null, storyPoints, ...over });
  const writeOf = (t: ReturnType<typeof pTx>, id: string) =>
    (
      t.issue.updateMany.mock.calls as unknown as Array<
        [{ where: { id: string; deletedAt: unknown }; data: unknown }]
      >
    ).find((c) => c[0].where.id === id && c[0].where.deletedAt === null)?.[0];

  it('đổi điểm một sub-task (2 → 3, anh em 2) => Task = 5; Epic đếm Task MỘT lần (5), không cộng thêm sub-task', async () => {
    const cur = issueRow({ parentId: 'pt', epicId: 'eA', storyPoints: 2 });
    const after = issueRow({ parentId: 'pt', epicId: 'eA', storyPoints: 3, version: 4 });
    const t = pTx(cur, after, {
      rows: { pt: parentRow(4) },
      children: { pt: [2, 3] },
      epics: { eA: epicLike({ storyPoints: 4 }) },
      sums: { eA: 5 }, // Epic: chỉ Task (5), sub-task nằm trong điểm Task
    });
    await makeService(t).service.update('w1', 'u1', 'i1', { version: 3, difficulty: 'HARD' });
    expect(writeOf(t, 'pt')).toEqual({
      where: { id: 'pt', deletedAt: null },
      data: { storyPoints: 5, pointsManual: false, version: { increment: 1 } },
    });
    expect(epicWrite(t, 'eA')?.data).toMatchObject({ storyPoints: 5 });
    // Epic cộng theo việc cấp trên
    expect(t.issue.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: epicTopLevelWhere('eA') }),
    );
  });

  it('xoá một sub-task (3 điểm) => Task giảm còn 2 và Epic theo sau', async () => {
    const t = pTx(issueRow({ parentId: 'pt', epicId: 'eA', storyPoints: 3 }), issueRow(), {
      rows: { pt: parentRow(5) },
      children: { pt: [2] },
      epics: { eA: epicLike({ storyPoints: 5 }) },
      sums: { eA: 2 },
    });
    await makeService(t).service.softDelete('w1', 'u1', 'i1');
    expect(writeOf(t, 'pt')?.data).toMatchObject({ storyPoints: 2 });
    expect(epicWrite(t, 'eA')?.data).toMatchObject({ storyPoints: 2 });
  });

  it('xoá việc con cuối cùng => Task quay về điểm theo công thức (Task · Trung bình · không ưu tiên = 4)', async () => {
    const t = pTx(issueRow({ parentId: 'pt', epicId: null, storyPoints: 3 }), issueRow(), {
      rows: { pt: parentRow(3, { epicId: null }) },
      children: { pt: [] },
    });
    await makeService(t).service.softDelete('w1', 'u1', 'i1');
    expect(writeOf(t, 'pt')?.data).toMatchObject({ storyPoints: 4 });
  });

  it('chuyển sub-task sang việc cha khác => cả hai việc cha được cộng lại, kèm Epic của chúng', async () => {
    const cur = issueRow({ parentId: 'p1x', epicId: null, storyPoints: 3 });
    const after = issueRow({ parentId: 'p2x', epicId: null, storyPoints: 3, version: 4 });
    const t = pTx(cur, after, {
      rows: {
        p1x: parentRow(5, { id: 'p1x', epicId: 'eA' }),
        p2x: parentRow(2, { id: 'p2x', epicId: 'eB' }),
      },
      children: { p1x: [2], p2x: [2, 3] },
      epics: { eA: epicLike({ storyPoints: 5 }), eB: epicLike({ storyPoints: 2 }) },
      sums: { eA: 2, eB: 5 },
    });
    await makeService(t).service.update('w1', 'u1', 'i1', { version: 3, parentId: 'p2x' });
    expect(writeOf(t, 'p1x')?.data).toMatchObject({ storyPoints: 2 });
    expect(writeOf(t, 'p2x')?.data).toMatchObject({ storyPoints: 5 });
    expect(epicWrite(t, 'eA')?.data).toMatchObject({ storyPoints: 2 });
    expect(epicWrite(t, 'eB')?.data).toMatchObject({ storyPoints: 5 });
  });

  it('việc cấp trên chuyển thành việc con (parentId null → pt) => Epic cũ cộng lại vì việc rời tổng Epic', async () => {
    const cur = issueRow({ parentId: null, epicId: 'eA', storyPoints: 3 });
    const after = issueRow({ parentId: 'pt', epicId: 'eA', storyPoints: 3, version: 4 });
    const t = pTx(cur, after, {
      rows: { pt: parentRow(2) },
      children: { pt: [2, 3] },
      epics: { eA: epicLike({ storyPoints: 5 }) },
      sums: { eA: 5 }, // Epic: nay chỉ Task (5), không còn việc vừa chuyển thành con
    });
    await makeService(t).service.update('w1', 'u1', 'i1', { version: 3, parentId: 'pt' });
    expect(writeOf(t, 'pt')?.data).toMatchObject({ storyPoints: 5 });
    expect(t.issue.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: epicTopLevelWhere('eA') }),
    );
  });

  it('khôi phục một sub-task => cộng lại việc cha', async () => {
    const t = pTx(
      issueRow({ deletedAt: new Date(), parentId: 'pt', epicId: null, storyPoints: 3 }),
      issueRow(),
      { rows: { pt: parentRow(2, { epicId: null }) }, children: { pt: [2, 3] } },
    );
    // lần đọc kiểm "cha còn sống" (select id) khác lần đọc lại việc cha để phát sự kiện (include)
    t.issue.findMany.mockImplementation(((a: { include?: unknown; where?: { id?: unknown } }) =>
      Promise.resolve(
        a.include ? [issueRow({ id: 'pt' })] : a.where?.id ? [{ id: 'pt' }] : [],
      )) as never);
    await makeService(t).service.restore('w1', 'u1', 'p1', 'i1');
    expect(writeOf(t, 'pt')?.data).toMatchObject({ storyPoints: 5 });
  });
});

describe('IssuesService — chỉnh tay / công thức trên việc đang có việc con (Task 13)', () => {
  const asPm = (t: ReturnType<typeof pTx>) => {
    const s = makeService(t);
    s.rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:edit', 'project:admin']));
    return s;
  };
  it('PM ghi đè tay điểm của việc cha có việc con => 422 POINTS_ROLLUP_ONLY, chưa ghi gì', async () => {
    const t = pTx(issueRow({ storyPoints: 5 }), issueRow({ storyPoints: 8 }), {
      children: { i1: [2, 3] },
    });
    await expect(
      asPm(t).service.update('w1', 'u1', 'i1', { version: 3, storyPoints: 8 }),
    ).rejects.toMatchObject({ status: 422, code: 'POINTS_ROLLUP_ONLY' });
    expect(t.issue.updateMany).not.toHaveBeenCalled();
  });
  it('PM gửi lại ĐÚNG tổng hiện có không phải ghi đè => không lỗi', async () => {
    const t = pTx(issueRow({ storyPoints: 5 }), issueRow({ storyPoints: 5, version: 4 }), {
      children: { i1: [2, 3] },
    });
    await asPm(t).service.update('w1', 'u1', 'i1', { version: 3, storyPoints: 5 });
    expect(t.issue.updateMany.mock.calls[0]![0].data).not.toHaveProperty('pointsManual');
  });
  it('đổi Độ khó của việc cha có việc con => KHÔNG tính lại theo công thức (điểm giữ là tổng việc con)', async () => {
    const t = pTx(issueRow({ storyPoints: 5 }), issueRow({ storyPoints: 5, version: 4 }), {
      children: { i1: [2, 3] },
    });
    await makeService(t).service.update('w1', 'u1', 'i1', { version: 3, difficulty: 'HARD' });
    const data = t.issue.updateMany.mock.calls[0]![0].data;
    expect(data).toMatchObject({ difficulty: 'HARD' });
    expect(data).not.toHaveProperty('storyPoints');
  });
  it('việc lá (không có việc con) vẫn ghi đè tay bình thường', async () => {
    const t = pTx(issueRow({ storyPoints: 5 }), issueRow({ storyPoints: 8, version: 4 }), {
      children: {},
    });
    await asPm(t).service.update('w1', 'u1', 'i1', { version: 3, storyPoints: 8 });
    expect(t.issue.updateMany.mock.calls[0]![0].data).toMatchObject({
      storyPoints: 8,
      pointsManual: true,
    });
  });
  it('"Tính lại theo công thức" trên việc cha có việc con => chỉ bỏ cờ chỉnh tay, giữ điểm là tổng việc con', async () => {
    const t = pTx(
      issueRow({ storyPoints: 5, pointsManual: true }),
      issueRow({ storyPoints: 5, version: 4 }),
      {
        children: { i1: [2, 3] },
      },
    );
    await asPm(t).service.resetPoints('w1', 'u1', 'i1');
    const data = t.issue.updateMany.mock.calls[0]![0].data;
    expect(data).toMatchObject({ pointsManual: false });
    expect(data).not.toHaveProperty('storyPoints');
  });
});

describe('IssuesService.bulkUpdate — việc cha có việc con (Task 13)', () => {
  // Lô một việc `a` đang có việc con (2 + 3); `idsWithLiveChildren` (where.parentId) trả `a` là việc cha.
  const one = [{ id: 'a', version: 3 }];
  function bTx() {
    const t = b7Tx();
    t.issue.findMany.mockImplementation(((a: { where: { parentId?: unknown } }) =>
      Promise.resolve(
        a.where.parentId ? [{ parentId: 'a' }] : [issueRow({ id: 'a', storyPoints: 5 })],
      )) as never);
    return t;
  }
  it('PM ghi đè tay điểm lô có việc cha có việc con => 422 POINTS_ROLLUP_ONLY cả lô', async () => {
    const t = bTx();
    const { service, rbac } = makeService(t);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:edit', 'project:admin']));
    await expect(
      service.bulkUpdate('w1', 'u1', { projectId: 'p1', items: one, patch: { storyPoints: 9 } }),
    ).rejects.toMatchObject({ status: 422, code: 'POINTS_ROLLUP_ONLY' });
    expect(t.issue.updateMany).not.toHaveBeenCalled();
  });
  it('đổi Độ khó cả lô: việc cha có việc con không bị tính lại điểm theo công thức', async () => {
    const t = bTx();
    await makeService(t).service.bulkUpdate('w1', 'u1', {
      projectId: 'p1',
      items: one,
      patch: { difficulty: 'HARD' },
    });
    const data = t.issue.updateMany.mock.calls[0]![0].data;
    expect(data).toMatchObject({ difficulty: 'HARD' });
    expect(data).not.toHaveProperty('storyPoints');
  });
});

describe('IssuesService.create — việc con mới cộng điểm vào việc cha rồi Epic (Task 13)', () => {
  it('tạo sub-task (3 điểm) dưới Task có sẵn sub-task 2 điểm => Task = 5, Epic = 5 (đếm Task một lần), cùng transaction', async () => {
    const { tx, created } = createTx(WF_DEFAULT, {
      pt: issueRow({ id: 'pt', epicId: 'eA', parentId: null, storyPoints: 2 }),
      eA: epicLike({ storyPoints: 2 }),
    });
    created.mockResolvedValue(
      issueRow({ id: 'new', parentId: 'pt', epicId: 'eA', storyPoints: 3 }),
    );
    const issue = tx.issue as Record<string, unknown>;
    issue.updateMany = vi.fn((_a: { where: { id: string }; data: unknown }) =>
      Promise.resolve({ count: 1 }),
    );
    issue.aggregate = vi.fn(({ where }: { where: { parentId?: string; epicId?: string } }) =>
      Promise.resolve(
        where.parentId
          ? { _sum: { storyPoints: 5 }, _count: { _all: 2 } } // 2 + 3
          : { _sum: { storyPoints: 5 } }, // Epic: chỉ Task (5)
      ),
    );
    issue.findMany = vi.fn(() => Promise.resolve([]));
    (tx as Record<string, unknown>).priority = {
      findFirst: vi.fn(() => Promise.resolve(null)),
    };
    const { service } = makeService(tx);
    await service.createWithin(
      tx as never,
      'w1',
      'u1',
      {
        projectId: 'p1',
        typeId: 't1',
        summary: 's',
        descriptionFormat: 'MARKDOWN',
        parentId: 'pt',
        epicId: 'eA',
      },
      [],
    );
    const calls = (issue.updateMany as ReturnType<typeof vi.fn>).mock.calls as unknown as Array<
      [{ where: { id: string }; data: { storyPoints: number } }]
    >;
    expect(calls.find((c) => c[0].where.id === 'pt')?.[0].data.storyPoints).toBe(5);
    expect(calls.find((c) => c[0].where.id === 'eA')?.[0].data.storyPoints).toBe(5);
  });
});

type D = { id: string; parentId: string; sprintId: string | null };
const sprintOk = () => ({
  sprint: { findFirst: vi.fn(() => Promise.resolve({ id: 'x', state: 'FUTURE' })) },
});
/** Tx cho update/move/bulk: `rows` = hàng theo id (cha...), `desc` = việc con/cháu còn sống (đọc theo parentId). */
function sTx(
  current: Record<string, unknown>,
  after: Record<string, unknown>,
  o: { rows?: Record<string, Record<string, unknown>>; desc?: D[] } = {},
) {
  const order: string[] = [];
  const t = {
    $queryRaw: vi.fn(() => {
      order.push('lock');
      return Promise.resolve([]);
    }),
    issue: {
      findFirst: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'i1' ? current : (o.rows?.[where.id] ?? null)),
      ),
      findFirstOrThrow: vi.fn(() => Promise.resolve(after)),
      findMany: vi.fn((a: { where: { parentId?: { in: string[] } } }) =>
        Promise.resolve(
          a.where.parentId
            ? (o.desc ?? []).filter((d) => a.where.parentId!.in.includes(d.parentId))
            : [],
        ),
      ),
      updateMany: vi.fn((_a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        order.push('write');
        return Promise.resolve({ count: 1 });
      }),
      aggregate: vi.fn(() => Promise.resolve({ _sum: { storyPoints: 0 }, _count: { _all: 0 } })),
    },
    issueHistory: { createMany: vi.fn(), create: vi.fn() },
    project: {
      findUnique: vi.fn(() => Promise.resolve({ archivedAt: null, defaultWorkflowId: 'wf' })),
    },
    ...sprintOk(),
  };
  return { t, order };
}
const descRows: D[] = [
  { id: 'c1', parentId: 'i1', sprintId: 'spA' },
  { id: 'c2', parentId: 'i1', sprintId: 'spA' },
  { id: 'g1', parentId: 'c1', sprintId: 'spA' },
];
const cascadeCall = (t: ReturnType<typeof sTx>['t']) =>
  (
    t.issue.updateMany.mock.calls as unknown as Array<
      [{ where: { id?: { in: string[] } }; data: Record<string, unknown> }]
    >
  ).find((c) => typeof c[0].where.id === 'object' && c[0].where.id !== null)?.[0];

describe('IssuesService.update — việc con theo sprint của việc cha', () => {
  it('đặt sprint KHÁC sprint của cha cho việc con => 422 CHILD_SPRINT_FOLLOWS_PARENT, chưa ghi gì', async () => {
    const { t } = sTx(issueRow({ parentId: 'pt', sprintId: 'spA' }), issueRow(), {
      rows: { pt: { sprintId: 'spA' } },
    });
    await expect(
      makeService(t).service.update('w1', 'u1', 'i1', { version: 3, sprintId: 'spB' }),
    ).rejects.toMatchObject({ status: 422, code: 'CHILD_SPRINT_FOLLOWS_PARENT' });
    expect(t.issue.updateMany).not.toHaveBeenCalled();
  });
  it('đặt sprint BẰNG sprint của cha (hoặc cha không còn sống) => cho qua', async () => {
    const ok = sTx(
      issueRow({ parentId: 'pt', sprintId: 'spA' }),
      issueRow({ parentId: 'pt', sprintId: 'spA', version: 4 }),
      { rows: { pt: { sprintId: 'spA' } } },
    );
    await makeService(ok.t).service.update('w1', 'u1', 'i1', { version: 3, sprintId: 'spA' });
    expect(ok.t.issue.updateMany).toHaveBeenCalled();
    const orphan = sTx(
      issueRow({ parentId: 'gone', sprintId: 'spA' }),
      issueRow({ parentId: 'gone', sprintId: null, version: 4 }),
    );
    await makeService(orphan.t).service.update('w1', 'u1', 'i1', { version: 3, sprintId: null });
    expect(orphan.t.issue.updateMany).toHaveBeenCalled();
  });
  it('đổi cha sang cha khác => sprint của việc đồng bộ theo cha mới', async () => {
    const { t } = sTx(
      issueRow({ parentId: 'p1x', sprintId: 'spA' }),
      issueRow({ parentId: 'p2x', sprintId: 'spB', version: 4 }),
      {
        rows: {
          p2x: {
            ...issueRow({ id: 'p2x', sprintId: 'spB', storyPoints: 0 }),
            type: { key: 'TASK', isSubtask: false },
          },
          p1x: issueRow({ id: 'p1x', sprintId: 'spA', storyPoints: 0 }),
        },
      },
    );
    await makeService(t).service.update('w1', 'u1', 'i1', { version: 3, parentId: 'p2x' });
    const own = t.issue.updateMany.mock.calls.find((c) => c[0].where.id === 'i1')![0];
    expect(own.data).toMatchObject({ parentId: 'p2x', sprintId: 'spB' });
  });
  it('đổi sprint của việc cha => khoá nhánh việc con TRƯỚC khi ghi cha, rồi việc con/cháu đi theo (version +1, lịch sử SPRINT)', async () => {
    const { t, order } = sTx(
      issueRow({ sprintId: 'spA' }),
      issueRow({ sprintId: 'spB', version: 4 }),
      { desc: descRows },
    );
    const { service, events } = makeService(t);
    await service.update('w1', 'u1', 'i1', { version: 3, sprintId: 'spB' });
    expect(order.indexOf('lock')).toBeLessThan(order.indexOf('write')); // con → cha
    const c = cascadeCall(t)!;
    expect(c.where.id!.in.sort()).toEqual(['c1', 'c2', 'g1']);
    expect(c.data).toMatchObject({ sprintId: 'spB', version: { increment: 1 } });
    const hist = (
      t.issueHistory.createMany.mock.calls as unknown as Array<
        [{ data: Array<{ issueId: string; field: string }> }]
      >
    ).flatMap((x) => x[0].data);
    expect(
      hist
        .filter((h) => h.field === 'SPRINT' && h.issueId !== 'i1')
        .map((h) => h.issueId)
        .sort(),
    ).toEqual(['c1', 'c2', 'g1']);
    // phát cho client dạng bulk
    await vi.waitFor(() => expect(events.emit).toHaveBeenCalled());
  });
  it('chỉ việc con đang ở sprint khác mới bị ghi; không đổi sprint của cha => không đụng việc con', async () => {
    const part = sTx(issueRow({ sprintId: 'spA' }), issueRow({ sprintId: 'spB', version: 4 }), {
      desc: [
        { id: 'c1', parentId: 'i1', sprintId: 'spB' }, // đã đúng
        { id: 'c2', parentId: 'i1', sprintId: 'spA' },
      ],
    });
    await makeService(part.t).service.update('w1', 'u1', 'i1', { version: 3, sprintId: 'spB' });
    expect(cascadeCall(part.t)!.where.id!.in).toEqual(['c2']);
    const same = sTx(issueRow({ sprintId: 'spA' }), issueRow({ version: 4 }), { desc: descRows });
    await makeService(same.t).service.update('w1', 'u1', 'i1', { version: 3, summary: 'x' });
    expect(cascadeCall(same.t)).toBeUndefined();
    expect(same.t.$queryRaw).not.toHaveBeenCalledWith(expect.anything());
  });
});

describe('IssuesService.move — việc con theo sprint của việc cha', () => {
  it('kéo việc con sang sprint khác => 422; kéo việc cha => việc con đi theo', async () => {
    const child = sTx(issueRow({ parentId: 'pt', sprintId: 'spA' }), issueRow(), {
      rows: { pt: { sprintId: 'spA' } },
    });
    await expect(
      makeService(child.t).service.move('w1', 'u1', 'i1', { version: 3, sprintId: 'spB' }),
    ).rejects.toMatchObject({ status: 422, code: 'CHILD_SPRINT_FOLLOWS_PARENT' });
    const parent = sTx(issueRow({ sprintId: 'spA' }), issueRow({ sprintId: 'spB', version: 4 }), {
      desc: descRows,
    });
    await makeService(parent.t).service.move('w1', 'u1', 'i1', { version: 3, sprintId: 'spB' });
    expect(cascadeCall(parent.t)!.where.id!.in.sort()).toEqual(['c1', 'c2', 'g1']);
    expect(parent.order.indexOf('lock')).toBeLessThan(parent.order.indexOf('write'));
  });
});

describe('IssuesService.bulkUpdate — việc con theo sprint của việc cha', () => {
  const rowsOf = (over: Array<Record<string, unknown>>) => over.map((o) => issueRow(o));
  function bT(
    rows: ReturnType<typeof rowsOf>,
    desc: D[],
    parents: Record<string, string | null> = {},
  ) {
    const { t, order } = sTx(issueRow(), issueRow({ version: 4 }), { desc });
    t.issue.findMany.mockImplementation(((a: {
      where: { id?: { in: string[] }; parentId?: { in: string[] } };
    }) => {
      if (a.where.parentId)
        return Promise.resolve(desc.filter((d) => a.where.parentId!.in.includes(d.parentId)));
      const ids = a.where.id?.in ?? [];
      // lô chính (include) và tra cha (select id, sprintId)
      return Promise.resolve([
        ...rows.filter((r) => ids.includes(r.id)),
        ...ids.filter((i) => i in parents).map((i) => ({ id: i, sprintId: parents[i] })),
      ]);
    }) as never);
    t.issue.findFirstOrThrow.mockImplementation((({ where }: { where: { id: string } }) =>
      Promise.resolve(issueRow({ id: where.id, sprintId: 'spB', version: 4 }))) as never);
    return { t, order };
  }
  it('việc con ngoài lô có sprint đích khác sprint của cha => 422 cả lô, chưa ghi', async () => {
    const { t } = bT(rowsOf([{ id: 'a', parentId: 'pt', sprintId: 'spA', version: 3 }]), [], {
      pt: 'spA',
    });
    await expect(
      makeService(t).service.bulkUpdate('w1', 'u1', {
        projectId: 'p1',
        items: [{ id: 'a', version: 3 }],
        patch: { sprintId: 'spB' },
      }),
    ).rejects.toMatchObject({ status: 422, code: 'CHILD_SPRINT_FOLLOWS_PARENT' });
    expect(t.issue.updateMany).not.toHaveBeenCalled();
  });
  it('cả cha lẫn con trong lô: chỉ cha ghi trực tiếp, con (và cháu ngoài lô) đi theo bằng cascade', async () => {
    const { t, order } = bT(
      rowsOf([
        { id: 'a', parentId: null, sprintId: 'spA', version: 3 },
        { id: 'b', parentId: 'a', sprintId: 'spA', version: 3 },
      ]),
      [
        { id: 'b', parentId: 'a', sprintId: 'spA' },
        { id: 'g', parentId: 'b', sprintId: 'spA' },
      ],
    );
    await makeService(t).service.bulkUpdate('w1', 'u1', {
      projectId: 'p1',
      items: [
        { id: 'a', version: 3 },
        { id: 'b', version: 3 },
      ],
      patch: { sprintId: 'spB' },
    });
    const direct = (
      t.issue.updateMany.mock.calls as unknown as Array<[{ where: { id?: unknown } }]>
    ).filter((c) => typeof c[0].where.id === 'string');
    expect(direct.map((c) => c[0].where.id)).toEqual(['a']);
    expect(cascadeCall(t)!.where.id!.in.sort()).toEqual(['b', 'g']);
    expect(order.indexOf('lock')).toBeLessThan(order.indexOf('write'));
  });
});

describe('IssuesService.create — việc con vào sprint của việc cha', () => {
  it('có parentId => sprintId = sprint của cha, sprintId gửi kèm bị bỏ qua (không kiểm sprint đó)', async () => {
    const { tx, created } = createTx(WF_DEFAULT, {
      pt: issueRow({ id: 'pt', sprintId: 'spP', epicId: null, parentId: null, storyPoints: 2 }),
    });
    created.mockResolvedValue(issueRow({ id: 'new', parentId: 'pt', sprintId: 'spP' }));
    const issue = tx.issue as Record<string, unknown>;
    issue.updateMany = vi.fn(() => Promise.resolve({ count: 1 }));
    issue.aggregate = vi.fn(() =>
      Promise.resolve({ _sum: { storyPoints: 2 }, _count: { _all: 1 } }),
    );
    issue.findMany = vi.fn(() => Promise.resolve([]));
    const { service } = makeService(tx);
    await service.createWithin(
      tx as never,
      'w1',
      'u1',
      {
        projectId: 'p1',
        typeId: 't1',
        summary: 's',
        descriptionFormat: 'MARKDOWN',
        parentId: 'pt',
        sprintId: 'spOther',
      },
      [],
    );
    expect(created.mock.calls[0]![0].data.sprintId).toBe('spP');
  });
});

describe('IssuesService — việc con mồ côi tính thẳng vào Epic (cha đã xoá mềm)', () => {
  it('xoá việc cha => Epic của các việc con còn sống được cộng lại (chúng không còn nằm trong điểm cha)', async () => {
    const t = pTx(issueRow({ epicId: null, storyPoints: 5 }), issueRow(), {
      epics: { eB: epicLike({ storyPoints: 0 }) },
      sums: { eB: 5 },
    });
    // childEpicIds: việc con còn sống của i1 thuộc Epic eB
    t.issue.findMany.mockImplementation(((a: { where: { parentId?: unknown } }) =>
      Promise.resolve(typeof a.where.parentId === 'string' ? [{ epicId: 'eB' }] : [])) as never);
    await makeService(t).service.softDelete('w1', 'u1', 'i1');
    expect(epicWrite(t, 'eB')?.data).toMatchObject({ storyPoints: 5 });
    expect(t.issue.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: epicTopLevelWhere('eB') }),
    );
  });
  it('khôi phục việc cha => Epic của các việc con còn sống cũng được cộng lại (thôi tính thẳng)', async () => {
    const t = pTx(issueRow({ deletedAt: new Date(), epicId: null, storyPoints: 5 }), issueRow(), {
      epics: { eB: epicLike({ storyPoints: 5 }) },
      sums: { eB: 0 },
    });
    t.issue.findMany.mockImplementation(((a: { where: { parentId?: unknown } }) =>
      Promise.resolve(typeof a.where.parentId === 'string' ? [{ epicId: 'eB' }] : [])) as never);
    await makeService(t).service.restore('w1', 'u1', 'p1', 'i1');
    expect(epicWrite(t, 'eB')?.data).toMatchObject({ storyPoints: 0 });
  });
});
