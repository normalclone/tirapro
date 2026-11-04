/* eslint-disable max-lines-per-function -- spec tích hợp: một describe lớn dùng chung dữ liệu nạp một lần */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertParityDatabase } from '../../common/testing/parity-db-guard';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { ProjectAccessService } from '../rbac/project-access.service';
import { RbacService } from '../rbac/rbac.service';
import { ProgramsService } from './programs.service';

/**
 * Nhóm dự án CÁ NHÂN (mỗi người một bộ nhóm) TRÊN POSTGRES THẬT — OPT-IN (`test:parity`). ProgramsService +
 * ProjectAccessService THẬT; RBAC giả (quản trị thấy mọi dự án, người thường thấy công khai + dự án mình là thành viên).
 * Kiểm: cô lập theo chủ nhóm (A không thấy/sửa/xoá nhóm của B; A sửa nhóm cho cùng một dự án thì liên kết của B không đổi);
 * một dự án thuộc nhiều nhóm của nhiều người; số dự án của nhóm chỉ đếm dự án NGƯỜI XEM thấy; tên nhóm duy nhất theo từng
 * chủ; ràng buộc `ownerId`/`projectId` bắt buộc ở DB.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

describe.skipIf(!DB_URL)('nhóm dự án cá nhân ↔ Postgres thật', () => {
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
  // Chủ nhóm: member → ga, gempty; other → gb; admin → gc.
  const G = { a: id('ga'), b: id('gb'), c: id('gc'), empty: id('gempty') };

  let prisma: PrismaClient;
  let svc: ProgramsService;

  const linksOf = async (projectId: string) =>
    (
      await prisma.projectProgram.findMany({ where: { projectId }, orderBy: { programId: 'asc' } })
    ).map((l) => l.programId);
  const reset = async () => {
    await prisma.projectProgram.deleteMany({ where: { program: { workspaceId: WS } } });
    const link = (projectId: string, programId: string) =>
      prisma.projectProgram.create({ data: { projectId, programId } });
    await link(P.pub, G.a);
    await link(P.pub, G.b);
    await link(P.pub, G.c);
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
    await prisma.workspace.create({ data: { id: WS, name: WS, slug: WS, ownerId: U.admin } });
    await prisma.role.create({
      data: { id: id('wrole'), workspaceId: WS, name: 'R', scope: 'WORKSPACE' },
    });
    await prisma.role.create({
      data: { id: id('prole'), workspaceId: WS, name: 'PR', scope: 'PROJECT' },
    });
    for (const u of Object.values(U))
      await prisma.workspaceMembership.create({
        data: { workspaceId: WS, userId: u, roleId: id('wrole') },
      });
    const k = TAG.slice(2, 7).toUpperCase();
    const proj = (pid: string, key: string, over: Record<string, unknown> = {}) =>
      prisma.project.create({
        data: { id: pid, workspaceId: WS, key: `${k}${key}`, name: `${k}${key}`, ...over },
      });
    await proj(P.pub, '1');
    await proj(P.priv, '2', { isPrivate: true });
    await proj(P.arch, '3', { archivedAt: new Date(), isArchived: true });
    await proj(P.del, '4', { deletedAt: new Date() });
    await proj(P.solo, '5');
    await prisma.projectMembership.create({
      data: { id: id('m1'), projectId: P.priv, userId: U.member, roleId: id('prole') },
    });
    for (const [gid, name, owner] of [
      [G.a, 'A', U.member],
      [G.b, 'B', U.other],
      [G.c, 'C', U.admin],
      [G.empty, 'Rỗng', U.member],
    ] as const)
      await prisma.program.create({
        data: { id: gid, workspaceId: WS, ownerId: owner, name: `${name}-${TAG}` },
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
    svc = new ProgramsService(ps, new ProjectAccessService(ps, rbac));
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.slaPolicy.deleteMany({ where: { workspaceId: WS } });
    await prisma.raidItem.deleteMany({ where: { workspaceId: WS } });
    await prisma.objective.deleteMany({ where: { workspaceId: WS } });
    await prisma.projectProgram.deleteMany({ where: { program: { workspaceId: WS } } });
    await prisma.projectMembership.deleteMany({ where: { project: { workspaceId: WS } } });
    await prisma.project.deleteMany({ where: { workspaceId: WS } });
    await prisma.program.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId: WS } });
    await prisma.role.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(U) } } });
    await prisma.$disconnect();
  }, 120_000);

  const listIds = async (viewer: string) => (await svc.list(WS, viewer)).map((g) => g.id).sort();
  const counts = async (viewer: string) =>
    Object.fromEntries((await svc.list(WS, viewer)).map((g) => [g.id, g.projectCount]));
  const keysIn = async (viewer: string, gid: string) =>
    (await svc.get(WS, gid, viewer)).projects.map((p) => p.id).sort();

  it('mỗi người chỉ thấy nhóm CỦA MÌNH; nhóm của người khác 404 ở get/update/remove, dữ liệu không đổi', async () => {
    await reset();
    expect(await listIds(U.member)).toEqual([G.a, G.empty].sort());
    expect(await listIds(U.other)).toEqual([G.b]);
    expect(await listIds(U.admin)).toEqual([G.c]); // kể cả quản trị tổ chức không thấy nhóm của người khác
    await expect(svc.get(WS, G.a, U.other)).rejects.toMatchObject({ status: 404 });
    await expect(svc.update(WS, G.a, { name: 'Chiếm' }, U.other)).rejects.toMatchObject({
      status: 404,
    });
    await expect(svc.remove(WS, G.a, U.admin)).rejects.toMatchObject({ status: 404 });
    const still = await prisma.program.findUniqueOrThrow({ where: { id: G.a } });
    expect(still.name).toBe(`A-${TAG}`);
    expect(await linksOf(P.priv)).toEqual([G.a]);
  });

  it('một dự án thuộc nhiều nhóm của nhiều người: mỗi người thấy dự án dưới nhóm của mình', async () => {
    await reset();
    expect(await linksOf(P.pub)).toEqual([G.a, G.b, G.c].sort());
    expect(await keysIn(U.member, G.a)).toEqual([P.pub, P.priv].sort());
    expect(await keysIn(U.other, G.b)).toEqual([P.pub, P.arch].sort());
    expect(await keysIn(U.admin, G.c)).toEqual([P.pub]);
  });

  it('projectCount chỉ đếm dự án NGƯỜI XEM thấy: dự án riêng tư không lộ cho người ngoài; xoá mềm không đếm; lưu trữ vẫn đếm', async () => {
    await reset();
    // other gom cả dự án riêng tư (không thấy) lẫn công khai vào nhóm của mình qua DB: danh sách chỉ hiện phần thấy được
    await prisma.projectProgram.create({ data: { projectId: P.priv, programId: G.b } });
    expect((await counts(U.other))[G.b]).toBe(2); // pub + arch (priv ẩn)
    expect(await keysIn(U.other, G.b)).toEqual([P.pub, P.arch].sort());
    expect((await counts(U.member))[G.a]).toBe(2); // pub + priv; del xoá mềm không đếm
    expect((await counts(U.admin))[G.c]).toBe(1);
    expect((await counts(U.member))[G.empty]).toBe(0);
  });

  it('setForProject: A đặt nhóm của mình cho dự án dùng chung → liên kết của B/C KHÔNG đổi; không cần quản trị dự án', async () => {
    await reset();
    // `member` (không phải quản trị) bỏ pub khỏi ga, đưa vào gempty
    const r = await svc.setForProject(WS, P.pub, [G.empty], U.member);
    expect(r.programs.map((p) => p.id)).toEqual([G.empty]); // chỉ trả nhóm CỦA MÌNH
    expect(await linksOf(P.pub)).toEqual([G.b, G.c, G.empty].sort()); // gb (other), gc (admin) nguyên vẹn
    // gỡ hết nhóm của mình: vẫn không động tới nhóm người khác
    await svc.setForProject(WS, P.pub, [], U.member);
    expect(await linksOf(P.pub)).toEqual([G.b, G.c].sort());
    // dự án khác của người khác giữ nguyên
    expect(await linksOf(P.arch)).toEqual([G.b]);
    expect(await linksOf(P.priv)).toEqual([G.a]);
  });

  it('setForProject: gán nhóm của NGƯỜI KHÁC hoặc nhóm lạ → 422, không ghi; gửi trùng id không lỗi', async () => {
    await reset();
    await expect(svc.setForProject(WS, P.pub, [G.b], U.member)).rejects.toMatchObject({
      status: 422,
    });
    await expect(svc.setForProject(WS, P.pub, ['khong-co'], U.member)).rejects.toMatchObject({
      status: 422,
    });
    expect(await linksOf(P.pub)).toEqual([G.a, G.b, G.c].sort());
    await svc.setForProject(WS, P.pub, [G.a, G.a], U.member);
    expect(await linksOf(P.pub)).toEqual([G.a, G.b, G.c].sort());
  });

  it('setForProject: dự án riêng tư không thấy → 404 như không tồn tại; xoá mềm → 404; lưu trữ vẫn đổi được', async () => {
    await reset();
    await expect(svc.setForProject(WS, P.priv, [G.b], U.other)).rejects.toMatchObject({
      status: 404,
    });
    expect(await linksOf(P.priv)).toEqual([G.a]);
    await expect(svc.setForProject(WS, P.del, [G.a], U.member)).rejects.toMatchObject({
      status: 404,
    });
    await svc.setForProject(WS, P.arch, [G.a], U.member);
    expect(await linksOf(P.arch)).toEqual([G.a, G.b].sort()); // ga thêm; gb của other nguyên vẹn
  });

  it('tạo nhóm: chủ là người gọi, mọi thành viên tạo được; tên trùng chỉ chặn trong nhóm của chính mình; DB cũng chặn', async () => {
    const mine = await svc.create(WS, { name: `Team-${TAG}` }, U.other);
    // người khác đặt cùng tên: được
    const theirs = await svc.create(WS, { name: `Team-${TAG}` }, U.member);
    expect(mine.id).not.toBe(theirs.id);
    expect(await listIds(U.other)).toContain(mine.id);
    expect(await listIds(U.other)).not.toContain(theirs.id);
    // chính mình đặt trùng: 422
    await expect(svc.create(WS, { name: `Team-${TAG}` }, U.other)).rejects.toMatchObject({
      status: 422,
    });
    // đổi tên thành tên nhóm khác CỦA MÌNH: 422; đổi giữ nguyên tên: ok
    await expect(svc.update(WS, mine.id, { name: `B-${TAG}` }, U.other)).rejects.toMatchObject({
      status: 422,
    });
    await svc.update(WS, mine.id, { name: `Team-${TAG}`, color: '#123456' }, U.other);
    // ràng buộc duy nhất ở DB: (workspace, chủ, tên)
    await expect(
      prisma.program.create({
        data: { workspaceId: WS, ownerId: U.other, name: `Team-${TAG}` },
      }),
    ).rejects.toThrow();
    await svc.remove(WS, mine.id, U.other);
    await svc.remove(WS, theirs.id, U.member);
  });

  it('tạo/sửa kèm projectIds: chỉ gắn dự án người gọi thấy, vào nhóm của mình', async () => {
    const g = await svc.create(WS, { name: `Kèm-${TAG}`, projectIds: [P.pub, P.solo] }, U.other);
    expect(g.projects.map((p) => p.id).sort()).toEqual([P.pub, P.solo].sort());
    await expect(
      svc.update(WS, g.id, { projectIds: [P.priv] }, U.other), // dự án riêng tư người này không thấy
    ).rejects.toMatchObject({ status: 422 });
    await svc.remove(WS, g.id, U.other);
  });

  it('xoá nhóm gỡ liên kết của nhóm (không xoá dự án); xoá dự án gỡ liên kết; xoá người dùng xoá nhóm riêng của họ', async () => {
    await reset();
    await svc.remove(WS, G.empty, U.member);
    expect(await prisma.program.count({ where: { id: G.empty } })).toBe(0);
    const extra = id('extra-project');
    await prisma.project.create({
      data: {
        id: extra,
        workspaceId: WS,
        key: `${TAG.slice(2, 7).toUpperCase()}9`,
        name: `x-${TAG}`,
      },
    });
    await prisma.projectProgram.create({ data: { projectId: extra, programId: G.a } });
    await prisma.project.delete({ where: { id: extra } });
    expect(await prisma.projectProgram.count({ where: { projectId: extra } })).toBe(0);
    expect(await prisma.program.count({ where: { id: G.a } })).toBe(1);

    const temp = id('temp-user');
    await prisma.user.create({
      data: { id: temp, email: `${temp}@x.test`, displayName: 'tmp', status: 'ACTIVE' },
    });
    const tg = await prisma.program.create({
      data: { workspaceId: WS, ownerId: temp, name: `T-${TAG}` },
    });
    await prisma.user.delete({ where: { id: temp } });
    expect(await prisma.program.count({ where: { id: tg.id } })).toBe(0);
    await prisma.program.create({
      data: { id: G.empty, workspaceId: WS, ownerId: U.member, name: `Rong-${TAG}` },
    });
  });

  it('DB từ chối nhóm không có chủ; mục tiêu / rủi ro / SLA không có dự án', async () => {
    const now = new Date();
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "Program"(id,"workspaceId",name,"updatedAt") VALUES ('${id('np')}','${WS}','vo-chu','${now.toISOString()}')`,
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "Objective"(id,"workspaceId","projectId",name,period,"updatedAt") VALUES ('${id('o')}','${WS}',NULL,'x','2026-Q4','${now.toISOString()}')`,
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "RaidItem"(id,"workspaceId","projectId",title,"updatedAt") VALUES ('${id('r')}','${WS}',NULL,'x','${now.toISOString()}')`,
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "SlaPolicy"(id,"workspaceId","projectId",name,"responseMins","resolveMins","updatedAt") VALUES ('${id('s')}','${WS}',NULL,'x',5,60,'${now.toISOString()}')`,
      ),
    ).rejects.toThrow();
  });
});
