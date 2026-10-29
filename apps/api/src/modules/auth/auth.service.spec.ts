import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { SYSTEM_USER_EMAIL } from '../../common/system-user';

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
    { emit: vi.fn() } as never,
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
  const events = { emit: vi.fn() };
  const service = new AuthService(
    prisma as never,
    tokens as never,
    {} as never,
    {} as never,
    { flags: () => ({ signupEnabled: true }) } as never,
    events as never,
  );
  return { service, prisma, tx, tokens, events };
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

  it('user trả về cho web có canCreateWorkspace (màn "chưa thuộc không gian làm việc nào" cần)', async () => {
    const { service } = makeSession({ canCreateWorkspace: true });
    const out = await service.refresh('fam.raw', {}, null);
    expect(out.user.canCreateWorkspace).toBe(true);
  });

  it('lastSeenAt mới (dưới 10 phút) -> không ghi DB', async () => {
    const { service, prisma } = makeSession({ lastSeenAt: new Date(Date.now() - 60_000) });
    await service.refresh('fam.raw', {}, null);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('AuthService.reissueSession', () => {
  it('cấp access + refresh mới (family mới) cho thiết bị đang đổi mật khẩu', async () => {
    const { service, tokens } = makeSession();
    (tokens as unknown as { issueRefresh: unknown }).issueRefresh = vi.fn(() =>
      Promise.resolve('NEWRT'),
    );
    const out = await service.reissueSession('u1', 'w1', {});
    expect(out).toMatchObject({ accessToken: 'AT', refreshToken: 'NEWRT' });
    expect(tokens.signAccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), 'w1');
  });
});

describe('AuthService.logoutAll', () => {
  it('thu hồi mọi refresh token và đặt mốc sessionsRevokedAt', async () => {
    const { service, tx, events } = makeSession();
    await expect(service.logoutAll('u1')).resolves.toEqual({ success: true });
    expect(events.emit).toHaveBeenCalledWith('account.sessions_revoked', { userId: 'u1' });
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

describe('AuthService.listWorkspaces — memberCount (bộ chọn không gian làm việc)', () => {
  function makeList(rows: unknown[]) {
    const findMany = vi.fn((_args: unknown) => Promise.resolve(rows));
    const prisma = { workspaceMembership: { findMany } };
    const service = new AuthService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, findMany };
  }
  const row = (id: string, count: number | undefined) => ({
    workspace: {
      id,
      name: `WS ${id}`,
      slug: id,
      avatarUrl: null,
      ...(count === undefined ? {} : { _count: { memberships: count } }),
    },
    role: { name: 'Workspace Admin' },
  });

  it('trả memberCount từ _count.memberships của từng workspace', async () => {
    const { service } = makeList([row('a', 12), row('b', 1)]);
    const out = await service.listWorkspaces('u1');
    expect(out.map((w) => [w.id, w.memberCount])).toEqual([
      ['a', 12],
      ['b', 1],
    ]);
    expect(out[0]).toMatchObject({
      name: 'WS a',
      slug: 'a',
      avatarUrl: null,
      roleName: 'Workspace Admin',
    });
  });

  it('MỘT truy vấn duy nhất (không N+1): _count có điều kiện trong select của workspace', async () => {
    const { service, findMany } = makeList([row('a', 3), row('b', 4), row('c', 5)]);
    await service.listWorkspaces('u1');
    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0]![0] as {
      where: unknown;
      select: {
        workspace: { select: { _count: { select: { memberships: { where: unknown } } } } };
      };
    };
    expect(arg.where).toEqual({ userId: 'u1' }); // chỉ workspace mà người này là thành viên
    expect(arg.select.workspace.select._count.select.memberships.where).toEqual({
      user: { status: { not: 'DEACTIVATED' }, email: { not: SYSTEM_USER_EMAIL } },
    });
  });

  it('loại tài khoản bị vô hiệu hoá và user hệ thống khỏi số đếm (điều kiện nằm ở truy vấn)', async () => {
    const { service, findMany } = makeList([row('a', 2)]);
    await service.listWorkspaces('u1');
    const where = JSON.stringify((findMany.mock.calls[0]![0] as { select: unknown }).select);
    expect(where).toContain('"DEACTIVATED"');
    expect(where).toContain(SYSTEM_USER_EMAIL);
  });
});
