import { createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { describe, expect, it, vi } from 'vitest';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import { PasswordResetService } from './password-reset.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function setup() {
  const tx = {
    passwordResetToken: {
      create: vi.fn((_a: unknown) => Promise.resolve({})),
      updateMany: vi.fn((_a: unknown) => Promise.resolve({ count: 1 })),
    },
    user: { update: vi.fn((_a: unknown) => Promise.resolve({})) },
    refreshToken: { updateMany: vi.fn((_a: unknown) => Promise.resolve({ count: 2 })) },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    user: { ...tx.user, findUnique: vi.fn((_a: unknown) => Promise.resolve(null as unknown)) },
    passwordResetToken: {
      ...tx.passwordResetToken,
      findUnique: vi.fn((_a: unknown) => Promise.resolve(null as unknown)),
      findFirst: vi.fn((_a: unknown) => Promise.resolve(null as unknown)),
    },
  };
  const mail = { enqueue: vi.fn((_a: unknown, _t?: unknown) => Promise.resolve()) };
  const config = { get: vi.fn((k: string) => (k === 'mail.appWebUrl' ? 'http://localhost:5173' : undefined)) };
  return { service: new PasswordResetService(prisma as never, mail as never, config as never), prisma, tx, mail };
}

describe('PasswordResetService.requestReset', () => {
  it('email không tồn tại → resolve, không tạo token, không enqueue', async () => {
    const { service, mail, tx } = setup();
    await expect(service.requestReset('nobody@x.vn')).resolves.toBeUndefined();
    expect(mail.enqueue).not.toHaveBeenCalled();
    expect(tx.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('người dùng hệ thống automation → bỏ qua, không tra DB, không tạo token, không gửi thư', async () => {
    const { service, prisma, mail, tx } = setup();
    await expect(service.requestReset('Automation@tirapro.local')).resolves.toBeUndefined();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(tx.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mail.enqueue).not.toHaveBeenCalled();
  });

  it('email tồn tại → lưu sha256 của token (không lưu token thô) và enqueue link chứa token thô', async () => {
    const { service, prisma, mail, tx } = setup();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@x.vn', displayName: 'A', status: 'ACTIVE' });
    await service.requestReset('A@x.vn');

    const stored = (tx.passwordResetToken.create.mock.calls[0]![0] as { data: { tokenHash: string; userId: string; expiresAt: Date } }).data;
    expect(stored.userId).toBe('u1');
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const ttl = stored.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(59 * 60_000);
    expect(ttl).toBeLessThanOrEqual(60 * 60_000);

    const mailArg = mail.enqueue.mock.calls[0]![0] as { to: string; template: string; payload: { resetUrl: string } };
    expect(mailArg.to).toBe('a@x.vn');
    expect(mailArg.template).toBe('password-reset');
    const token = new URL(mailArg.payload.resetUrl).searchParams.get('token')!;
    expect(token.length).toBeGreaterThanOrEqual(43); // 32 byte base64url
    expect(sha256(token)).toBe(stored.tokenHash);
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(mail.enqueue.mock.calls[0]![1]).toBe(tx); // cùng transaction với việc tạo token
  });

  it('vừa yêu cầu cách đây < 60 giây → bỏ qua lặng lẽ (chống bom hộp thư)', async () => {
    const { service, prisma, mail } = setup();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@x.vn', displayName: 'A', status: 'ACTIVE' });
    prisma.passwordResetToken.findFirst.mockResolvedValue({ id: 't0' });
    await expect(service.requestReset('a@x.vn')).resolves.toBeUndefined();
    expect(mail.enqueue).not.toHaveBeenCalled();
  });
});

describe('PasswordResetService.resetPassword', () => {
  it('token không tồn tại → BusinessRuleException', async () => {
    const { service } = setup();
    await expect(service.resetPassword({ token: 'nope', newPassword: 'Abcdef12' })).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('token hết hạn → thông báo yêu cầu liên kết mới', async () => {
    const { service, prisma } = setup();
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 't1', userId: 'u1', usedAt: null, expiresAt: new Date(Date.now() - 1000),
    });
    const err = await service.resetPassword({ token: 'tok', newPassword: 'Abcdef12' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BusinessRuleException);
    expect((err as BusinessRuleException).message).toBe('Liên kết đặt lại mật khẩu đã hết hạn — hãy yêu cầu liên kết mới');
  });

  it('token đã dùng → từ chối', async () => {
    const { service, prisma } = setup();
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 't1', userId: 'u1', usedAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.resetPassword({ token: 'tok', newPassword: 'Abcdef12' })).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('hai request cùng lúc: người thua (updateMany count=0) bị từ chối, không đổi mật khẩu', async () => {
    const { service, prisma, tx } = setup();
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 't1', userId: 'u1', usedAt: null, expiresAt: new Date(Date.now() + 60_000),
    });
    tx.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.resetPassword({ token: 'tok', newPassword: 'Abcdef12' })).rejects.toBeInstanceOf(BusinessRuleException);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('thành công → hash argon2, đánh dấu usedAt, thu hồi mọi refresh token của user', async () => {
    const { service, prisma, tx } = setup();
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 't1', userId: 'u1', usedAt: null, expiresAt: new Date(Date.now() + 60_000),
    });
    await service.resetPassword({ token: 'tok', newPassword: 'Abcdef12' });

    expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash: sha256('tok') } });
    const claim = tx.passwordResetToken.updateMany.mock.calls[0]![0] as { where: { id: string; usedAt: null }; data: { usedAt: Date } };
    expect(claim.where).toMatchObject({ id: 't1', usedAt: null });
    expect(claim.data.usedAt).toBeInstanceOf(Date);

    const upd = tx.user.update.mock.calls[0]![0] as { where: { id: string }; data: { passwordHash: string } };
    expect(upd.where).toEqual({ id: 'u1' });
    expect(await argon2.verify(upd.data.passwordHash, 'Abcdef12')).toBe(true);

    const revoke = tx.refreshToken.updateMany.mock.calls[0]![0] as { where: { userId: string; revokedAt: null }; data: { revokedAt: Date } };
    expect(revoke.where).toMatchObject({ userId: 'u1', revokedAt: null });
    expect(revoke.data.revokedAt).toBeInstanceOf(Date);
  });
});
