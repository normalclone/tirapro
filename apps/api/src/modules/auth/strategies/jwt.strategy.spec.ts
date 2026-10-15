import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { JwtStrategy } from './jwt.strategy';

function setup(opts: { user?: Record<string, unknown> | null; membership?: unknown }) {
  const prisma = {
    user: {
      findUnique: vi.fn(() =>
        Promise.resolve(
          opts.user === undefined
            ? { id: 'U1', email: 'a@b.c', displayName: 'A', isSystemAdmin: false, status: 'ACTIVE' }
            : opts.user,
        ),
      ),
    },
    workspaceMembership: {
      findUnique: vi.fn(() =>
        Promise.resolve(opts.membership === undefined ? { id: 'M1' } : opts.membership),
      ),
    },
  };
  const config = { get: vi.fn(() => 'secret-test') };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strategy = new JwtStrategy(config as any, prisma as any);
  return { strategy, prisma };
}

const payload = { sub: 'U1', email: 'a@b.c', workspaceId: 'W1', jti: 'j' };

describe('JwtStrategy.validate', () => {
  it('payload có workspaceId nhưng membership đã mất -> Unauthorized (tiếng Việt)', async () => {
    const { strategy, prisma } = setup({ membership: null });
    const p = strategy.validate(payload);
    await expect(p).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(p).rejects.toThrow(/đăng nhập lại/);
    expect(prisma.workspaceMembership.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId_userId: { workspaceId: 'W1', userId: 'U1' } },
      }),
    );
  });

  it('còn membership -> trả AuthUser', async () => {
    const { strategy } = setup({});
    await expect(strategy.validate(payload)).resolves.toMatchObject({
      id: 'U1',
      workspaceId: 'W1',
    });
  });

  it('system admin được miễn kiểm membership', async () => {
    const { strategy, prisma } = setup({
      membership: null,
      user: { id: 'U1', email: 'a@b.c', displayName: 'A', isSystemAdmin: true, status: 'ACTIVE' },
    });
    await expect(strategy.validate(payload)).resolves.toMatchObject({
      isSystemAdmin: true,
      workspaceId: 'W1',
    });
    expect(prisma.workspaceMembership.findUnique).not.toHaveBeenCalled();
  });

  it('payload không có workspaceId -> không kiểm membership', async () => {
    const { strategy, prisma } = setup({ membership: null });
    await expect(strategy.validate({ ...payload, workspaceId: null })).resolves.toMatchObject({
      workspaceId: null,
    });
    expect(prisma.workspaceMembership.findUnique).not.toHaveBeenCalled();
  });

  it('tài khoản bị vô hiệu hoá -> Unauthorized', async () => {
    const { strategy } = setup({
      user: { id: 'U1', email: 'x', displayName: 'A', isSystemAdmin: false, status: 'DEACTIVATED' },
    });
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('access token cấp TRƯỚC mốc sessionsRevokedAt -> Unauthorized ngay', async () => {
    const { strategy } = setup({
      user: {
        id: 'U1',
        email: 'a@b.c',
        displayName: 'A',
        isSystemAdmin: false,
        status: 'ACTIVE',
        sessionsRevokedAt: new Date(2_000_000),
      },
    });
    const p = strategy.validate({ ...payload, iat: 1000 });
    await expect(p).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(p).rejects.toThrow(/thu hồi/);
  });

  it('access token cấp SAU mốc thu hồi (đăng nhập lại) -> hợp lệ', async () => {
    const { strategy } = setup({
      user: {
        id: 'U1',
        email: 'a@b.c',
        displayName: 'A',
        isSystemAdmin: false,
        status: 'ACTIVE',
        sessionsRevokedAt: new Date(2_000_000),
      },
    });
    await expect(strategy.validate({ ...payload, iat: 2001 })).resolves.toMatchObject({
      id: 'U1',
    });
  });

  it('token cấp trong cùng giây với mốc thu hồi vẫn hợp lệ (so theo giây)', async () => {
    const { strategy } = setup({
      user: {
        id: 'U1',
        email: 'a@b.c',
        displayName: 'A',
        isSystemAdmin: false,
        status: 'ACTIVE',
        sessionsRevokedAt: new Date(2_000_500),
      },
    });
    await expect(strategy.validate({ ...payload, iat: 2000 })).resolves.toMatchObject({
      id: 'U1',
    });
  });

  it('token có iatMs: cấp ngay TRƯỚC mốc thu hồi (cùng giây) -> Unauthorized; ngay SAU -> hợp lệ', async () => {
    const revoked = new Date(2_000_500);
    const user = {
      id: 'U1',
      email: 'a@b.c',
      displayName: 'A',
      isSystemAdmin: false,
      status: 'ACTIVE',
      sessionsRevokedAt: revoked,
    };
    const before = setup({ user }).strategy.validate({ ...payload, iat: 2000, iatMs: 2_000_400 });
    await expect(before).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      setup({ user }).strategy.validate({ ...payload, iat: 2000, iatMs: 2_000_600 }),
    ).resolves.toMatchObject({ id: 'U1' });
  });
});
