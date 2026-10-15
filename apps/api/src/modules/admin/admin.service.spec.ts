import { describe, expect, it, vi } from 'vitest';
import { AdminService } from './admin.service';

function setup(status = 'ACTIVE') {
  const updated = {
    id: 'u1',
    email: 'a@x.vn',
    displayName: 'An',
    avatarUrl: null,
    status: 'DEACTIVATED',
    isSystemAdmin: false,
    canCreateWorkspace: false,
    lastSeenAt: null,
    createdAt: new Date(),
    _count: { workspaceMemberships: 1 },
  };
  const prisma = {
    user: {
      findUnique: vi.fn((args: { where: { id?: string; email?: string } }) =>
        args.where.email
          ? Promise.resolve(null)
          : Promise.resolve({
              id: 'u1',
              status,
              displayName: 'An',
              email: 'a@x.vn',
              isSystemAdmin: false,
              canCreateWorkspace: false,
            }),
      ),
      update: vi.fn(() => Promise.resolve(updated)),
      create: vi.fn(() => Promise.resolve({ ...updated, isSystemAdmin: true })),
    },
  };
  const audit = { record: vi.fn() };
  return { service: new AdminService(prisma as never, audit as never), audit };
}

describe('AdminService.update — nhật ký khoá/mở khoá', () => {
  it('đổi ACTIVE → DEACTIVATED ghi account.deactivated', async () => {
    const { service, audit } = setup('ACTIVE');
    await service.update('u1', { status: 'DEACTIVATED' }, 'admin');
    expect(audit.record.mock.calls[0]![0]).toMatchObject({
      actorId: 'admin',
      action: 'account.deactivated',
      entityId: 'u1',
      summary: 'Khoá tài khoản An (a@x.vn)',
    });
  });

  it('đổi DEACTIVATED → ACTIVE ghi account.reactivated', async () => {
    const { service, audit } = setup('DEACTIVATED');
    await service.update('u1', { status: 'ACTIVE' }, 'admin');
    expect(audit.record.mock.calls[0]![0]).toMatchObject({ action: 'account.reactivated' });
  });

  it('không đổi trạng thái thì không ghi', async () => {
    const { service, audit } = setup('ACTIVE');
    await service.update('u1', { displayName: 'An B' }, 'admin');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('đổi isSystemAdmin / canCreateWorkspace ghi account.permissions_changed', async () => {
    const { service, audit } = setup('ACTIVE');
    await service.update('u1', { isSystemAdmin: true, canCreateWorkspace: true }, 'admin');
    const entry = audit.record.mock.calls[0]![0] as { action: string; summary: string };
    expect(entry.action).toBe('account.permissions_changed');
    expect(entry.summary).toContain('cấp quyền admin hệ thống');
    expect(entry.summary).toContain('cho phép lập không gian làm việc');
  });

  it('create(): ghi account.created, không đưa mật khẩu vào nhật ký', async () => {
    const { service, audit } = setup('ACTIVE');
    const out = await service.create(
      { email: 'a@x.vn', displayName: 'An', isSystemAdmin: true },
      'admin',
    );
    const entry = audit.record.mock.calls[0]![0] as { action: string; summary: string };
    expect(entry.action).toBe('account.created');
    expect(entry.summary).toContain('admin hệ thống');
    expect(JSON.stringify(entry)).not.toContain(out.tempPassword!);
  });
});
