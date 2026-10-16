import { describe, expect, it, vi } from 'vitest';
import { ProjectAccessService } from './project-access.service';

function make(
  opts: { sysAdmin?: boolean; perms?: string[]; priv?: { memberCount: number } | null } = {},
) {
  const prisma = {
    user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: !!opts.sysAdmin })) },
    project: {
      findMany: vi.fn((_a?: unknown) => Promise.resolve([{ id: 'p-pub' }, { id: 'p-mine' }])),
    },
  };
  const rbac = {
    getEffectivePermissions: vi.fn(() => Promise.resolve(new Set(opts.perms ?? ['project:view']))),
    // Mô phỏng RbacService.assertProjectVisible theo cấu hình: dự án riêng tư không thành viên + không admin → 404.
    assertProjectVisible: vi.fn(async () => {
      if (opts.priv === undefined || opts.priv === null) return;
      if (opts.priv.memberCount > 0) return;
      if ((opts.perms ?? []).includes('workspace:admin')) return;
      const { NotFoundAppException } = await import('../../common/exceptions/app.exception');
      throw new NotFoundAppException('Dự án');
    }),
  };
  return { svc: new ProjectAccessService(prisma as never, rbac as never), prisma, rbac };
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

  it('visibleProjectIds: admin → null; người thường → id từ truy vấn có visibleWhere + deletedAt', async () => {
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
  });

  it('assertCanSee: dự án riêng tư không thành viên, không admin → 404', async () => {
    const { svc } = make({ priv: { memberCount: 0 } });
    await expect(svc.assertCanSee('u1', 'w1', 'p1')).rejects.toThrow(/Dự án/);
  });

  it('assertCanSee: công khai / thành viên / admin → qua', async () => {
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

  it('canSee: true/false theo assertCanSee; lỗi khác 404 vẫn ném', async () => {
    expect(await make({ priv: { memberCount: 0 } }).svc.canSee('u1', 'w1', 'p1')).toBe(false);
    expect(await make({ priv: null }).svc.canSee('u1', 'w1', 'p1')).toBe(true);
    const boom = make();
    boom.rbac.assertProjectVisible.mockRejectedValueOnce(new Error('db down'));
    await expect(boom.svc.canSee('u1', 'w1', 'p1')).rejects.toThrow('db down');
  });
});
