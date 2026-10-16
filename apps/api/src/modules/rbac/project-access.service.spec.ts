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
  opts: { sysAdmin?: boolean; perms?: string[]; priv?: { memberCount: number } | null } = {},
) {
  const prisma = {
    user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: !!opts.sysAdmin })) },
    project: {
      findFirst: vi.fn((_a?: unknown) =>
        Promise.resolve(
          opts.priv
            ? { memberships: Array.from({ length: opts.priv.memberCount }, () => ({ id: 'pm' })) }
            : null,
        ),
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
});
