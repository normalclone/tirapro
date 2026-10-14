import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import { InviteService } from './invite.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function setup(driver: 'console' | 'smtp' = 'console') {
  const tx = {
    inviteToken: {
      updateMany: vi.fn((_a: unknown) => Promise.resolve({ count: 1 })),
      create: vi.fn((_a: unknown) => Promise.resolve({ id: 'inv1' })),
    },
    role: { findFirst: vi.fn((_a: unknown) => Promise.resolve({ id: 'r1' })) },
    user: {
      findUnique: vi.fn((_a: unknown) => Promise.resolve(null as unknown)),
      create: vi.fn((_a: unknown) => Promise.resolve({ id: 'u-new' })),
    },
    workspaceMembership: {
      findUnique: vi.fn((_a: unknown) => Promise.resolve(null as unknown)),
      create: vi.fn((_a: unknown) => Promise.resolve({})),
    },
  };
  const prisma = {
    $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    role: { findFirst: vi.fn((_a: unknown) => Promise.resolve({ id: 'r1' })) },
    workspace: { findFirst: vi.fn((_a: unknown) => Promise.resolve({ name: 'Công ty A' })) },
    user: { findUnique: vi.fn((_a: unknown) => Promise.resolve(null as unknown)) },
    workspaceMembership: { findUnique: vi.fn((_a: unknown) => Promise.resolve(null as unknown)) },
    inviteToken: { findUnique: vi.fn((_a: unknown) => Promise.resolve(null as unknown)) },
  };
  const mail = { enqueue: vi.fn((_a: unknown, _t?: unknown) => Promise.resolve()) };
  const config = {
    get: vi.fn((k: string) => (k === 'mail.appWebUrl' ? 'http://localhost:5173' : k === 'mail.driver' ? driver : undefined)),
  };
  const rbac = { invalidate: vi.fn(() => Promise.resolve()) };
  return { service: new InviteService(prisma as never, mail as never, config as never, rbac as never), prisma, tx, mail, rbac };
}

describe('InviteService.createInvite', () => {
  it('lưu sha256, enqueue thư mời, trả acceptUrl khi driver=console', async () => {
    const { service, tx, mail } = setup('console');
    const res = await service.createInvite('w1', 'admin1', { email: 'New@X.vn', roleId: 'r1' });

    const stored = (tx.inviteToken.create.mock.calls[0]![0] as { data: { tokenHash: string; email: string; expiresAt: Date } }).data;
    expect(stored.email).toBe('new@x.vn');
    const ttl = stored.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(6.99 * 86400_000);
    expect(ttl).toBeLessThanOrEqual(7 * 86400_000);

    expect(res.inviteId).toBe('inv1');
    const token = new URL(res.acceptUrl!).searchParams.get('token')!;
    expect(res.acceptUrl).toContain('http://localhost:5173/invite/accept?token=');
    expect(sha256(token)).toBe(stored.tokenHash);
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(mail.enqueue.mock.calls[0]![1]).toBe(tx);
  });

  it('driver=smtp → KHÔNG trả acceptUrl (liên kết chỉ nằm trong hộp thư người được mời)', async () => {
    const { service } = setup('smtp');
    const res = await service.createInvite('w1', 'admin1', { email: 'a@x.vn' });
    expect(res).toEqual({ inviteId: 'inv1' });
  });

  it('email đã là thành viên → BusinessRuleException', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    prisma.workspaceMembership.findUnique.mockResolvedValue({ id: 'm1' });
    await expect(service.createInvite('w1', 'admin1', { email: 'a@x.vn' })).rejects.toBeInstanceOf(BusinessRuleException);
  });
});

describe('InviteService.acceptInvite', () => {
  const valid = () => ({ id: 'inv1', workspaceId: 'w1', email: 'new@x.vn', roleId: 'r1', acceptedAt: null, expiresAt: new Date(Date.now() + 60_000) });

  it('token lạ → từ chối', async () => {
    const { service } = setup();
    await expect(service.acceptInvite({ token: 'x'.repeat(30), displayName: 'A', password: 'Abcdef12' })).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('hết hạn → thông báo hết hạn', async () => {
    const { service, prisma } = setup();
    prisma.inviteToken.findUnique.mockResolvedValue({ ...valid(), expiresAt: new Date(Date.now() - 1) });
    const err = await service.acceptInvite({ token: 't'.repeat(30), displayName: 'A', password: 'Abcdef12' }).catch((e: unknown) => e);
    expect((err as BusinessRuleException).message).toContain('hết hạn');
  });

  it('user mới → tạo user + membership, đánh dấu acceptedAt', async () => {
    const { service, prisma, tx, rbac } = setup();
    prisma.inviteToken.findUnique.mockResolvedValue(valid());
    const res = await service.acceptInvite({ token: 't'.repeat(30), displayName: 'An', password: 'Abcdef12' });
    expect(res).toEqual({ userId: 'u-new', workspaceId: 'w1', existingUser: false });
    expect(prisma.inviteToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash: sha256('t'.repeat(30)) } });
    const claim = tx.inviteToken.updateMany.mock.calls[0]![0] as { where: { id: string; acceptedAt: null } };
    expect(claim.where).toMatchObject({ id: 'inv1', acceptedAt: null });
    expect(tx.user.create).toHaveBeenCalledTimes(1);
    expect(tx.workspaceMembership.create).toHaveBeenCalledTimes(1);
    expect(rbac.invalidate).toHaveBeenCalledWith('u-new', 'w1');
  });

  it('email đã có tài khoản → gắn vào user cũ, không tạo user, không đổi mật khẩu', async () => {
    const { service, prisma, tx } = setup();
    prisma.inviteToken.findUnique.mockResolvedValue(valid());
    tx.user.findUnique.mockResolvedValue({ id: 'u-old', status: 'ACTIVE' });
    const res = await service.acceptInvite({ token: 't'.repeat(30), displayName: 'An', password: 'Abcdef12' });
    expect(res).toEqual({ userId: 'u-old', workspaceId: 'w1', existingUser: true });
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('hai request cùng lúc: người thua (count=0) bị từ chối, không tạo user', async () => {
    const { service, prisma, tx } = setup();
    prisma.inviteToken.findUnique.mockResolvedValue(valid());
    tx.inviteToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.acceptInvite({ token: 't'.repeat(30), displayName: 'An', password: 'Abcdef12' })).rejects.toBeInstanceOf(BusinessRuleException);
    expect(tx.user.create).not.toHaveBeenCalled();
  });
});
