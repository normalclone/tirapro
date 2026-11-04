import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertParityDatabase } from '../../common/testing/parity-db-guard';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkflowAdminService } from './workflow-admin.service';
import { WorkflowResolver } from './workflow-resolver.service';
import { WorkflowSchemeService } from './workflow-scheme.service';

/**
 * QUY TRÌNH THEO LOẠI VIỆC TRÊN POSTGRES THẬT — OPT-IN (`PARITY_DATABASE_URL=…_scratch pnpm --filter @tirapro/api test:parity`).
 * Mock không chứng minh được groupBy theo quan hệ, upsert khoá ghép, FK Restrict, hay việc chuyển + lịch sử + cột bảng nằm
 * trong MỘT transaction — spec này chạy chúng với dữ liệu thật.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

const TAG = `wf${Date.now().toString(36)}`;
const id = (s: string): string => `${TAG}-${s}`;
const WS = id('ws');

describe.skipIf(!DB_URL)('WorkflowSchemeService ↔ Postgres thật', () => {
  let prisma: PrismaClient;
  let svc: WorkflowSchemeService;
  let admin: WorkflowAdminService;

  const issueState = async (ids: string[]) =>
    prisma.issue.findMany({
      where: { id: { in: ids.map(id) } },
      select: { id: true, statusId: true, version: true, resolvedAt: true, resolutionId: true },
      orderBy: { id: 'asc' },
    });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
    const resolver = new WorkflowResolver();
    svc = new WorkflowSchemeService(prisma as unknown as PrismaService, resolver);
    admin = new WorkflowAdminService(
      prisma as unknown as PrismaService,
      {
        visibleWhere: () => Promise.resolve({}),
      } as never,
    );
    await prisma.user.create({
      data: { id: id('u'), email: `${id('u')}@wf.test`, displayName: 'QT' },
    });
    await prisma.workspace.create({ data: { id: WS, name: WS, slug: WS, ownerId: id('u') } });
    // Quy trình cũ (3 trạng thái) + quy trình tổ chức "Standard" (To Do / In Progress / Done).
    for (const [wf, name, names] of [
      ['old', 'Cũ', ['Cần làm', 'Đang làm', 'Xong']],
      ['std', 'Standard', ['To Do', 'In Progress', 'Done']],
    ] as const) {
      await prisma.workflow.create({ data: { id: id(wf), workspaceId: WS, name } });
      await prisma.status.createMany({
        data: names.map((n, i) => ({
          id: id(`${wf}-${i}`),
          workflowId: id(wf),
          name: n,
          category: (['TODO', 'IN_PROGRESS', 'DONE'] as const)[i]!,
          order: i,
          isInitial: i === 0,
        })),
      });
    }
    await prisma.workflowTransition.create({
      data: {
        workflowId: id('std'),
        name: 'Bắt đầu',
        fromStatusId: id('std-0'),
        toStatusId: id('std-1'),
      },
    });
    await prisma.resolution.create({
      data: { id: id('res'), workspaceId: WS, name: 'Done', isDefault: true },
    });
    await prisma.issueType.create({
      data: { id: id('t-task'), workspaceId: WS, name: 'Task', key: 'TASK' },
    });
    for (const [p, key] of [
      ['p1', 'WA'],
      ['p2', 'WB'],
    ] as const) {
      await prisma.project.create({
        data: { id: id(p), workspaceId: WS, key, name: key, defaultWorkflowId: id('old') },
      });
      const board = await prisma.board.create({
        data: { id: id(`b-${p}`), projectId: id(p), name: 'B', type: 'KANBAN' },
      });
      for (const [i, col] of ['Cần làm', 'Đang làm', 'Xong'].entries()) {
        const c = await prisma.boardColumn.create({
          data: { id: id(`c-${p}-${i}`), boardId: board.id, name: col, order: i },
        });
        await prisma.boardColumnStatus.create({
          data: { columnId: c.id, statusId: id(`old-${i}`) },
        });
      }
    }
    const issue = (n: string, p: string, st: number, extra: Record<string, unknown> = {}) =>
      prisma.issue.create({
        data: {
          id: id(n),
          key: `${p}-${n}`,
          number: Math.floor(Math.random() * 1e6),
          workspaceId: WS,
          projectId: id(p),
          typeId: id('t-task'),
          statusId: id(`old-${st}`),
          summary: n,
          rank: `0|${n}:`,
          ...extra,
        },
      });
    await issue('a1', 'p1', 0);
    await issue('a2', 'p1', 1);
    await issue('a3', 'p1', 2, { resolvedAt: new Date(), resolutionId: id('res') });
    await issue('a4', 'p1', 1, { deletedAt: new Date() }); // thùng rác cũng phải được chuyển
    await issue('b1', 'p2', 1);
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.project.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TAG } } });
    await prisma.$disconnect();
  }, 60_000);

  const items = () => [{ issueTypeId: id('t-task'), workflowId: id('std') }];
  const map = () => ({
    [id('old-0')]: id('std-0'),
    [id('old-1')]: id('std-1'),
    [id('old-2')]: id('std-2'),
  });

  it('dryRun: đếm theo dự án/trạng thái (gồm việc ở thùng rác), không ghi gì', async () => {
    const out = await svc.setWorkspaceScheme(WS, id('u'), { items: items() }, true);
    expect(out.dryRun).toBe(true);
    expect(out.totalIssues).toBe(5);
    expect(
      out.moves.find((m) => m.projectKey === 'WA' && m.fromStatusName === 'Đang làm'),
    ).toMatchObject({ count: 2, toStatusName: 'In Progress', suggested: true });
    expect(await prisma.workspaceWorkflowScheme.count({ where: { workspaceId: WS } })).toBe(0);
    expect((await issueState(['a2']))[0]!.version).toBe(1);
  });

  it('thiếu statusMap => 422 STATUS_MAPPING_REQUIRED và DB không đổi', async () => {
    await expect(
      svc.setWorkspaceScheme(WS, id('u'), { items: items() }, false),
    ).rejects.toMatchObject({ status: 422, code: 'STATUS_MAPPING_REQUIRED' });
    expect(await prisma.workspaceWorkflowScheme.count({ where: { workspaceId: WS } })).toBe(0);
  });

  it('một ghi đè của p2 giữ p2 nguyên vẹn; chạy thật chuyển việc p1: version+1, lịch sử STATUS, vào/ra Done đúng, cột bảng thêm trạng thái mới (M1)', async () => {
    await prisma.projectWorkflowOverride.create({
      data: { projectId: id('p2'), issueTypeId: id('t-task'), workflowId: id('old') },
    });
    const out = await svc.setWorkspaceScheme(
      WS,
      id('u'),
      { items: items(), statusMap: map() },
      false,
    );
    expect(out).toMatchObject({ dryRun: false, totalIssues: 4 });
    const [a1, a2, a3, a4, b1] = await issueState(['a1', 'a2', 'a3', 'a4', 'b1']);
    expect([a1, a2, a3, a4].map((i) => i!.statusId)).toEqual([
      id('std-0'),
      id('std-1'),
      id('std-2'),
      id('std-1'),
    ]);
    expect([a1, a2].map((i) => i!.version)).toEqual([2, 2]);
    expect(b1).toMatchObject({ statusId: id('old-1'), version: 1 }); // p2 có ghi đè: không đụng
    expect(a3!.resolutionId).toBe(id('res')); // DONE → DONE giữ resolution
    const hist = await prisma.issueHistory.findMany({
      where: { issueId: { in: ['a1', 'a2', 'a3', 'a4'].map(id) }, field: 'STATUS' },
    });
    expect(hist).toHaveLength(4);
    expect(hist.find((h) => h.issueId === id('a2'))).toMatchObject({
      oldValue: 'Đang làm',
      newValue: 'In Progress',
      actorId: (
        await prisma.user.findUniqueOrThrow({ where: { email: 'automation@tirapro.local' } })
      ).id,
    });
    // Bảng của p1: mỗi trạng thái mới nằm trong cột cùng nhóm; trạng thái cũ vẫn còn.
    const cols = await prisma.boardColumn.findMany({
      where: { boardId: id('b-p1') },
      include: { statuses: true },
      orderBy: { order: 'asc' },
    });
    expect(cols.map((c) => c.statuses.map((s) => s.statusId).sort())).toEqual([
      [id('old-0'), id('std-0')].sort(),
      [id('old-1'), id('std-1')].sort(),
      [id('old-2'), id('std-2')].sort(),
    ]);
    // Bảng của p2 (ghi đè) không bị thêm trạng thái.
    const p2cols = await prisma.boardColumnStatus.count({
      where: { column: { boardId: id('b-p2') } },
    });
    expect(p2cols).toBe(3);
  });

  it('PUT lặp lại cùng cấu hình: không đổi gì (idempotent)', async () => {
    const out = await svc.setWorkspaceScheme(
      WS,
      id('u'),
      { items: items(), statusMap: map() },
      false,
    );
    expect(out).toEqual({ dryRun: false, moves: [], totalIssues: 0, affectedRules: [] });
    expect((await issueState(['a2']))[0]!.version).toBe(2);
  });

  it('xoá quy trình đang gán => 409 WORKFLOW_IN_USE; gán cho loại việc thì FK Restrict cũng chặn', async () => {
    await expect(admin.removeWorkflow(WS, id('std'))).rejects.toMatchObject({
      status: 409,
      code: 'WORKFLOW_IN_USE',
    });
    await expect(admin.removeWorkflow(WS, id('old'))).rejects.toMatchObject({
      status: 409,
      code: 'WORKFLOW_IN_USE',
    }); // ghi đè của WB
    // Postgres RESTRICT báo 23001 (Prisma không map ra P2003): vẫn phải bị chặn ở tầng DB.
    await expect(prisma.workflow.delete({ where: { id: id('std') } })).rejects.toThrow(/RESTRICT/);
  });

  it('danh sách quy trình: usedBy có loại việc của tổ chức và ghi đè của dự án', async () => {
    const list = await admin.listWorkflows(WS, {}, id('u'));
    expect(list.find((w) => w.id === id('std'))!.usedBy.scheme).toEqual(['TASK']);
    expect(list.find((w) => w.id === id('old'))!.usedBy.overrides).toEqual([
      { projectKey: 'WB', typeKey: 'TASK' },
    ]);
  });

  it('ghi đè dự án có copy: chép quy trình, chuyển việc theo statusMap nguồn, bảng thêm trạng thái; DELETE quay về dùng chung', async () => {
    const put = await svc.setProjectOverride(
      WS,
      id('p2'),
      id('u'),
      {
        issueTypeId: id('t-task'),
        workflowId: id('std'),
        copy: true,
        statusMap: { [id('old-1')]: id('std-1') },
      },
      false,
    );
    expect(put.totalIssues).toBe(1);
    const copy = await prisma.workflow.findFirstOrThrow({
      where: { workspaceId: WS, projectId: id('p2') },
      include: { statuses: true, transitions: true },
    });
    expect(copy.name).toBe('Standard (WB)');
    expect(copy.statuses).toHaveLength(3);
    expect(copy.transitions).toHaveLength(1);
    const b1 = (await issueState(['b1']))[0]!;
    expect(copy.statuses.find((s) => s.id === b1.statusId)!.name).toBe('In Progress');
    expect(
      await prisma.boardColumnStatus.count({ where: { column: { boardId: id('b-p2') } } }),
    ).toBe(6);
    // Lặp lại: dùng lại bản chép, không chép thêm.
    await svc.setProjectOverride(
      WS,
      id('p2'),
      id('u'),
      { issueTypeId: id('t-task'), workflowId: id('std'), copy: true, statusMap: {} },
      false,
    );
    expect(await prisma.workflow.count({ where: { workspaceId: WS, projectId: id('p2') } })).toBe(
      1,
    );
    // Quay về dùng chung: việc sang quy trình tổ chức theo statusMap.
    const back = await svc.clearProjectOverride(
      WS,
      id('p2'),
      id('u'),
      id('t-task'),
      { [b1.statusId]: id('std-1') },
      false,
    );
    expect(back.totalIssues).toBe(1);
    expect((await issueState(['b1']))[0]!.statusId).toBe(id('std-1'));
    expect(await prisma.projectWorkflowOverride.count({ where: { projectId: id('p2') } })).toBe(0);
  });

  it('xoá trạng thái còn việc: 409 STATUS_HAS_ISSUES; kèm thay thế thì chuyển việc rồi xoá (cả thùng rác)', async () => {
    await expect(admin.removeStatus(WS, id('u'), id('std-1'))).rejects.toMatchObject({
      status: 409,
      code: 'STATUS_HAS_ISSUES',
    });
    const out = await admin.removeStatus(WS, id('u'), id('std-1'), id('std-0'));
    expect(out.moved).toBeGreaterThanOrEqual(3);
    expect(await prisma.status.count({ where: { id: id('std-1') } })).toBe(0);
    const states = await issueState(['a2', 'a4', 'b1']);
    expect(states.every((s) => s.statusId === id('std-0'))).toBe(true);
  });
});
