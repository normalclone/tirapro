import { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';
import { TokenService } from './token.service';

function setup(updateManyCounts: number[], row: Record<string, unknown> | null) {
  const updateMany = vi.fn();
  for (const count of updateManyCounts) updateMany.mockResolvedValueOnce({ count });
  const prisma = {
    refreshToken: {
      updateMany,
      findUnique: vi.fn(async () => row),
      findUniqueOrThrow: vi.fn(async () => row),
      create: vi.fn(async () => ({})),
    },
  };
  const config = { get: (k: string) => (k === 'jwt.accessSecret' ? 'secret' : k === 'jwt.refreshExpiresIn' ? '7d' : undefined) };
  const jwt = new JwtService({});
  return { service: new TokenService(jwt, config as never, prisma as never), prisma, jwt };
}

describe('TokenService.rotateRefresh — atomic', () => {
  const live = { id: 'r1', userId: 'u1', family: 'fam1', tokenHash: 'h' };

  it('giành được token (count=1) => cấp token mới cùng family', async () => {
    const { service, prisma } = setup([1], live);
    const res = await service.rotateRefresh('fam1.rawtoken', {});
    expect(res.userId).toBe('u1');
    expect(res.newToken.startsWith('fam1.')).toBe(true);
    const claim = prisma.refreshToken.updateMany.mock.calls[0]![0];
    expect(claim.where).toMatchObject({ revokedAt: null, expiresAt: { gt: expect.any(Date) } });
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  it('count=0 và token tồn tại (reuse/hết hạn) => revoke cả family rồi ném 401, không cấp token mới', async () => {
    const { service, prisma } = setup([0, 2], { ...live, revokedAt: new Date() });
    await expect(service.rotateRefresh('fam1.rawtoken', {})).rejects.toMatchObject({ status: 401 });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.refreshToken.updateMany.mock.calls[1]![0]).toMatchObject({ where: { family: 'fam1', revokedAt: null } });
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('count=0 và token không tồn tại => 401, không revoke family nào', async () => {
    const { service, prisma } = setup([0], null);
    await expect(service.rotateRefresh('fam1.nope', {})).rejects.toMatchObject({ status: 401 });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
  });

  it('hai request đồng thời cùng một token: chỉ một bên thắng', async () => {
    const { service, prisma } = setup([1, 0, 1], { ...live, revokedAt: new Date() });
    const [a, b] = await Promise.allSettled([service.rotateRefresh('fam1.t', {}), service.rotateRefresh('fam1.t', {})]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });
});

describe('TokenService.workspaceFromExpiredAccess', () => {
  it('đọc workspaceId từ access token đã hết hạn (chữ ký đúng)', () => {
    const { service, jwt } = setup([], null);
    const expired = jwt.sign({ sub: 'u1', workspaceId: 'w2' }, { secret: 'secret', expiresIn: -10 });
    expect(service.workspaceFromExpiredAccess(`Bearer ${expired}`)).toBe('w2');
  });
  it('sai chữ ký / thiếu header => null', () => {
    const { service, jwt } = setup([], null);
    const forged = jwt.sign({ sub: 'u1', workspaceId: 'w2' }, { secret: 'khac' });
    expect(service.workspaceFromExpiredAccess(`Bearer ${forged}`)).toBeNull();
    expect(service.workspaceFromExpiredAccess(undefined)).toBeNull();
    expect(service.workspaceFromExpiredAccess('Bearer rác')).toBeNull();
  });
});
