import { describe, expect, it, vi } from 'vitest';
import { RolesService } from './roles.service';

describe('RolesService — đếm thành viên theo workspace', () => {
  it('list(): memberCount đếm theo workspace hiện tại, không đếm toàn hệ thống', async () => {
    const prisma = { role: { findMany: vi.fn(() => Promise.resolve([])) } };
    const svc = new RolesService(prisma as never, {} as never);
    await svc.list('w1');
    const select = (prisma.role.findMany.mock.calls[0] as unknown[])[0] as {
      select: { _count: { select: Record<string, unknown> } };
    };
    expect(select.select._count.select.wsMembershipRoles).toEqual({
      where: { membership: { workspaceId: 'w1' } },
    });
    expect(select.select._count.select.projMembershipRoles).toEqual({
      where: { membership: { project: { workspaceId: 'w1', deletedAt: null } } },
    });
  });

  it('remove(): kiểm tra số người đang giữ vai trò cũng lọc theo workspace', async () => {
    const prisma = {
      role: {
        findUnique: vi.fn(() =>
          Promise.resolve({
            id: 'r1',
            isSystem: false,
            workspaceId: 'w1',
            _count: { wsMembershipRoles: 0, projMembershipRoles: 0 },
          }),
        ),
        delete: vi.fn(() => Promise.resolve({})),
      },
    };
    const svc = new RolesService(prisma as never, { invalidateWorkspace: vi.fn() } as never);
    await svc.remove('w1', 'r1');
    const arg = (prisma.role.findUnique.mock.calls[0] as unknown[])[0] as {
      select: { _count: { select: Record<string, unknown> } };
    };
    expect(arg.select._count.select.wsMembershipRoles).toEqual({
      where: { membership: { workspaceId: 'w1' } },
    });
  });
});
