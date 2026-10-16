import { describe, expect, it, vi } from 'vitest';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { ProjectAccessService } from './project-access.service';
import { RbacService } from './rbac.service';

/**
 * ProjectAccessService chạy trên RbacService THẬT với Prisma giả (không mock lại logic ẩn/hiện):
 * - `priv`: undefined/null = dự án công khai (không có dòng isPrivate:true); số = dự án riêng tư có chừng đó thành viên khớp người gọi.
 * - `perms`: quyền hợp nhất của người gọi ở cấp workspace (qua vai trò workspace → rolePermission).
 */
function make(
  opts: {
    sysAdmin?: boolean;
    perms?: string[];
    priv?: { memberCount: number } | null;
    /** Dự án công khai/riêng tư khi không dùng `priv`; `members` = người gọi là thành viên (số dòng khớp). */
    isPrivate?: boolean;
    members?: number;
  } = {},
) {
  const prisma = {
    user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: !!opts.sysAdmin })) },
    project: {
      findFirst: vi.fn((_a?: unknown) =>
        Promise.resolve({
          isPrivate: opts.priv ? true : (opts.isPrivate ?? false),
          memberships: Array.from({ length: opts.priv?.memberCount ?? opts.members ?? 0 }, () => ({
            id: 'pm',
          })),
        }),
      ),
      findMany: vi.fn((_a?: unknown) => Promise.resolve([{ id: 'p-pub' }, { id: 'p-mine' }])),
    },
    workspaceMembership: {
      findUnique: vi.fn(() =>
        Promise.resolve({ roleId: 'r', roles: [{ role: { id: 'r', name: 'Workspace Member' } }] }),
      ),
    },
    rolePermission: {
      findMany: vi.fn(() =>
        Promise.resolve((opts.perms ?? ['project:view']).map((key) => ({ permission: { key } }))),
      ),
    },
    role: { findMany: vi.fn(() => Promise.resolve([])) },
    projectMembership: { findUnique: vi.fn(() => Promise.resolve(null)) },
  };
  const redis = { getClient: () => null, isAvailable: () => false };
  const rbac = new RbacService(prisma as never, redis as never);
  return { svc: new ProjectAccessService(prisma as never, rbac), prisma, rbac };
}

describe('ProjectAccessService', () => {
  it('visibleWhere: người thường chỉ thấy dự án công khai hoặc dự án mình là thành viên', async () => {
    const { svc } = make();
    expect(await svc.visibleWhere('u1', 'w1')).toEqual({
      OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }],
    });
  });

  it('visibleWhere: admin hệ thống hoặc workspace:admin thấy tất cả → {}', async () => {
    expect(await make({ sysAdmin: true }).svc.visibleWhere('u1', 'w1')).toEqual({});
    expect(await make({ perms: ['workspace:admin'] }).svc.visibleWhere('u1', 'w1')).toEqual({});
  });

  it('visibleProjectIds: admin → null; người thường → id từ truy vấn có visibleWhere + deletedAt, chỉ hỏi quyền MỘT lần', async () => {
    const admin = make({ sysAdmin: true });
    expect(await admin.svc.visibleProjectIds('u1', 'w1')).toBeNull();
    const { svc, prisma } = make();
    expect(await svc.visibleProjectIds('u1', 'w1')).toEqual(['p-pub', 'p-mine']);
    const where = (prisma.project.findMany.mock.calls[0]![0] as { where: object }).where;
    expect(where).toMatchObject({
      workspaceId: 'w1',
      deletedAt: null,
      OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }],
    });
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('assertCanSee: dự án riêng tư, không thành viên, không admin → 404 "Dự án"', async () => {
    const { svc } = make({ priv: { memberCount: 0 } });
    await expect(svc.assertCanSee('u1', 'w1', 'p1')).rejects.toBeInstanceOf(NotFoundAppException);
    await expect(svc.assertCanSee('u1', 'w1', 'p1')).rejects.toThrow('Dự án không tồn tại');
  });

  it('assertCanSee: truyền nhãn → thông điệp 404 dùng đúng nhãn đó', async () => {
    const { svc } = make({ priv: { memberCount: 0 } });
    await expect(svc.assertCanSee('u1', 'w1', 'p1', 'Tài nguyên')).rejects.toThrow(
      'Tài nguyên không tồn tại',
    );
  });

  it('assertCanSee: công khai / thành viên / workspace:admin → qua', async () => {
    await expect(make({ priv: null }).svc.assertCanSee('u1', 'w1', 'p1')).resolves.toBeUndefined();
    await expect(
      make({ priv: { memberCount: 1 } }).svc.assertCanSee('u1', 'w1', 'p1'),
    ).resolves.toBeUndefined();
    await expect(
      make({ priv: { memberCount: 0 }, perms: ['workspace:admin'] }).svc.assertCanSee(
        'u1',
        'w1',
        'p1',
      ),
    ).resolves.toBeUndefined();
  });

  it('canSee: true/false theo dữ liệu; lỗi khác 404 vẫn ném', async () => {
    expect(await make({ priv: { memberCount: 0 } }).svc.canSee('u1', 'w1', 'p1')).toBe(false);
    expect(await make({ priv: null }).svc.canSee('u1', 'w1', 'p1')).toBe(true);
    const boom = make();
    boom.prisma.project.findFirst.mockRejectedValueOnce(new Error('db down'));
    await expect(boom.svc.canSee('u1', 'w1', 'p1')).rejects.toThrow('db down');
  });

  it('visibleWhere/visibleProjectIds: vai trò cấp workspace không có project:view → chỉ dự án mình có vai trò (kể cả dự án công khai)', async () => {
    const { svc, prisma } = make({ perms: ['workspace:view'] });
    expect(await svc.visibleWhere('u1', 'w1')).toEqual({ memberships: { some: { userId: 'u1' } } });
    await svc.visibleProjectIds('u1', 'w1');
    expect(
      (prisma.project.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where,
    ).toMatchObject({
      workspaceId: 'w1',
      deletedAt: null,
      memberships: { some: { userId: 'u1' } },
    });
  });

  it('canSee: dự án không tồn tại/đã xoá → false với người thường (như visibleWhere loại dự án đã xoá), admin → true', async () => {
    const nobody = make({ perms: ['project:view'] });
    nobody.prisma.project.findFirst.mockResolvedValue(null as never);
    expect(await nobody.svc.canSee('u1', 'w1', 'p-gone')).toBe(false);
    const admin = make({ perms: ['workspace:admin'] });
    admin.prisma.project.findFirst.mockResolvedValue(null as never);
    expect(await admin.svc.canSee('u1', 'w1', 'p-gone')).toBe(true);
  });

  describe('bảng chân trị: MỘT định nghĩa "thấy" cho canSee/assertCanSee và visibleWhere/visibleProjectIds', () => {
    /** Đánh giá điều kiện Prisma mà `visibleWhere` trả ra trên một dự án giả (đủ cho 3 dạng điều kiện của dịch vụ). */
    const matches = (
      where: Record<string, unknown>,
      proj: { isPrivate: boolean; member: boolean },
    ): boolean => {
      if (Object.keys(where).length === 0) return true;
      if ('OR' in where)
        return (where.OR as Record<string, unknown>[]).some((w) => matches(w, proj));
      if ('isPrivate' in where) return where.isPrivate === proj.isPrivate;
      if ('memberships' in where) return proj.member;
      throw new Error('điều kiện lạ');
    };
    const actors: { name: string; opts: Parameters<typeof make>[0]; see: (p: P) => boolean }[] = [
      { name: 'admin hệ thống', opts: { sysAdmin: true, perms: [] }, see: () => true },
      { name: 'workspace:admin', opts: { perms: ['workspace:admin'] }, see: () => true },
      {
        name: 'project:view cấp workspace',
        opts: { perms: ['project:view'] },
        see: (p) => !p.isPrivate || p.member,
      },
      {
        name: 'không project:view, có vai dự án',
        opts: { perms: ['workspace:view', 'report:view'] },
        see: (p) => p.member,
      },
    ];
    type P = { isPrivate: boolean; member: boolean };
    const projects: P[] = [
      { isPrivate: false, member: false },
      { isPrivate: false, member: true },
      { isPrivate: true, member: false },
      { isPrivate: true, member: true },
    ];

    for (const a of actors) {
      for (const p of projects) {
        const label = `${a.name} × ${p.isPrivate ? 'riêng tư' : 'công khai'} × ${p.member ? 'là thành viên' : 'không thành viên'}`;
        it(`${label} → ${a.see(p) ? 'thấy' : 'không thấy'} (canSee và visibleWhere/visibleProjectIds khớp nhau)`, async () => {
          const { svc } = make({ ...a.opts, isPrivate: p.isPrivate, members: p.member ? 1 : 0 });
          expect(await svc.canSee('u1', 'w1', 'p1')).toBe(a.see(p));
          const where = await svc.visibleWhere('u1', 'w1');
          expect(matches(where as Record<string, unknown>, p)).toBe(a.see(p));
          // visibleProjectIds: null = thấy tất cả; ngược lại phụ thuộc cùng điều kiện (truy vấn thật ở DB).
          const ids = await make({ ...a.opts }).svc.visibleProjectIds('u1', 'w1');
          expect(ids === null).toBe(Object.keys(where).length === 0);
        });
      }
    }
  });
});
