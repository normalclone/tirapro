import { describe, expect, it, vi } from 'vitest';
import { ApiKeyService } from './api-key.service';
import { hashApiKeySecret } from './api-key-hash';

const PREFIX = 'abcdef0123';
const SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef';
const RAW = `tira_${PREFIX}_${SECRET}`;

function setup(membership: unknown = { id: 'M1' }, status = 'ACTIVE') {
  const keyRow = {
    id: 'K1',
    hash: hashApiKeySecret(SECRET),
    scopes: ['read'],
    workspaceId: 'W1',
    userId: 'U1',
    revokedAt: null,
    expiresAt: null,
    user: { email: 'a@b.c', displayName: 'An', status },
  };
  const prisma = {
    apiKey: {
      findUnique: vi.fn(() => Promise.resolve(keyRow)),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      update: vi.fn(() => Promise.resolve({})),
      findMany: vi.fn(() => Promise.resolve([{ prefix: 'p1' }, { prefix: 'p2' }])),
    },
    workspaceMembership: { findUnique: vi.fn(() => Promise.resolve(membership)) },
  };
  const client = {
    get: vi.fn(() => Promise.resolve(null)),
    set: vi.fn(() => Promise.resolve('OK')),
    del: vi.fn(() => Promise.resolve(1)),
  };
  const redis = { isAvailable: () => true, getClient: () => client };
  return { service: new ApiKeyService(prisma as never, redis as never), prisma, client };
}

describe('ApiKeyService.validate — membership', () => {
  it('chấp nhận key của thành viên còn trong workspace', async () => {
    const { service, prisma } = setup();
    const ctx = await service.validate(RAW);
    expect(ctx).toMatchObject({ userId: 'U1', workspaceId: 'W1' });
    expect(prisma.workspaceMembership.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: 'W1', userId: 'U1' } },
      select: { id: true },
    });
  });

  it('từ chối key (chưa bị thu hồi) của member đã bị gỡ khỏi workspace và không ghi cache', async () => {
    const { service, client } = setup(null);
    await expect(service.validate(RAW)).resolves.toBeNull();
    expect(client.set).not.toHaveBeenCalled();
  });

  it('từ chối key của user DEACTIVATED', async () => {
    const { service } = setup({ id: 'M1' }, 'DEACTIVATED');
    await expect(service.validate(RAW)).resolves.toBeNull();
  });
});

describe('ApiKeyService.revokeAllForUser / dropCaches', () => {
  it('thu hồi mọi key còn hiệu lực của user trong workspace bằng client giao dịch, trả prefix', async () => {
    const { service, prisma } = setup();
    const tx = {
      apiKey: {
        findMany: vi.fn(() => Promise.resolve([{ prefix: 'p1' }, { prefix: 'p2' }])),
        updateMany: vi.fn(() => Promise.resolve({ count: 2 })),
      },
    };
    const prefixes = await service.revokeAllForUser('W1', 'U1', tx as never);
    expect(prefixes).toEqual(['p1', 'p2']);
    expect(tx.apiKey.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: 'W1', userId: 'U1', revokedAt: null },
      data: { revokedAt: expect.any(Date) as unknown },
    });
    expect(prisma.apiKey.updateMany).not.toHaveBeenCalled();
  });

  it('không có key -> không ghi gì', async () => {
    const { service } = setup();
    const tx = { apiKey: { findMany: vi.fn(() => Promise.resolve([])), updateMany: vi.fn() } };
    await expect(service.revokeAllForUser('W1', 'U1', tx as never)).resolves.toEqual([]);
    expect(tx.apiKey.updateMany).not.toHaveBeenCalled();
  });

  it('dropCaches xoá cache theo từng prefix', async () => {
    const { service, client } = setup();
    await service.dropCaches(['p1', 'p2']);
    expect(client.del).toHaveBeenCalledWith('apikey:ctx:p1');
    expect(client.del).toHaveBeenCalledWith('apikey:ctx:p2');
  });
});

describe('ApiKeyService.dropCachesForUser — khoá tài khoản chặn key ngay', () => {
  it('xoá cache của MỌI key còn hiệu lực của user (mọi workspace), không thu hồi key', async () => {
    const { service, prisma, client } = setup();
    await service.dropCachesForUser('U1');
    expect(prisma.apiKey.findMany).toHaveBeenCalledWith({
      where: { userId: 'U1', revokedAt: null },
      select: { prefix: true },
    });
    expect(client.del).toHaveBeenCalledWith('apikey:ctx:p1');
    expect(client.del).toHaveBeenCalledWith('apikey:ctx:p2');
    expect(prisma.apiKey.updateMany).not.toHaveBeenCalled();
  });

  it('key đã có cache hợp lệ: sau khi cache bị xoá, lượt dùng kế tiếp đọc lại DB và bị từ chối vì user DEACTIVATED', async () => {
    const { service, client } = setup({ id: 'M1' }, 'DEACTIVATED');
    // Trước khi khoá: cache trúng.
    client.get.mockResolvedValueOnce(
      JSON.stringify({
        h: hashApiKeySecret(SECRET),
        exp: null,
        ctx: { keyId: 'K1', userId: 'U1', workspaceId: 'W1', scopes: ['write'] },
      }) as never,
    );
    await expect(service.validate(RAW)).resolves.toMatchObject({ userId: 'U1' });
    // setStatus(DEACTIVATED) → dropCachesForUser → cache rỗng → đọc DB.
    await service.dropCachesForUser('U1');
    client.get.mockResolvedValue(null);
    await expect(service.validate(RAW)).resolves.toBeNull();
  });
});
