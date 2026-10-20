/* eslint-disable max-lines-per-function -- spec tích hợp: một describe lớn dùng chung dữ liệu nạp một lần */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertParityDatabase } from '../../common/testing/parity-db-guard';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { RolesService } from './roles.service';

/**
 * CAS `expectedUpdatedAt` + chặn gỡ quản trị cuối cùng TRÊN POSTGRES THẬT (RC20) — OPT-IN, không chạy trong `pnpm test`.
 * Spec thường (`roles.service.spec.ts`) mock Prisma nên không chứng minh được: so bằng `updatedAt` (timestamp(3)) qua
 * `updateMany` khớp đúng sau khi đọc lại từ DB, `updatedAt` đổi thật khi chỉ ghi quan hệ, hai PATCH đồng thời cùng bản cũ
 * thì đúng MỘT thắng, và giao dịch lỗi hoàn lại bộ quyền cũ.
 *
 * Chạy: `PARITY_DATABASE_URL=postgresql://…/projira_w2c?schema=public pnpm --filter @tirapro/api test:parity`.
 * Mọi hàng mang TAG; bảng `Permission` (danh mục dùng chung) chỉ `upsert`, không xoá.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

describe.skipIf(!DB_URL)('sửa vai trò ↔ Postgres thật', () => {
  const TAG = `rol${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const id = (n: string) => `${TAG}-${n}`;
  const WS = id('ws');
  const U = { owner: id('owner'), a: id('ua'), b: id('ub') };
  const ROLE = { plain: id('plain'), admin: id('admin'), admin2: id('admin2') };

  let prisma: PrismaClient;
  let svc: RolesService;
  const emit = vi.fn();

  const keysOf = async (roleId: string) =>
    (
      await prisma.rolePermission.findMany({
        where: { roleId },
        select: { permission: { select: { key: true } } },
      })
    )
      .map((r) => r.permission.key)
      .sort();
  const updatedAtOf = async (roleId: string) =>
    (await prisma.role.findUniqueOrThrow({ where: { id: roleId } })).updatedAt;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
    for (const [key, scope] of [
      ['workspace:admin', 'WORKSPACE'],
      ['member:manage', 'WORKSPACE'],
      ['issue:edit', 'PROJECT'],
      ['issue:create', 'PROJECT'],
    ] as const) {
      await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: key, scope },
      });
    }
    for (const uid of Object.values(U)) {
      await prisma.user.create({
        data: { id: uid, email: `${uid}@roles.test`, displayName: uid },
      });
    }
    await prisma.workspace.create({
      data: { id: WS, name: TAG, slug: TAG, ownerId: U.owner },
    });
    const perm = async (keys: string[]) =>
      (
        await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } })
      ).map((p) => ({ permissionId: p.id }));
    const mkRole = async (rid: string, scope: 'WORKSPACE' | 'PROJECT', keys: string[]) =>
      prisma.role.create({
        data: {
          id: rid,
          workspaceId: WS,
          name: rid,
          scope,
          permissions: { create: await perm(keys) },
        },
      });
    await mkRole(ROLE.plain, 'PROJECT', ['issue:edit']);
    await mkRole(ROLE.admin, 'WORKSPACE', ['workspace:admin', 'member:manage']);
    await mkRole(ROLE.admin2, 'WORKSPACE', ['workspace:admin']);
    const member = async (uid: string, roleId: string) => {
      const m = await prisma.workspaceMembership.create({
        data: { workspaceId: WS, userId: uid, roleId },
      });
      await prisma.workspaceMembershipRole.create({ data: { membershipId: m.id, roleId } });
    };
    await member(U.a, ROLE.admin);

    svc = new RolesService(
      prisma as unknown as PrismaService,
      { invalidateWorkspace: vi.fn() } as never,
      { record: vi.fn() } as never,
      { emit } as never,
    );
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    const like = { startsWith: TAG };
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId: WS } });
    await prisma.role.deleteMany({ where: { id: like } });
    await prisma.workspace.deleteMany({ where: { id: like } });
    await prisma.user.deleteMany({ where: { id: like } });
    await prisma.$disconnect();
  }, 60_000);

  it('expectedUpdatedAt khớp (đọc lại từ DB) → ghi được, updatedAt đổi thật dù chỉ ghi quan hệ lồng', async () => {
    const before = await updatedAtOf(ROLE.plain);
    const dto = await svc.update(
      WS,
      ROLE.plain,
      { permissionKeys: ['issue:edit', 'issue:create'], expectedUpdatedAt: before.toISOString() },
      U.owner,
    );
    expect(await keysOf(ROLE.plain)).toEqual(['issue:create', 'issue:edit']);
    const after = await updatedAtOf(ROLE.plain);
    expect(after.getTime()).toBeGreaterThan(before.getTime());
    expect(dto.updatedAt).toBe(after.toISOString());
  });

  it('bản cũ → 409 VERSION_CONFLICT và bộ quyền KHÔNG đổi', async () => {
    const stale = new Date((await updatedAtOf(ROLE.plain)).getTime() - 5_000);
    await expect(
      svc.update(
        WS,
        ROLE.plain,
        { permissionKeys: ['issue:edit'], expectedUpdatedAt: stale.toISOString() },
        U.owner,
      ),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(await keysOf(ROLE.plain)).toEqual(['issue:create', 'issue:edit']);
  });

  it('hai PATCH đồng thời cùng một bản → đúng MỘT thắng, người kia 409', async () => {
    const seen = (await updatedAtOf(ROLE.plain)).toISOString();
    const results = await Promise.allSettled([
      svc.update(
        WS,
        ROLE.plain,
        { permissionKeys: ['issue:edit'], expectedUpdatedAt: seen },
        U.owner,
      ),
      svc.update(
        WS,
        ROLE.plain,
        { permissionKeys: ['issue:create'], expectedUpdatedAt: seen },
        U.owner,
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(await keysOf(ROLE.plain)).toHaveLength(1);
  });

  it('gỡ quyền quản trị khỏi vai trò mà người DUY NHẤT còn hoạt động giữ → 409 LAST_WORKSPACE_ADMIN, hoàn lại bộ quyền', async () => {
    emit.mockClear();
    await expect(
      svc.update(WS, ROLE.admin, { permissionKeys: ['member:manage'] }, U.owner),
    ).rejects.toMatchObject({ code: 'LAST_WORKSPACE_ADMIN' });
    expect(await keysOf(ROLE.admin)).toEqual(['member:manage', 'workspace:admin']);
    expect(emit).not.toHaveBeenCalled();
  });

  it('người giữ vai trò admin khác đã VÔ HIỆU HOÁ không tính → vẫn chặn', async () => {
    await prisma.user.update({ where: { id: U.b }, data: { status: 'DEACTIVATED' } });
    const m = await prisma.workspaceMembership.create({
      data: { workspaceId: WS, userId: U.b, roleId: ROLE.admin2 },
    });
    await prisma.workspaceMembershipRole.create({
      data: { membershipId: m.id, roleId: ROLE.admin2 },
    });
    await expect(
      svc.update(WS, ROLE.admin, { permissionKeys: ['member:manage'] }, U.owner),
    ).rejects.toMatchObject({ code: 'LAST_WORKSPACE_ADMIN' });
  });

  it('có quản trị viên khác đang hoạt động → cho gỡ', async () => {
    await prisma.user.update({ where: { id: U.b }, data: { status: 'ACTIVE' } });
    await svc.update(WS, ROLE.admin, { permissionKeys: ['member:manage'] }, U.owner);
    expect(await keysOf(ROLE.admin)).toEqual(['member:manage']);
    expect(emit).toHaveBeenCalled();
  });
});
