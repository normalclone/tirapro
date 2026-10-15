import { describe, expect, it, vi } from 'vitest';
import { WorkspacesService } from './workspaces.service';

describe('WorkspacesService.create — ghi bảng vai trò đa vai', () => {
  it('membership của người tạo có joinedAt và dòng nối WorkspaceMembershipRole', async () => {
    const tx = {
      workspace: {
        findUnique: vi.fn(() => Promise.resolve(null)),
        findFirst: vi.fn(() => Promise.resolve(null)),
        create: vi.fn(() => Promise.resolve({ id: 'w1', name: 'Công ty A', slug: 'cong-ty-a' })),
      },
      role: { findFirst: vi.fn(() => Promise.resolve({ id: 'r-admin' })) },
      workspaceMembership: { create: vi.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      user: {
        findUnique: vi.fn(() =>
          Promise.resolve({ isSystemAdmin: true, canCreateWorkspace: false }),
        ),
      },
      $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    };
    const svc = new WorkspacesService(
      prisma as never,
      { bootstrap: vi.fn(() => Promise.resolve()) },
      {} as never,
    );
    await svc.create('u1', { name: 'Công ty A' });
    const arg = tx.workspaceMembership.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(arg[0].data).toMatchObject({
      workspaceId: 'w1',
      userId: 'u1',
      roleId: 'r-admin',
      roles: { create: [{ roleId: 'r-admin' }] },
    });
    expect(arg[0].data.joinedAt).toBeInstanceOf(Date);
  });
});
