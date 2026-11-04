/* eslint-disable max-lines-per-function -- spec tích hợp: một describe lớn dùng chung dữ liệu nạp một lần */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertParityDatabase } from '../../common/testing/parity-db-guard';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { ProjectAccessService } from '../rbac/project-access.service';
import { SavedFiltersService, type CreateSavedFilterInput } from './saved-filters.service';

/**
 * Chia sẻ bộ lọc theo dự án + người cụ thể TRÊN POSTGRES THẬT — OPT-IN (`test:parity`). Dịch vụ + ProjectAccessService THẬT;
 * RBAC giả (admin thấy mọi dự án, người thường thấy công khai + dự án mình là thành viên); SearchService/Notifications ghi lại lời gọi.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

describe.skipIf(!DB_URL)('bộ lọc chia sẻ ↔ Postgres thật', () => {
  const TAG = `sf${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const id = (n: string) => `${TAG}-${n}`;
  const U = {
    owner: id('owner'),
    a: id('a'), // thành viên dự án P1
    b: id('b'), // được chia sẻ trực tiếp
    c: id('c'), // người ngoài (thành viên tổ chức)
    d: id('d'), // KHÔNG thuộc tổ chức
    admin: id('admin'), // quản trị: thấy mọi dự án, nhưng không tự thấy bộ lọc riêng tư
    off: id('off'), // đã vô hiệu hoá
  };
  const WS = id('ws');
  const WS2 = id('ws2');
  const P = {
    p1: id('p1'),
    p2: id('p2'),
    p3: id('p3'),
    later: id('plater'),
    pDel: id('pdel'),
    other: id('pother'),
  };

  let prisma: PrismaClient;
  let svc: SavedFiltersService;
  const publish = vi.fn((_input: { recipientId: string }) => Promise.resolve());
  const runSearch = vi.fn((..._a: unknown[]) => Promise.resolve({ data: [], pageInfo: {} }));

  const mk = (userId: string, input: Partial<CreateSavedFilterInput>) =>
    svc.create(WS, userId, { name: 'Bug tuần này', jql: 'type = Bug', ...input });
  const listIds = async (userId: string) => (await svc.list(WS, userId)).map((f) => f.id);

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
    for (const [k, u] of Object.entries(U))
      await prisma.user.create({
        data: {
          id: u,
          email: `${u}@x.test`,
          displayName: k,
          status: k === 'off' ? 'DEACTIVATED' : 'ACTIVE',
        },
      });
    for (const w of [WS, WS2]) {
      await prisma.workspace.create({ data: { id: w, name: w, slug: w, ownerId: U.owner } });
      await prisma.role.create({
        data: { id: `${w}-role`, workspaceId: w, name: 'R', scope: 'WORKSPACE' },
      });
    }
    for (const u of [U.owner, U.a, U.b, U.c, U.admin, U.off])
      await prisma.workspaceMembership.create({
        data: { workspaceId: WS, userId: u, roleId: `${WS}-role` },
      });
    await prisma.workspaceMembership.create({
      data: { workspaceId: WS2, userId: U.d, roleId: `${WS2}-role` },
    });
    const proj = (
      pid: string,
      ws: string,
      key: string,
      isPrivate: boolean,
      deletedAt: Date | null = null,
    ) =>
      prisma.project.create({
        data: { id: pid, workspaceId: ws, key, name: key, isPrivate, deletedAt },
      });
    const k = TAG.slice(2, 7).toUpperCase();
    await proj(P.p1, WS, `${k}1`, false);
    await proj(P.p2, WS, `${k}2`, true);
    await proj(P.p3, WS, `${k}3`, true);
    await proj(P.pDel, WS, `${k}D`, false, new Date());
    await proj(P.other, WS2, `${k}X`, false);
    await prisma.role.create({
      data: { id: id('prole'), workspaceId: WS, name: 'PR', scope: 'PROJECT' },
    });
    const member = (n: string, pid: string, uid: string) =>
      prisma.projectMembership.create({
        data: { id: id(n), projectId: pid, userId: uid, roleId: id('prole') },
      });
    await member('m-o1', P.p1, U.owner);
    await member('m-o2', P.p2, U.owner);
    await member('m-a1', P.p1, U.a);
    await member('m-a-del', P.pDel, U.a);
    await member('m-o-del', P.pDel, U.owner);
    await member('m-a3', P.p3, U.a); // a thuộc p3, owner thì không

    const rbac = {
      projectVisibilityMode: (u: string) =>
        Promise.resolve(u === U.admin ? 'all' : 'memberOrPublic'),
    };
    const ps = prisma as unknown as PrismaService;
    svc = new SavedFiltersService(
      ps,
      { search: runSearch } as never,
      new ProjectAccessService(ps, rbac as never),
      { publish } as never,
    );
  }, 120_000);

  beforeEach(() => {
    publish.mockClear();
    runSearch.mockClear();
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.savedFilter.deleteMany({ where: { workspaceId: { in: [WS, WS2] } } });
    await prisma.projectMembership.deleteMany({
      where: { project: { workspaceId: { in: [WS, WS2] } } },
    });
    await prisma.project.deleteMany({ where: { workspaceId: { in: [WS, WS2] } } });
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId: { in: [WS, WS2] } } });
    await prisma.role.deleteMany({ where: { workspaceId: { in: [WS, WS2] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [WS, WS2] } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(U) } } });
    await prisma.$disconnect();
  }, 120_000);

  it('PRIVATE: chỉ chủ thấy; quản trị cũng KHÔNG tự thấy; chạy bởi người ngoài → 404', async () => {
    const f = await mk(U.owner, {});
    expect(f.visibility).toBe('PRIVATE');
    expect(f.access).toBe('owner');
    expect(await listIds(U.owner)).toContain(f.id);
    for (const u of [U.a, U.b, U.c, U.admin]) expect(await listIds(u)).not.toContain(f.id);
    await expect(svc.run(WS, U.admin, f.id, { limit: 10 })).rejects.toMatchObject({ status: 404 });
  });

  it('chia sẻ theo dự án: thành viên dự án thấy, người không thuộc dự án thì không (kể cả khi dự án công khai); chạy theo quyền NGƯỜI XEM', async () => {
    const f = await mk(U.owner, { visibility: 'SHARED', sharedProjectIds: [P.p1, P.p2] });
    expect(f.visibility).toBe('SHARED');
    expect(f.sharedProjects.map((p) => p.id).sort()).toEqual([P.p1, P.p2].sort());
    expect(await listIds(U.a)).toContain(f.id);
    expect(await listIds(U.c)).not.toContain(f.id);
    expect(await listIds(U.admin)).not.toContain(f.id);
    const seen = (await svc.list(WS, U.a)).find((x) => x.id === f.id)!;
    expect(seen.access).toBe('shared');
    expect(seen.isOwner).toBe(false);
    expect(seen.owner?.id).toBe(U.owner);
    // a thấy p1 nhưng KHÔNG thấy tên p2 (riêng tư, a không thuộc) và không thấy ai được chia sẻ trực tiếp
    expect(seen.sharedProjects.map((p) => p.id)).toEqual([P.p1]);
    expect(seen.sharedUsers).toEqual([]);
    await svc.run(WS, U.a, f.id, { limit: 10 });
    expect(runSearch).toHaveBeenCalledWith(WS, U.a, expect.objectContaining({ jql: 'type = Bug' }));
  });

  it('mất tư cách thành viên dự án → không còn thấy; dự án bị xoá mềm → chia sẻ qua dự án đó vô hiệu', async () => {
    const f = await mk(U.owner, { visibility: 'SHARED', sharedProjectIds: [P.p1] });
    expect(await listIds(U.a)).toContain(f.id);
    const mem = await prisma.projectMembership.findFirstOrThrow({
      where: { projectId: P.p1, userId: U.a },
    });
    await prisma.projectMembership.delete({ where: { id: mem.id } });
    expect(await listIds(U.a)).not.toContain(f.id);
    await expect(svc.run(WS, U.a, f.id, { limit: 10 })).rejects.toMatchObject({ status: 404 });
    await prisma.projectMembership.create({
      data: { id: mem.id, projectId: P.p1, userId: U.a, roleId: id('prole') },
    });
    expect(await listIds(U.a)).toContain(f.id);
  });

  it('dự án bị xoá mềm SAU khi chia sẻ → thành viên không còn thấy bộ lọc qua dự án đó, dự án biến khỏi danh sách chia sẻ', async () => {
    await prisma.project.create({
      data: {
        id: P.later,
        workspaceId: WS,
        key: `${TAG.slice(2, 7).toUpperCase()}L`,
        name: 'later',
      },
    });
    for (const [n, u] of [
      ['m-l-o', U.owner],
      ['m-l-a', U.a],
    ] as const)
      await prisma.projectMembership.create({
        data: { id: id(n), projectId: P.later, userId: u, roleId: id('prole') },
      });
    const g = await mk(U.owner, { visibility: 'SHARED', sharedProjectIds: [P.later] });
    expect(await listIds(U.a)).toContain(g.id);
    await prisma.project.update({ where: { id: P.later }, data: { deletedAt: new Date() } });
    expect(await listIds(U.a)).not.toContain(g.id);
    const mine = (await svc.list(WS, U.owner)).find((x) => x.id === g.id)!;
    expect(mine.sharedProjects).toEqual([]);
  });

  it('chia sẻ cho dự án đã xoá hoặc ở tổ chức khác hoặc chủ không xem được → 422 FILTER_SHARE_PROJECT_NOT_VISIBLE', async () => {
    for (const p of [P.pDel, P.other, P.p3]) {
      await expect(
        mk(U.owner, { visibility: 'SHARED', sharedProjectIds: [p] }),
        p,
      ).rejects.toMatchObject({
        status: 422,
        code: 'FILTER_SHARE_PROJECT_NOT_VISIBLE',
      });
    }
    // trộn dự án hợp lệ + không hợp lệ cũng bị chặn (không lưu một phần)
    await expect(
      mk(U.owner, { visibility: 'SHARED', sharedProjectIds: [P.p1, P.p3] }),
    ).rejects.toMatchObject({
      code: 'FILTER_SHARE_PROJECT_NOT_VISIBLE',
    });
  });

  it('chia sẻ cho người ngoài tổ chức / đã vô hiệu hoá → 422 FILTER_SHARE_USER_NOT_MEMBER, nêu tên', async () => {
    const before = await prisma.savedFilter.count({ where: { workspaceId: WS } });
    await expect(mk(U.owner, { visibility: 'SHARED', sharedUserIds: [U.d] })).rejects.toMatchObject(
      {
        status: 422,
        code: 'FILTER_SHARE_USER_NOT_MEMBER',
        message: expect.stringContaining('d') as unknown,
      },
    );
    await expect(
      mk(U.owner, { visibility: 'SHARED', sharedUserIds: [U.off] }),
    ).rejects.toMatchObject({
      code: 'FILTER_SHARE_USER_NOT_MEMBER',
    });
    expect(await prisma.savedFilter.count({ where: { workspaceId: WS } })).toBe(before); // không lưu bộ lọc dở dang
  });

  it('chia sẻ trực tiếp cho người: người đó thấy (kể cả không thuộc dự án nào), người khác không; danh sách người chỉ chủ thấy đủ', async () => {
    const f = await mk(U.owner, { visibility: 'SHARED', sharedUserIds: [U.b, U.c] });
    expect(await listIds(U.b)).toContain(f.id);
    expect(await listIds(U.c)).toContain(f.id);
    expect(await listIds(U.a)).not.toContain(f.id);
    const asB = (await svc.list(WS, U.b)).find((x) => x.id === f.id)!;
    expect(asB.sharedUsers.map((u) => u.id)).toEqual([U.b]); // chỉ thấy chính mình
    const asOwner = (await svc.list(WS, U.owner)).find((x) => x.id === f.id)!;
    expect(asOwner.sharedUsers.map((u) => u.id).sort()).toEqual([U.b, U.c].sort());
    expect(asOwner.sharedUsers[0]).toEqual(
      expect.objectContaining({ displayName: expect.any(String) as unknown }),
    );
  });

  it('dự án + người cùng lúc; bỏ chia sẻ (PRIVATE) xoá hết dòng', async () => {
    const f = await mk(U.owner, {
      visibility: 'SHARED',
      sharedProjectIds: [P.p1],
      sharedUserIds: [U.b],
    });
    expect(await listIds(U.a)).toContain(f.id);
    expect(await listIds(U.b)).toContain(f.id);
    const back = await svc.update(WS, U.owner, f.id, { visibility: 'PRIVATE' });
    expect(back.visibility).toBe('PRIVATE');
    expect(back.sharedProjects).toEqual([]);
    expect(back.sharedUsers).toEqual([]);
    expect(await prisma.savedFilterProjectShare.count({ where: { filterId: f.id } })).toBe(0);
    expect(await prisma.savedFilterUserShare.count({ where: { filterId: f.id } })).toBe(0);
    expect(await listIds(U.a)).not.toContain(f.id);
  });

  it('chỉ chủ sửa/xoá/đổi chia sẻ: người được chia sẻ nhận 403', async () => {
    const f = await mk(U.owner, { visibility: 'SHARED', sharedUserIds: [U.b] });
    await expect(svc.update(WS, U.b, f.id, { name: 'x' })).rejects.toMatchObject({ status: 403 });
    await expect(
      svc.update(WS, U.b, f.id, { visibility: 'SHARED', sharedUserIds: [U.c] }),
    ).rejects.toMatchObject({
      status: 403,
    });
    await expect(svc.softDelete(WS, U.b, f.id)).rejects.toMatchObject({ status: 403 });
    // người hoàn toàn ngoài: vẫn 403 (đường mutate không lộ tồn tại khác nhau) — theo hành vi hiện có là 403 nếu tồn tại
    await expect(svc.update(WS, U.c, f.id, { name: 'x' })).rejects.toMatchObject({ status: 403 });
  });

  it('thông báo chỉ gửi người MỚI được thêm: tạo → 1; thêm người → chỉ người đó; lưu lại y nguyên → 0; gỡ rồi thêm lại → báo lại', async () => {
    const f = await mk(U.owner, { visibility: 'SHARED', sharedUserIds: [U.b] });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recipientId: U.b,
        workspaceId: WS,
        type: 'FILTER_SHARED',
        actorId: U.owner,
        payload: { filterId: f.id, filterName: 'Bug tuần này' },
      }),
    );
    publish.mockClear();
    await svc.update(WS, U.owner, f.id, { sharedUserIds: [U.b, U.c] });
    expect(publish.mock.calls.map((c) => c[0].recipientId)).toEqual([U.c]);
    publish.mockClear();
    await svc.update(WS, U.owner, f.id, { visibility: 'SHARED', sharedUserIds: [U.b, U.c] });
    expect(publish).not.toHaveBeenCalled();
    await svc.update(WS, U.owner, f.id, { name: 'Đổi tên' }); // không đụng chia sẻ
    expect(publish).not.toHaveBeenCalled();
    await svc.update(WS, U.owner, f.id, { sharedUserIds: [U.b] });
    expect(publish).not.toHaveBeenCalled();
    await svc.update(WS, U.owner, f.id, { sharedUserIds: [U.b, U.c] });
    expect(publish.mock.calls.map((c) => c[0].recipientId)).toEqual([U.c]);
  });

  it('chia sẻ chỉ theo dự án không gửi thông báo cá nhân; tự chia sẻ cho chính mình bị bỏ qua', async () => {
    await mk(U.owner, {
      visibility: 'SHARED',
      sharedProjectIds: [P.p1],
      sharedUserIds: [U.owner, U.b],
    });
    expect(publish.mock.calls.map((c) => c[0].recipientId)).toEqual([U.b]);
  });

  it('SHARED không có đích → 422; đổi tên/JQL một bộ lọc đang chia sẻ giữ nguyên chia sẻ', async () => {
    await expect(mk(U.owner, { visibility: 'SHARED' })).rejects.toMatchObject({ status: 422 });
    const f = await mk(U.owner, { visibility: 'SHARED', sharedProjectIds: [P.p1] });
    const u = await svc.update(WS, U.owner, f.id, { name: 'Tên mới', jql: 'type = Task' });
    expect(u.visibility).toBe('SHARED');
    expect(u.sharedProjects.map((p) => p.id)).toEqual([P.p1]);
  });
});
