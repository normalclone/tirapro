import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

vi.mock('argon2', () => ({
  hash: vi.fn(() => Promise.resolve('HASH')),
  verify: vi.fn(() => Promise.resolve(true)),
}));

function make() {
  const tx = {
    user: { create: vi.fn(() => Promise.resolve({ id: 'u1', email: 'a@x.vn' })) },
    workspace: {
      findUnique: vi.fn(() => Promise.resolve(null)),
      create: vi.fn(() => Promise.resolve({ id: 'w1' })),
    },
    role: { findFirst: vi.fn(() => Promise.resolve({ id: 'r-admin' })) },
    workspaceMembership: { create: vi.fn(() => Promise.resolve({})) },
  };
  const prisma = {
    user: {
      findUnique: vi.fn(() => Promise.resolve(null)),
      findUniqueOrThrow: vi.fn(() =>
        Promise.resolve({
          id: 'u1',
          email: 'a@x.vn',
          displayName: 'A',
          avatarUrl: null,
          timezone: 'UTC',
          locale: 'vi',
          status: 'ACTIVE',
          isSystemAdmin: false,
          lastSeenAt: null,
          createdAt: new Date(),
        }),
      ),
    },
    $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
  };
  const tokens = {
    signAccess: vi.fn(() => ({ accessToken: 'AT', expiresIn: 900 })),
    issueRefresh: vi.fn(() => Promise.resolve('RT')),
  };
  const service = new AuthService(
    prisma as never,
    tokens as never,
    {} as never,
    { bootstrap: vi.fn(() => Promise.resolve()) },
    { flags: () => ({ signupEnabled: true }) } as never,
  );
  return { service, tx };
}

describe('AuthService.register — ghi bảng vai trò đa vai', () => {
  it('membership của chủ workspace có cả dòng nối WorkspaceMembershipRole', async () => {
    const { service, tx } = make();
    await service.register({ email: 'a@x.vn', password: 'Password1', displayName: 'A' }, {});
    const arg = tx.workspaceMembership.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(arg[0].data).toMatchObject({
      roleId: 'r-admin',
      roles: { create: [{ roleId: 'r-admin' }] },
    });
  });
});
