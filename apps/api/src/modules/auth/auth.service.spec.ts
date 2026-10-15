import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

/** `expect.any(Date)` có kiểu `any` → ép kiểu một lần để không dính no-unsafe-assignment. */
const anyDate = expect.any(Date) as unknown as Date;

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

function makeSession(userOverrides: Record<string, unknown> = {}) {
  const user = {
    id: 'u1',
    email: 'a@x.vn',
    displayName: 'A',
    avatarUrl: null,
    timezone: 'UTC',
    locale: 'vi',
    status: 'ACTIVE',
    isSystemAdmin: false,
    lastSeenAt: new Date(),
    createdAt: new Date(),
    ...userOverrides,
  };
  const tx = {
    user: { update: vi.fn(() => Promise.resolve({})) },
    refreshToken: { updateMany: vi.fn(() => Promise.resolve({ count: 2 })) },
  };
  const prisma = {
    user: {
      findUniqueOrThrow: vi.fn(() => Promise.resolve(user)),
      update: vi.fn(() => Promise.resolve({})),
    },
    refreshToken: { updateMany: vi.fn(() => Promise.resolve({ count: 1 })) },
    workspaceMembership: {
      findUnique: vi.fn(() => Promise.resolve(null)),
      findFirst: vi.fn(() => Promise.resolve({ workspaceId: 'w1' })),
    },
    $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
  };
  const tokens = {
    rotateRefresh: vi.fn(() => Promise.resolve({ userId: 'u1', newToken: 'NEW' })),
    signAccess: vi.fn(() => ({ accessToken: 'AT', expiresIn: 900 })),
  };
  const service = new AuthService(
    prisma as never,
    tokens as never,
    {} as never,
    {} as never,
    { flags: () => ({ signupEnabled: true }) } as never,
  );
  return { service, prisma, tx, tokens };
}

describe('AuthService.refresh — tài khoản bị khoá và hoạt động gần nhất', () => {
  it('tài khoản DEACTIVATED -> Unauthorized, thu hồi refresh token, không cấp access token', async () => {
    const { service, prisma, tokens } = makeSession({ status: 'DEACTIVATED' });
    await expect(service.refresh('fam.raw', {}, null)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: anyDate },
    });
    expect(tokens.signAccess).not.toHaveBeenCalled();
  });

  it('lastSeenAt cũ hơn 10 phút -> cập nhật lastSeenAt', async () => {
    const { service, prisma } = makeSession({ lastSeenAt: new Date(Date.now() - 11 * 60_000) });
    await service.refresh('fam.raw', {}, null);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { lastSeenAt: anyDate },
    });
  });

  it('chưa từng có lastSeenAt -> cập nhật', async () => {
    const { service, prisma } = makeSession({ lastSeenAt: null });
    await service.refresh('fam.raw', {}, null);
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('lastSeenAt mới (dưới 10 phút) -> không ghi DB', async () => {
    const { service, prisma } = makeSession({ lastSeenAt: new Date(Date.now() - 60_000) });
    await service.refresh('fam.raw', {}, null);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('AuthService.logoutAll', () => {
  it('thu hồi mọi refresh token và đặt mốc sessionsRevokedAt', async () => {
    const { service, tx } = makeSession();
    await expect(service.logoutAll('u1')).resolves.toEqual({ success: true });
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: anyDate },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { sessionsRevokedAt: anyDate },
    });
  });
});
