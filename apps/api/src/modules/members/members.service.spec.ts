import { describe, expect, it, vi } from 'vitest';
import { MembersService } from './members.service';

describe('MembersService.addWorkspaceMany', () => {
  function setup() {
    const tx = {
      workspaceMembership: {
        createMany: vi.fn(() => Promise.resolve({ count: 2 })),
        findMany: vi.fn((args: { where: { userId?: unknown; roles?: unknown } }) =>
          Promise.resolve(args.where.roles ? [{ id: 'm1' }, { id: 'm2' }] : [{ userId: 'u3' }])), // u3 đã là thành viên
      },
      workspaceMembershipRole: { createMany: vi.fn((_args: { data: unknown[] }) => Promise.resolve({ count: 4 })) },
    };
    const prisma = {
      $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
      role: { findMany: vi.fn(() => Promise.resolve([{ id: 'r1' }, { id: 'r2' }])) },
      user: { findMany: vi.fn(() => Promise.resolve([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }])) },
      workspaceMembership: tx.workspaceMembership,
    };
    const rbac = { invalidate: vi.fn(), invalidateWorkspace: vi.fn() };
    return { service: new MembersService(prisma as never, rbac as never), prisma, tx, rbac };
  }

  it('thêm cả lô trong một transaction và invalidate RBAC một lần cho workspace', async () => {
    const { service, prisma, tx, rbac } = setup();
    const res = await service.addWorkspaceMany('w1', ['u1', 'u2', 'u3'], ['r1', 'r2']);
    expect(res).toEqual({ added: 2, skipped: 1 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.workspaceMembership.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true, data: [expect.objectContaining({ userId: 'u1', roleId: 'r1' }), expect.objectContaining({ userId: 'u2', roleId: 'r1' })] }),
    );
    const roleRows = tx.workspaceMembershipRole.createMany.mock.calls[0]![0].data;
    expect(roleRows).toHaveLength(4); // 2 membership x 2 vai trò
    expect(rbac.invalidateWorkspace).toHaveBeenCalledTimes(1);
    expect(rbac.invalidate).not.toHaveBeenCalled();
  });

  it('không có ai cần thêm => không mở transaction, không invalidate', async () => {
    const { service, prisma, rbac } = setup();
    prisma.user.findMany.mockResolvedValue([{ id: 'u3' }]);
    const res = await service.addWorkspaceMany('w1', ['u3'], ['r1', 'r2']);
    expect(res).toEqual({ added: 0, skipped: 1 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(rbac.invalidateWorkspace).not.toHaveBeenCalled();
  });
});
