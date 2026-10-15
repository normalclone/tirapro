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
      findUnique: vi.fn(() =>
        Promise.resolve({ id: 'u1', status, displayName: 'An', email: 'a@x.vn' }),
      ),
      update: vi.fn(() => Promise.resolve(updated)),
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
});
