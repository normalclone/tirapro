/* eslint-disable max-lines-per-function -- spec tích hợp: một describe lớn dùng chung dữ liệu nạp một lần */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertParityDatabase } from '../../common/testing/parity-db-guard';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { ProjectAccessService } from '../rbac/project-access.service';
import { MeOverviewService } from './me-overview.service';

/**
 * `/me/overview` TRÊN POSTGRES THẬT — OPT-IN, không chạy trong `pnpm test`. Dùng ProjectAccessService THẬT (chỉ RBAC được
 * giả: "người thường" thấy dự án công khai + dự án riêng tư mình là thành viên). Kiểm số đếm, thứ tự, việc lá, heuristic
 * chờ test/mở lại, không lộ dự án riêng tư, việc chưa duyệt/đã xoá, ranh giới tuần giờ VN.
 *
 * Chạy: `PARITY_DATABASE_URL=postgresql://…/xxx_scratch?schema=public pnpm --filter @tirapro/api test:parity`
 * (DB nháp đã `migrate deploy`). Mọi hàng mang TAG riêng và được dọn khi xong.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

describe.skipIf(!DB_URL)('/me/overview ↔ Postgres thật', () => {
  const TAG = `ov${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const id = (n: string) => `${TAG}-${n}`;
  const ME = id('me');
  const OTHER = id('other');
  const WS = id('ws');
  const PROJ = { pub: id('p-pub'), sec: id('p-sec'), secMine: id('p-secm') };
  // Thứ Tư 2026-11-04 12:00 giờ VN; tuần này bắt đầu Thứ Hai 2026-11-02.
  const NOW = new Date('2026-11-04T05:00:00.000Z');
  const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

  let prisma: PrismaClient;
  let service: MeOverviewService;
  let n = 0;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
    for (const u of [ME, OTHER])
      await prisma.user.create({ data: { id: u, email: `${u}@x.test`, displayName: u } });
    await prisma.workspace.create({ data: { id: WS, name: TAG, slug: WS, ownerId: ME } });
    await prisma.role.create({
      data: { id: id('role'), workspaceId: WS, name: 'Member', scope: 'WORKSPACE' },
    });
    for (const u of [ME, OTHER])
      await prisma.workspaceMembership.create({
        data: { workspaceId: WS, userId: u, roleId: id('role') },
      });
    const key = TAG.slice(2, 8).toUpperCase();
    await prisma.project.create({
      data: { id: PROJ.pub, workspaceId: WS, key: `${key}P`, name: 'Pub' },
    });
    await prisma.project.create({
      data: { id: PROJ.sec, workspaceId: WS, key: `${key}S`, name: 'Sec', isPrivate: true },
    });
    await prisma.project.create({
      data: { id: PROJ.secMine, workspaceId: WS, key: `${key}M`, name: 'SecMine', isPrivate: true },
    });
    await prisma.projectMembership.create({
      data: { id: id('pm'), projectId: PROJ.secMine, userId: ME, roleId: id('role') },
    });
    const types = { TASK: 'Task', BUG: 'Bug', EPIC: 'Epic', SUBTASK: 'Subtask' } as const;
    for (const [k, name] of Object.entries(types))
      await prisma.issueType.create({
        data: { id: id(`type-${k}`), workspaceId: WS, name, key: k as keyof typeof types },
      });
    await prisma.workflow.create({
      data: { id: id('wf'), workspaceId: WS, name: 'WF', isDefault: true },
    });
    const sts: [string, string, 'TODO' | 'IN_PROGRESS' | 'DONE'][] = [
      ['open', 'Open', 'TODO'],
      ['doing', 'Doing', 'IN_PROGRESS'],
      ['done', 'Done', 'DONE'],
      ['retest', 'Ready for Retest', 'IN_PROGRESS'],
      ['wait', 'Chờ test', 'IN_PROGRESS'],
      ['reopened', 'Reopened', 'TODO'],
    ];
    for (const [k, name, category] of sts)
      await prisma.status.create({
        data: { id: id(`st-${k}`), workflowId: id('wf'), name, category },
      });
    await prisma.priority.create({
      data: { id: id('pr-high'), workspaceId: WS, name: 'High', rank: 4 },
    });
    await prisma.priority.create({
      data: { id: id('pr-low'), workspaceId: WS, name: 'Low', rank: 1 },
    });

    interface Mk {
      project?: string;
      type?: keyof typeof types;
      status: string;
      assignee?: string | null;
      reporter?: string | null;
      due?: string | null;
      prio?: 'high' | 'low' | null;
      points?: number | null;
      resolvedAt?: string | null;
      parentId?: string | null;
      deletedAt?: Date | null;
      triageState?: 'PENDING' | null;
    }
    const mk = async (name: string, o: Mk) => {
      n++;
      await prisma.issue.create({
        data: {
          id: id(name),
          workspaceId: WS,
          projectId: o.project ?? PROJ.pub,
          number: n,
          key: `K${TAG}-${n}`,
          typeId: id(`type-${o.type ?? 'TASK'}`),
          statusId: id(`st-${o.status}`),
          priorityId: o.prio ? id(`pr-${o.prio}`) : null,
          summary: name,
          rank: `0|${String(n).padStart(6, '0')}:`,
          assigneeId: o.assignee === undefined ? ME : o.assignee,
          reporterId: o.reporter ?? null,
          dueDate: o.due ? day(o.due) : null,
          storyPoints: o.points ?? null,
          resolvedAt: o.resolvedAt ? new Date(o.resolvedAt) : null,
          parentId: o.parentId ?? null,
          deletedAt: o.deletedAt ?? null,
          triageState: o.triageState ?? null,
        },
      });
    };
    await mk('i1', { status: 'open', due: '2026-11-03', prio: 'low' });
    await mk('i2', { status: 'doing', due: '2026-11-03', prio: 'high' });
    await mk('i3', { status: 'open', due: '2026-11-04' });
    await mk('i4', { status: 'open', due: '2026-11-11' });
    await mk('i5', { status: 'open', due: '2026-11-12' });
    await mk('i6', { status: 'open', prio: 'high' });
    await mk('i7', { status: 'open', project: PROJ.sec, due: '2026-11-01' }); // riêng tư, không là thành viên
    await mk('i8', { status: 'open', project: PROJ.secMine, prio: 'low' });
    await mk('i9', { status: 'done', points: 5, resolvedAt: '2026-11-03T03:00:00.000Z' });
    await mk('i10', { status: 'done', points: 3, resolvedAt: '2026-11-01T16:59:00.000Z' }); // CN 23:59 VN → tuần trước
    await mk('i11', { status: 'done', points: 2, resolvedAt: '2026-11-03T04:00:00.000Z' }); // cha: có việc con
    await mk('i12', {
      status: 'done',
      type: 'SUBTASK',
      points: 2,
      parentId: id('i11'),
      resolvedAt: '2026-11-03T04:00:00.000Z',
    });
    await mk('i13', {
      status: 'done',
      project: PROJ.sec,
      points: 100,
      resolvedAt: '2026-11-03T03:00:00.000Z',
    });
    await mk('epic', {
      status: 'done',
      type: 'EPIC',
      points: 50,
      resolvedAt: '2026-11-03T03:00:00.000Z',
    });
    await mk('other-done', {
      status: 'done',
      assignee: OTHER,
      points: 40,
      resolvedAt: '2026-11-03T03:00:00.000Z',
    });
    await mk('i14', { status: 'open', triageState: 'PENDING' });
    await mk('i15', { status: 'open', deletedAt: new Date() });
    await mk('b1', { type: 'BUG', status: 'retest', reporter: ME, assignee: OTHER });
    await mk('b2', { type: 'BUG', status: 'wait', reporter: ME, assignee: OTHER });
    await mk('b3', { type: 'BUG', status: 'reopened', reporter: ME, assignee: OTHER });
    await mk('b4', { type: 'BUG', status: 'reopened', reporter: OTHER, assignee: OTHER });
    await mk('b5', { type: 'BUG', status: 'open', reporter: OTHER, assignee: ME });
    await mk('b6', {
      type: 'BUG',
      status: 'retest',
      reporter: ME,
      assignee: OTHER,
      project: PROJ.sec,
    });
    await mk('b7', { type: 'BUG', status: 'doing', reporter: ME, assignee: OTHER });

    const rbac = { projectVisibilityMode: () => Promise.resolve('memberOrPublic') };
    const ps = prisma as unknown as PrismaService;
    service = new MeOverviewService(ps, new ProjectAccessService(ps, rbac as never));
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.issue.updateMany({ where: { workspaceId: WS }, data: { parentId: null } });
    await prisma.issue.deleteMany({ where: { workspaceId: WS } });
    await prisma.projectMembership.deleteMany({
      where: { projectId: { in: Object.values(PROJ) } },
    });
    await prisma.project.deleteMany({ where: { workspaceId: WS } });
    await prisma.status.deleteMany({ where: { workflow: { workspaceId: WS } } });
    await prisma.workflow.deleteMany({ where: { workspaceId: WS } });
    await prisma.issueType.deleteMany({ where: { workspaceId: WS } });
    await prisma.priority.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId: WS } });
    await prisma.role.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
    await prisma.user.deleteMany({ where: { id: { in: [ME, OTHER] } } });
    await prisma.$disconnect();
  }, 120_000);

  const summaries = (items: { summary: string }[]) => items.map((i) => i.summary);

  it('số đếm: chưa xong / quá hạn / sắp đến hạn (7 ngày, gồm hôm nay, không gồm quá hạn) / điểm xong tuần này', async () => {
    const o = await service.overview(WS, ME, NOW);
    expect(o.counts).toEqual({ open: 8, overdue: 2, dueSoon: 2, donePointsThisWeek: 7 });
  });

  it('myIssues: hạn tăng dần, rồi ưu tiên giảm dần, không hạn cuối; không có việc xong/chưa duyệt/đã xoá/dự án riêng tư', async () => {
    const o = await service.overview(WS, ME, NOW);
    expect(summaries(o.myIssues)).toEqual(['i2', 'i1', 'i3', 'i4', 'i5', 'i6', 'i8', 'b5']);
    expect(o.myIssues[0]).toMatchObject({
      status: { name: 'Doing', category: 'IN_PROGRESS' },
      priority: { name: 'High' },
      dueDate: '2026-11-03T00:00:00.000Z',
      type: { key: 'TASK' },
    });
    expect(o.myIssues[0]!.projectKey).toMatch(/P$/);
    expect(o.myIssues.find((i) => i.summary === 'i8')!.projectKey).toMatch(/M$/);
  });

  it('bug: chờ test lại / mở lại chỉ của bug TÔI báo; giao cho tôi; không lộ dự án riêng tư', async () => {
    const { bugs } = await service.overview(WS, ME, NOW);
    expect(summaries(bugs.awaitingRetest).sort()).toEqual(['b1', 'b2']);
    expect(summaries(bugs.reopened)).toEqual(['b3']);
    expect(summaries(bugs.assignedToMe)).toEqual(['b5']);
  });

  it('điểm theo tuần: chỉ việc lá (bỏ Epic, bỏ việc cha), chỉ việc của tôi, ranh giới tuần giờ VN, ẩn dự án riêng tư', async () => {
    const { weeklyDonePoints: w } = await service.overview(WS, ME, NOW);
    expect(w).toHaveLength(8);
    expect(w[7]!.weekStart).toBe('2026-11-02');
    const pts = (i: number) => w[i]!.byProject.map((p) => p.points);
    expect(pts(7)).toEqual([7]); // i9 (5) + i12 (2); không có i11 (cha), epic, other-done, i13
    expect(pts(6)).toEqual([3]); // i10: CN 23:59 giờ VN
    for (let i = 0; i < 6; i++) expect(w[i]!.byProject).toEqual([]);
  });

  it('người khác (OTHER) không thấy việc/điểm của tôi và cũng không thấy dự án riêng tư', async () => {
    const o = await service.overview(WS, OTHER, NOW);
    // OTHER được giao b1–b4, b7 (b6 ở dự án riêng tư OTHER không là thành viên → ẩn); không thấy i1…i8 của tôi.
    expect(summaries(o.myIssues).sort()).toEqual(['b1', 'b2', 'b3', 'b4', 'b7']);
    expect(o.counts.open).toBe(5);
    expect(o.counts.donePointsThisWeek).toBe(40);
  });
});
