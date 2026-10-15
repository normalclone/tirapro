import { describe, expect, it, vi } from 'vitest';
import { AUDIT_ACTIONS } from '@tirapro/types';
import { AuditService } from './audit.service';

function make() {
  const prisma = {
    auditLog: {
      create: vi.fn(() => Promise.resolve({})),
      findMany: vi.fn(() => Promise.resolve([] as unknown[])),
    },
    user: { findMany: vi.fn(() => Promise.resolve([])) },
  };
  return { svc: new AuditService(prisma as never), prisma };
}

describe('AuditService', () => {
  it('record(): ghi đủ trường', async () => {
    const { svc, prisma } = make();
    await svc.record({
      workspaceId: 'w1',
      actorId: 'u1',
      action: AUDIT_ACTIONS.ROLE_CREATED,
      entityType: 'role',
      entityId: 'r1',
      summary: 'Tạo vai trò "QA"',
      meta: { name: 'QA' },
    });
    const arg = prisma.auditLog.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(arg[0].data).toMatchObject({
      workspaceId: 'w1',
      actorId: 'u1',
      action: 'role.created',
      entityType: 'role',
      entityId: 'r1',
      summary: 'Tạo vai trò "QA"',
      meta: { name: 'QA' },
    });
  });

  it('record(): lỗi DB không ném ra (không làm hỏng thao tác quản trị đã xong)', async () => {
    const { svc, prisma } = make();
    prisma.auditLog.create.mockRejectedValueOnce(new Error('db down'));
    await expect(
      svc.record({ action: AUDIT_ACTIONS.ROLE_CREATED, entityType: 'role', summary: 'x' }),
    ).resolves.toBeUndefined();
  });

  it('record(): có tx thì ghi qua tx và để lỗi lan ra', async () => {
    const { svc, prisma } = make();
    const tx = {
      auditLog: {
        create: vi.fn(() => Promise.reject(new Error('boom'))),
      },
    };
    await expect(
      svc.record(
        { action: AUDIT_ACTIONS.MEMBER_ADDED, entityType: 'user', summary: 'x' },
        tx as never,
      ),
    ).rejects.toThrow('boom');
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('list(): luôn lọc theo workspace + bộ lọc, mới nhất trước, lấy dư 1 dòng để biết còn trang sau', async () => {
    const { svc, prisma } = make();
    await svc.list('w1', {
      action: 'role.created',
      actorId: 'u1',
      from: new Date('2026-10-01'),
      to: new Date('2026-10-31'),
      limit: 20,
    });
    const arg = prisma.auditLog.findMany.mock.calls[0] as unknown as [
      { where: unknown; orderBy: unknown; take: number },
    ];
    expect(arg[0].where).toEqual({
      workspaceId: 'w1',
      action: 'role.created',
      actorId: 'u1',
      createdAt: { gte: new Date('2026-10-01'), lte: new Date('2026-10-31') },
    });
    expect(arg[0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(arg[0].take).toBe(21);
  });

  it('list(): không có bộ lọc thì chỉ lọc theo workspace; phân giải tên người thực hiện theo lô', async () => {
    const { svc, prisma } = make();
    prisma.auditLog.findMany.mockResolvedValueOnce([
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
      },
    ]);
    prisma.user.findMany.mockResolvedValueOnce([
      { id: 'u1', displayName: 'An', avatarUrl: null },
    ] as never);
    const page = await svc.list('w1', { limit: 20 });
    expect(
      (prisma.auditLog.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where,
    ).toEqual({ workspaceId: 'w1' });
    expect(page.data[0]).toMatchObject({
      id: 'a1',
      createdAt: '2026-10-02T00:00:00.000Z',
      actor: { id: 'u1', displayName: 'An', avatarUrl: null },
    });
    expect(page.pageInfo).toMatchObject({ hasNextPage: false, endCursor: 'a1' });
  });
});
