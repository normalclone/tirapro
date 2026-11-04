/* eslint-disable max-lines-per-function -- spec tích hợp: một describe lớn dùng chung dữ liệu nạp một lần */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertParityDatabase } from '../../common/testing/parity-db-guard';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { ProjectAccessService } from '../rbac/project-access.service';
import { RbacService } from '../rbac/rbac.service';
import { ProgramsService } from './programs.service';

/**
 * Nhóm dự án nhiều–nhiều TRÊN POSTGRES THẬT — OPT-IN (`test:parity`). ProgramsService + ProjectAccessService THẬT; RBAC giả
 * (quản trị thấy mọi dự án, người thường thấy công khai + dự án mình là thành viên). Kiểm: một dự án nhiều nhóm; số dự án
 * của nhóm chỉ đếm dự án NGƯỜI XEM thấy (dự án riêng tư không lộ qua số đếm/danh sách/cây); đặt nhóm theo dự án / theo nhóm
 * không đụng liên kết của dự án khác hay của nhóm khác; ràng buộc `projectId` bắt buộc ở DB.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

describe.skipIf(!DB_URL)('nhóm dự án nhiều–nhiều ↔ Postgres thật', () => {
  const TAG = `pg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const id = (n: string) => `${TAG}-${n}`;
  const U = { member: id('member'), other: id('other'), admin: id('admin') };
  const WS = id('ws');
  const P = {
    pub: id('pub'),
    priv: id('priv'), // riêng tư: chỉ `member` (và quản trị) thấy
    arch: id('arch'),
    del: id('del'),
    solo: id('solo'),
  };
  const G = { a: id('ga'), b: id('gb'), empty: id('gempty') };

  let prisma: PrismaClient;
  let svc: ProgramsService;

  const linksOf = async (projectId: string) =>
    (
      await prisma.projectProgram.findMany({ where: { projectId }, orderBy: { programId: 'asc' } })
    ).map((l) => l.programId);
  const membersOf = async (programId: string) =>
    (
      await prisma.projectProgram.findMany({ where: { programId }, orderBy: { projectId: 'asc' } })
    ).map((l) => l.projectId);
  const reset = async () => {
    await prisma.projectProgram.deleteMany({ where: { program: { organizationId: WS } } });
    const link = (projectId: string, programId: string) =>
      prisma.projectProgram.create({ data: { projectId, programId } });
    await link(P.pub, G.a);
    await link(P.pub, G.b);
    await link(P.priv, G.a);
    await link(P.arch, G.b);
    await link(P.del, G.a);
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
    for (const [k, u] of Object.entries(U))
      await prisma.user.create({
        data: { id: u, email: `${u}@x.test`, displayName: k, status: 'ACTIVE' },
      });
    await prisma.organization.create({ data: { id: WS, name: WS, slug: WS, ownerId: U.admin } });
    await prisma.role.create({
      data: { id: id('wrole'), organizationId: WS, name: 'R', scope: 'ORGANIZATION' },
    });
    await prisma.role.create({
      data: { id: id('prole'), organizationId: WS, name: 'PR', scope: 'PROJECT' },
    });
    for (const u of Object.values(U))
      await prisma.organizationMembership.create({
        data: { organizationId: WS, userId: u, roleId: id('wrole') },
      });
    const k = TAG.slice(2, 7).toUpperCase();
    const proj = (pid: string, key: string, over: Record<string, unknown> = {}) =>
      prisma.project.create({
        data: { id: pid, organizationId: WS, key: `${k}${key}`, name: `${k}${key}`, ...over },
      });
    await proj(P.pub, '1');
    await proj(P.priv, '2', { isPrivate: true });
    await proj(P.arch, '3', { archivedAt: new Date(), isArchived: true });
    await proj(P.del, '4', { deletedAt: new Date() });
    await proj(P.solo, '5');
    await prisma.projectMembership.create({
      data: { id: id('m1'), projectId: P.priv, userId: U.member, roleId: id('prole') },
    });
    for (const [gid, name] of [
      [G.a, 'A'],
      [G.b, 'B'],
      [G.empty, 'Rỗng'],
    ] as const)
      await prisma.program.create({
        data: { id: gid, organizationId: WS, name: `${name}-${TAG}` },
      });
    await reset();

    // RbacService THẬT (assertProjectVisible/404 thật), chỉ đặt cố định chế độ xem dự án theo người.
    const ps = prisma as unknown as PrismaService;
    class TestRbac extends RbacService {
      override projectVisibilityMode(u: string): Promise<'all' | 'standard' | 'memberOnly'> {
        return Promise.resolve(u === U.admin ? 'all' : 'standard');
      }
    }
    const rbac = new TestRbac(ps, { getClient: () => null, isAvailable: () => false } as never);
    svc = new ProgramsService(
      ps,
      { forProjects: () => Promise.resolve(new Map()) } as never,
      new ProjectAccessService(ps, rbac),
    );
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.slaPolicy.deleteMany({ where: { organizationId: WS } });
    await prisma.raidItem.deleteMany({ where: { organizationId: WS } });
    await prisma.objective.deleteMany({ where: { organizationId: WS } });
    await prisma.projectProgram.deleteMany({ where: { program: { organizationId: WS } } });
    await prisma.projectMembership.deleteMany({ where: { project: { organizationId: WS } } });
    await prisma.project.deleteMany({ where: { organizationId: WS } });
    await prisma.program.deleteMany({ where: { organizationId: WS } });
    await prisma.organizationMembership.deleteMany({ where: { organizationId: WS } });
    await prisma.role.deleteMany({ where: { organizationId: WS } });
    await prisma.organization.deleteMany({ where: { id: WS } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(U) } } });
    await prisma.$disconnect();
  }, 120_000);

  const counts = async (viewer: string) =>
    Object.fromEntries((await svc.list(WS, viewer)).map((g) => [g.id, g.projectCount]));
  const keysIn = async (viewer: string, gid: string) =>
    (await svc.get(WS, gid, viewer)).projects.map((p) => p.id).sort();

  it('một dự án thuộc nhiều nhóm: hiện dưới từng nhóm', async () => {
    await reset();
    expect(await keysIn(U.admin, G.a)).toEqual([P.pub, P.priv].sort());
    expect(await keysIn(U.admin, G.b)).toEqual([P.pub, P.arch].sort());
    expect(await linksOf(P.pub)).toEqual([G.a, G.b].sort());
  });

  it('projectCount chỉ đếm dự án NGƯỜI XEM thấy: người ngoài không thấy dự án riêng tư; dự án xoá mềm không đếm; lưu trữ vẫn đếm', async () => {
    await reset();
    const other = await counts(U.other);
    expect(other[G.a]).toBe(1); // pub (priv ẩn, del xoá mềm)
    expect(other[G.b]).toBe(2); // pub + arch
    expect(other[G.empty]).toBe(0);
    const member = await counts(U.member);
    expect(member[G.a]).toBe(2); // pub + priv
    const admin = await counts(U.admin);
    expect(admin[G.a]).toBe(2); // quản trị thấy priv, del vẫn xoá mềm
    expect(admin[G.b]).toBe(2);
    // danh sách tên dự án cũng không lộ dự án riêng tư
    expect(await keysIn(U.other, G.a)).toEqual([P.pub]);
    expect((await svc.get(WS, G.a, U.other)).projects.map((p) => p.id)).not.toContain(P.priv);
  });

  it('rollup: người ngoài không thấy dự án riêng tư trong cây; dự án nhiều nhóm hiện dưới từng nhóm, tổng đếm một lần', async () => {
    await reset();
    await prisma.projectProgram.deleteMany({ where: { projectId: P.solo } }); // solo: chưa thuộc nhóm nào
    const r = await svc.rollup(WS, U.other);
    const inGroup = (gid: string | null) =>
      r.groups
        .find((g) => g.id === gid)
        ?.projects.map((p) => p.id)
        .sort() ?? [];
    expect(inGroup(G.a)).toEqual([P.pub]);
    expect(inGroup(G.b)).toEqual([P.pub, P.arch].sort());
    expect(inGroup(null)).toEqual([P.solo]);
    expect(r.groups.flatMap((g) => g.projects.map((p) => p.id))).not.toContain(P.priv);
    expect(r.totals.projectCount).toBe(3); // pub, arch, solo — mỗi dự án một lần
    const asMember = await svc.rollup(WS, U.member);
    expect(asMember.groups.find((g) => g.id === G.a)!.projects.map((p) => p.id)).toContain(P.priv);
  });

  it('setForProject: thay toàn bộ nhóm của ĐÚNG dự án đó, không đụng dự án khác; nhóm lạ → 422; trả danh sách theo tên', async () => {
    await reset();
    const r = await svc.setForProject(WS, P.pub, [G.b, G.empty], U.admin);
    expect(r.programs.map((p) => p.id).sort()).toEqual([G.b, G.empty].sort());
    expect(await linksOf(P.pub)).toEqual([G.b, G.empty].sort());
    // dự án khác giữ nguyên
    expect(await linksOf(P.priv)).toEqual([G.a]);
    expect(await linksOf(P.arch)).toEqual([G.b]);
    // gỡ hết
    await svc.setForProject(WS, P.pub, [], U.admin);
    expect(await linksOf(P.pub)).toEqual([]);
    // nhóm không tồn tại / của tổ chức khác → 422 và không ghi
    await expect(svc.setForProject(WS, P.pub, ['khong-co'], U.admin)).rejects.toMatchObject({
      status: 422,
    });
    expect(await linksOf(P.pub)).toEqual([]);
    // gửi trùng id không lỗi
    await svc.setForProject(WS, P.pub, [G.a, G.a], U.admin);
    expect(await linksOf(P.pub)).toEqual([G.a]);
  });

  it('setForProject: người không thấy dự án riêng tư nhận 404 như dự án không tồn tại; dự án xoá mềm → 404; lưu trữ vẫn đổi được', async () => {
    await reset();
    await expect(svc.setForProject(WS, P.priv, [G.b], U.other)).rejects.toMatchObject({
      status: 404,
    });
    expect(await linksOf(P.priv)).toEqual([G.a]);
    await expect(svc.setForProject(WS, P.del, [G.b], U.admin)).rejects.toMatchObject({
      status: 404,
    });
    await svc.setForProject(WS, P.arch, [G.a], U.admin);
    expect(await linksOf(P.arch)).toEqual([G.a]);
  });

  it('setProjects (theo nhóm): chỉ gỡ dự án người gọi thấy, KHÔNG gỡ dự án riêng tư ẩn; không đụng các nhóm khác của dự án', async () => {
    await reset();
    // `other` đặt nhóm A chỉ còn solo: pub bị gỡ khỏi A, priv (ẩn) và del (xoá mềm) ở lại; pub vẫn ở B
    await svc.setProjects(WS, G.a, [P.solo], U.other);
    expect(await membersOf(G.a)).toEqual([P.priv, P.del, P.solo].sort());
    expect(await linksOf(P.pub)).toEqual([G.b]);
    // dự án riêng tư không thấy → 422 như dự án ngoài tổ chức, không ghi
    await expect(svc.setProjects(WS, G.a, [P.priv], U.other)).rejects.toMatchObject({
      status: 422,
    });
    expect(await membersOf(G.a)).toEqual([P.priv, P.del, P.solo].sort());
  });

  it('xoá nhóm gỡ liên kết của nhóm (không xoá dự án); xoá dự án gỡ liên kết (không xoá nhóm)', async () => {
    await reset();
    await svc.remove(WS, G.empty);
    expect(await prisma.program.count({ where: { id: G.empty } })).toBe(0);
    const extra = id('extra-project');
    await prisma.project.create({
      data: {
        id: extra,
        organizationId: WS,
        key: `${TAG.slice(2, 7).toUpperCase()}9`,
        name: `x-${TAG}`,
      },
    });
    await prisma.projectProgram.create({ data: { projectId: extra, programId: G.a } });
    await prisma.project.delete({ where: { id: extra } });
    expect(await prisma.projectProgram.count({ where: { projectId: extra } })).toBe(0);
    expect(await prisma.program.count({ where: { id: G.a } })).toBe(1);
    await prisma.program.create({ data: { id: G.empty, organizationId: WS, name: `Rong-${TAG}` } });
  });

  it('mục tiêu / rủi ro / chính sách thời gian xử lý: DB từ chối projectId rỗng', async () => {
    const now = new Date();
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "Objective"(id,"organizationId","projectId",name,period,"updatedAt") VALUES ('${id('o')}','${WS}',NULL,'x','2026-Q4','${now.toISOString()}')`,
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "RaidItem"(id,"organizationId","projectId",title,"updatedAt") VALUES ('${id('r')}','${WS}',NULL,'x','${now.toISOString()}')`,
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "SlaPolicy"(id,"organizationId","projectId",name,"responseMins","resolveMins","updatedAt") VALUES ('${id('s')}','${WS}',NULL,'x',5,60,'${now.toISOString()}')`,
      ),
    ).rejects.toThrow();
  });
});
