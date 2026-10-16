import { describe, expect, it, vi } from 'vitest';
import { AdminSystemService } from './admin-system.service';
import { AuditService } from '../audit/audit.service';

function setup() {
  const prisma = {
    auditLog: {
      findMany: vi.fn(() =>
        Promise.resolve([
          {
            id: 'a1',
            workspaceId: 'w1',
            actorId: 'u1',
            action: 'role.created',
            entityType: 'role',
            entityId: 'r1',
            summary: 'Tạo vai trò "QA"',
            meta: {},
            createdAt: new Date('2026-10-02T00:00:00Z'),
            workspace: { id: 'w1', name: 'WS' },
          },
        ]),
      ),
    },
    activityLog: { findMany: vi.fn(() => Promise.resolve([])) },
    user: {
      findMany: vi.fn(() => Promise.resolve([{ id: 'u1', displayName: 'An', avatarUrl: null }])),
    },
  };
  const svc = new AdminSystemService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    new AuditService(prisma as never),
  );
  return { svc, prisma };
}

describe('AdminSystemService.audit', () => {
  it('mặc định (kind=admin) đọc AuditLog, kèm workspace + người thực hiện', async () => {
    const { svc, prisma } = setup();
    const page = await svc.audit({ limit: 50, kind: 'admin', action: 'role.created' });
    expect(prisma.activityLog.findMany).not.toHaveBeenCalled();
    expect((prisma.auditLog.findMany.mock.calls[0] as unknown[])[0]).toMatchObject({
      where: { action: 'role.created' },
      take: 50,
    });
    expect(page.data[0]).toMatchObject({
      id: 'a1',
      summary: 'Tạo vai trò "QA"',
      workspace: { id: 'w1', name: 'WS' },
      actor: { id: 'u1', displayName: 'An' },
    });
  });

  it('kind=activity giữ hành vi cũ: đọc ActivityLog', async () => {
    const { svc, prisma } = setup();
    await svc.audit({ limit: 50, kind: 'activity' });
    expect(prisma.activityLog.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });
});
