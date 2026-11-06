import { describe, expect, it, vi } from 'vitest';
import { RolesService } from './roles.service';

/** Danh mục /roles chỉ là MẪU dùng chung: vai trò riêng của từng dự án không hiện và không sửa/xoá được qua đây. */
describe('RolesService — mẫu vai trò (projectId null)', () => {
  it('list(): chỉ mẫu — lọc projectId null', async () => {
    const prisma = { role: { findMany: vi.fn(() => Promise.resolve([])) } };
    const svc = new RolesService(prisma as never, {} as never, { record: vi.fn() } as never);
    await svc.list('w1', 'PROJECT');
    expect(prisma.role.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: null,
          OR: [{ organizationId: null }, { organizationId: 'w1' }],
          scope: 'PROJECT',
        },
      }),
    );
  });

  it('sửa/xoá vai trò RIÊNG của dự án qua API mẫu → 404 như không tồn tại', async () => {
    const prisma = {
      role: {
        findUnique: vi.fn(() =>
          Promise.resolve({
            id: 'r1',
            name: 'Tester',
            isSystem: false,
            organizationId: 'w1',
            projectId: 'p1',
            _count: { wsMembershipRoles: 0, projMembershipRoles: 0 },
          }),
        ),
        delete: vi.fn(),
      },
    };
    const rbac = { holdsOrganizationAdmin: vi.fn(() => Promise.resolve(true)) };
    const svc = new RolesService(prisma as never, rbac as never, { record: vi.fn() } as never);
    await expect(svc.remove('w1', 'r1', 'u1')).rejects.toMatchObject({ status: 404 });
    await expect(svc.update('w1', 'r1', { name: 'X' }, 'u1')).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.role.delete).not.toHaveBeenCalled();
  });
});
