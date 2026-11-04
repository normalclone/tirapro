/* eslint-disable max-lines-per-function -- spec tích hợp: một describe lớn dùng chung dữ liệu nạp một lần */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertParityDatabase } from '../../common/testing/parity-db-guard';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { IssuesService } from '../issues/issues.service';
import { ProjectAccessService } from '../rbac/project-access.service';
import { SearchService } from '../search/search.service';
import { MeSearchService } from './me-search.service';

/**
 * `/me/search` TRÊN POSTGRES THẬT — OPT-IN, không chạy trong `pnpm test`. Dùng dịch vụ THẬT (IssuesService, SearchService,
 * ProjectAccessService); chỉ RBAC được giả: "người thường" thấy dự án công khai + dự án riêng tư mình là thành viên, và có
 * `project:view` ở mọi workspace. Kiểm: một workspace ↔ tìm kiếm workspace, không lộ dự án riêng tư / workspace đã xoá /
 * workspace không là thành viên, `workspace = "X"`, giá trị không có ở một/mọi workspace, phân trang 3 trang.
 *
 * Chạy: `PARITY_DATABASE_URL=postgresql://…/xxx_scratch?schema=public pnpm --filter @tirapro/api test:parity`
 * (DB nháp đã `migrate deploy`). Mọi hàng mang TAG riêng và được dọn khi xong.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

describe.skipIf(!DB_URL)('/me/search ↔ Postgres thật', () => {
  const TAG = `me${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const id = (n: string) => `${TAG}-${n}`;
  const U = { u1: id('u1'), u2: id('u2'), solo: id('solo') };
  const W = { a: id('wa'), b: id('wb'), gone: id('wgone'), other: id('wother') };
  const WNAME = { a: `${TAG} Alpha`, b: `${TAG} Beta`, gone: `${TAG} Gone`, other: `${TAG} Other` };
  const PROJ = {
    aPub: id('p-a-pub'),
    bPub: id('p-b-pub'),
    bSec: id('p-b-sec'),
    gonePub: id('p-gone'),
    otherPub: id('p-other'),
  };
  const dayMs = 86_400_000;
  const base = Date.parse('2026-03-01T00:00:00.000Z');

  let prisma: PrismaClient;
  let me: MeSearchService;
  let search: SearchService;
  const issueIds: string[] = [];

  const call = (userId: string, jql: string, extra: { cursor?: string; limit?: number } = {}) =>
    me.search(userId, { jql, limit: extra.limit ?? 50, cursor: extra.cursor });
  const idsOf = (r: { data: { id: string }[] }) => r.data.map((d) => d.id);

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
    const allUsers = Object.values(U);
    for (const u of allUsers)
      await prisma.user.create({ data: { id: u, email: `${u}@x.test`, displayName: u } });
    for (const [k, w] of Object.entries(W)) {
      await prisma.workspace.create({
        data: {
          id: w,
          name: WNAME[k as keyof typeof WNAME],
          slug: w,
          ownerId: U.u1,
          deletedAt: k === 'gone' ? new Date() : null,
        },
      });
      await prisma.role.create({
        data: { id: id(`role-${k}`), workspaceId: w, name: 'Member', scope: 'WORKSPACE' },
      });
      await prisma.issueType.create({
        data: { id: id(`type-${k}`), workspaceId: w, name: 'Task', hierarchyLevel: 0 },
      });
      await prisma.workflow.create({
        data: { id: id(`wf-${k}`), workspaceId: w, name: 'WF', isDefault: true },
      });
      await prisma.status.create({
        data: {
          id: id(`st-${k}`),
          workflowId: id(`wf-${k}`),
          name: 'Open',
          category: 'TODO',
          isInitial: true,
        },
      });
    }
    // Trạng thái "Chờ test" CHỈ có ở workspace Alpha.
    await prisma.status.create({
      data: {
        id: id('st-a-wait'),
        workflowId: id('wf-a'),
        name: 'Chờ test',
        category: 'IN_PROGRESS',
      },
    });
    const member = async (user: string, k: keyof typeof W) =>
      prisma.workspaceMembership.create({
        data: { workspaceId: W[k], userId: user, roleId: id(`role-${k}`) },
      });
    await member(U.u1, 'a');
    await member(U.u1, 'b');
    await member(U.u1, 'gone');
    await member(U.u2, 'b');
    await member(U.solo, 'a');

    const mkProject = (pid: string, k: keyof typeof W, key: string, isPrivate = false) =>
      prisma.project.create({
        data: { id: pid, workspaceId: W[k], key, name: key, isPrivate },
      });
    await mkProject(PROJ.aPub, 'a', `${TAG.slice(2, 8).toUpperCase()}A`);
    await mkProject(PROJ.bPub, 'b', `${TAG.slice(2, 8).toUpperCase()}B`);
    await mkProject(PROJ.bSec, 'b', `${TAG.slice(2, 8).toUpperCase()}S`, true);
    await mkProject(PROJ.gonePub, 'gone', `${TAG.slice(2, 8).toUpperCase()}G`);
    await mkProject(PROJ.otherPub, 'other', `${TAG.slice(2, 8).toUpperCase()}O`);
    await prisma.projectMembership.create({
      data: { id: id('pm-u2'), projectId: PROJ.bSec, userId: U.u2, roleId: id('role-b') },
    });

    let n = 0;
    const mkIssue = async (
      k: keyof typeof W,
      project: string,
      dayOffset: number,
      extra: { dueDate?: Date | null; statusId?: string } = {},
    ) => {
      n++;
      const iid = id(`i${String(n).padStart(2, '0')}`);
      issueIds.push(iid);
      await prisma.issue.create({
        data: {
          id: iid,
          workspaceId: W[k],
          projectId: project,
          number: n,
          key: `K${TAG}-${n}`,
          typeId: id(`type-${k}`),
          statusId: extra.statusId ?? id(`st-${k}`),
          summary: `việc ${n}`,
          rank: `0|${String(n).padStart(6, '0')}:`,
          dueDate: extra.dueDate ?? null,
          // Trùng updatedAt giữa các workspace để ép khoá phụ `id`.
          updatedAt: new Date(base + (dayOffset % 6) * dayMs),
          createdAt: new Date(base),
        },
      });
      return iid;
    };
    for (let i = 0; i < 8; i++) await mkIssue('a', PROJ.aPub, i);
    for (let i = 0; i < 8; i++) await mkIssue('b', PROJ.bPub, i + 1);
    for (let i = 0; i < 4; i++) await mkIssue('b', PROJ.bSec, i + 2);
    for (let i = 0; i < 3; i++) await mkIssue('gone', PROJ.gonePub, i);
    for (let i = 0; i < 3; i++) await mkIssue('other', PROJ.otherPub, i);
    await mkIssue('a', PROJ.aPub, 3, { statusId: id('st-a-wait') });

    const rbac = {
      projectVisibilityMode: () => Promise.resolve('memberOrPublic'),
      getEffectivePermissions: () => Promise.resolve(new Set(['project:view'])),
    };
    const ps = prisma as unknown as PrismaService;
    const access = new ProjectAccessService(ps, rbac as never);
    const issues = new IssuesService(ps, { emit: () => true } as never, rbac as never);
    search = new SearchService(issues, ps, access);
    me = new MeSearchService(ps, rbac as never, search);
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    const wsIds = Object.values(W);
    await prisma.issue.deleteMany({ where: { workspaceId: { in: wsIds } } });
    await prisma.projectMembership.deleteMany({
      where: { projectId: { in: Object.values(PROJ) } },
    });
    await prisma.project.deleteMany({ where: { workspaceId: { in: wsIds } } });
    await prisma.status.deleteMany({ where: { workflow: { workspaceId: { in: wsIds } } } });
    await prisma.workflow.deleteMany({ where: { workspaceId: { in: wsIds } } });
    await prisma.issueType.deleteMany({ where: { workspaceId: { in: wsIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId: { in: wsIds } } });
    await prisma.role.deleteMany({ where: { workspaceId: { in: wsIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: wsIds } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(U) } } });
    await prisma.$disconnect();
  }, 120_000);

  it('một không gian: cùng id, cùng thứ tự với tìm kiếm của không gian', async () => {
    const direct = await search.search(W.a, U.solo, {
      jql: 'type = Task',
      limit: 50,
      checkValues: true,
    });
    const viaMe = await call(U.solo, 'type = Task');
    expect(viaMe.data.length).toBeGreaterThan(0);
    expect(idsOf(viaMe)).toEqual(idsOf(direct as { data: { id: string }[] }));
  });

  it('một không gian + ORDER BY: cùng thứ tự với tìm kiếm của không gian', async () => {
    const jql = 'type = Task ORDER BY updated ASC';
    const direct = await search.search(W.a, U.solo, { jql, limit: 50, checkValues: true });
    expect(idsOf(await call(U.solo, jql))).toEqual(idsOf(direct as { data: { id: string }[] }));
  });

  it('không lộ dự án riêng tư không là thành viên; người là thành viên thì thấy', async () => {
    const u1 = await call(U.u1, 'type = Task');
    expect(u1.data.some((d) => (d as { projectId: string }).projectId === PROJ.bSec)).toBe(false);
    const u2 = await call(U.u2, 'type = Task');
    expect(
      u2.data.filter((d) => (d as { projectId: string }).projectId === PROJ.bSec),
    ).toHaveLength(4);
  });

  it('bỏ không gian đã xoá và không gian không là thành viên; kèm không gian {id,name}', async () => {
    const res = await call(U.u1, 'type = Task');
    const wsSeen = new Set(res.data.map((d) => d.workspace.id));
    expect(wsSeen).toEqual(new Set([W.a, W.b]));
    expect(res.data.find((d) => d.workspace.id === W.a)!.workspace.name).toBe(WNAME.a);
    expect((await me.myWorkspaces(U.u1)).map((w) => w.id).sort()).toEqual([W.a, W.b].sort());
  });

  it('lọc theo tên không gian (= / != / IN) thu hẹp kết quả (không phân biệt hoa/thường)', async () => {
    const onlyB = await call(U.u1, `workspace = "${WNAME.b.toUpperCase()}"`);
    expect(new Set(onlyB.data.map((d) => d.workspace.id))).toEqual(new Set([W.b]));
    const notB = await call(U.u1, `workspace != "${WNAME.b}"`);
    expect(new Set(notB.data.map((d) => d.workspace.id))).toEqual(new Set([W.a]));
    const both = await call(U.u1, `workspace IN ("${WNAME.a}", "${WNAME.b}")`);
    expect(new Set(both.data.map((d) => d.workspace.id))).toEqual(new Set([W.a, W.b]));
  });

  it('trường tên không gian dùng ở phạm vi MỘT không gian → 422 FIELD_NOT_ALLOWED_IN_SCOPE', async () => {
    await expect(
      search.search(W.a, U.u1, { jql: `workspace = "${WNAME.a}"`, limit: 5, checkValues: true }),
    ).rejects.toMatchObject({ status: 422, code: 'FIELD_NOT_ALLOWED_IN_SCOPE' });
  });

  it('giá trị chỉ có ở MỘT không gian → không gian kia 0 việc, không lỗi', async () => {
    const res = await call(U.u1, 'status = "Chờ test"');
    expect(res.data).toHaveLength(1);
    expect(res.data[0]!.workspace.id).toBe(W.a);
  });

  it('giá trị không có ở MỌI không gian → 422', async () => {
    await expect(call(U.u1, 'status = "Không có thật"')).rejects.toMatchObject({ status: 422 });
  });

  it('JQL sai cú pháp → 422', async () => {
    await expect(call(U.u1, 'status = = x')).rejects.toMatchObject({ status: 422 });
  });

  it('phân trang 3 trang: không trùng, không sót, đúng thứ tự (updatedAt DESC, id ASC)', async () => {
    const full = await call(U.u1, 'type = Task');
    const total = full.data.length; // 9 (a) + 8 (b công khai)
    expect(total).toBe(17);
    const limit = Math.ceil(total / 3);
    const seen: { id: string; updatedAt: string }[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const r = await call(U.u1, 'type = Task', { limit, cursor });
      seen.push(...(r.data as { id: string; updatedAt: string }[]));
      pages++;
      if (!(r.pageInfo as { hasNextPage: boolean }).hasNextPage) break;
      cursor = (r.pageInfo as { endCursor: string }).endCursor;
      expect(pages).toBeLessThan(10);
    }
    expect(pages).toBe(3);
    expect(new Set(seen.map((s) => s.id)).size).toBe(total);
    expect(seen.map((s) => s.id).sort()).toEqual(idsOf(full).sort());
    const expected = [...seen].sort(
      (x, y) => y.updatedAt.localeCompare(x.updatedAt) || (x.id < y.id ? -1 : 1),
    );
    expect(seen.map((s) => s.id)).toEqual(expected.map((s) => s.id));
    expect(idsOf(full)).toEqual(seen.map((s) => s.id));
  });

  it('phân trang với ORDER BY due ASC (có NULL): không trùng/sót, NULL cuối', async () => {
    // Thêm hạn cho vài việc ở hai workspace.
    const dueIssues = issueIds.slice(0, 3).concat(issueIds.slice(8, 11));
    for (const [i, iid] of dueIssues.entries())
      await prisma.issue.update({
        where: { id: iid },
        data: { dueDate: new Date(base + (i % 4) * dayMs * 3) },
      });
    const jql = 'type = Task ORDER BY due ASC';
    const full = await call(U.u1, jql);
    const seen: { id: string; dueDate: string | null }[] = [];
    let cursor: string | undefined;
    for (let p = 0; p < 12; p++) {
      const r = await call(U.u1, jql, { limit: 4, cursor });
      seen.push(...(r.data as { id: string; dueDate: string | null }[]));
      if (!(r.pageInfo as { hasNextPage: boolean }).hasNextPage) break;
      cursor = (r.pageInfo as { endCursor: string }).endCursor;
    }
    expect(new Set(seen.map((s) => s.id)).size).toBe(seen.length);
    expect(seen.map((s) => s.id).sort()).toEqual(idsOf(full).sort());
    const firstNull = seen.findIndex((s) => s.dueDate === null);
    expect(seen.slice(firstNull).every((s) => s.dueDate === null)).toBe(true);
    const dated = seen.slice(0, firstNull).map((s) => s.dueDate!);
    expect(dated).toEqual([...dated].sort());
  });
});
