import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service';

const visible = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };

function setup(opts: { isSystemAdmin?: boolean; workspaces?: string[]; visible?: unknown } = {}) {
  const prisma = {
    notification: {
      findMany: vi.fn((_a?: unknown) => Promise.resolve([])),
      count: vi.fn((_a?: unknown) => Promise.resolve(0)),
    },
    user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: !!opts.isSystemAdmin })) },
    workspaceMembership: {
      findMany: vi.fn(() =>
        Promise.resolve((opts.workspaces ?? ['w1']).map((workspaceId) => ({ workspaceId }))),
      ),
    },
  };
  const access = { visibleWhere: vi.fn(() => Promise.resolve(opts.visible ?? {})) };
  const service = new NotificationsService(
    prisma as never,
    { emit: vi.fn() } as never,
    { enqueue: vi.fn() } as never,
    { get: vi.fn() } as never,
    access as never,
  );
  return { service, prisma, access };
}

const whereOf = (m: { mock: { calls: unknown[][] } }) =>
  (m.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;

describe('NotificationsService.listMine — lọc phía API', () => {
  it.each([
    ['all', { recipientId: 'u1' }],
    ['unread', { recipientId: 'u1', readAt: null }],
    ['mentioned', { recipientId: 'u1', type: 'MENTIONED' }],
    ['assigned', { recipientId: 'u1', type: 'ISSUE_ASSIGNED' }],
  ] as const)('filter=%s lọc đúng và luôn theo recipientId', async (filter, where) => {
    const { service, prisma } = setup();
    await service.listMine('u1', undefined, 30, filter);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining(where) as unknown }),
    );
  });

  it('thiếu filter = như cũ (tất cả); cursor vẫn dùng được cùng bộ lọc', async () => {
    const { service, prisma } = setup();
    await service.listMine('u1', 'n9', 30);
    const arg = prisma.notification.findMany.mock.calls[0]![0] as {
      where: { recipientId: string };
      cursor: unknown;
      skip: number;
    };
    expect(arg.where.recipientId).toBe('u1');
    expect(arg.cursor).toEqual({ id: 'n9' });
    expect(arg.skip).toBe(1);
  });
});

describe('NotificationsService — dự án riêng tư: thông báo cũ của dự án không còn thấy biến mất (P16)', () => {
  it('listMine: OR [không gắn việc, việc của dự án còn thấy được theo từng workspace]', async () => {
    const { service, prisma, access } = setup({ visible });
    await service.listMine('u1', undefined, 30);
    expect(access.visibleWhere).toHaveBeenCalledWith('u1', 'w1');
    expect(whereOf(prisma.notification.findMany)).toEqual({
      recipientId: 'u1',
      OR: [{ issueId: null }, { workspaceId: 'w1', issue: { project: visible } }],
    });
  });

  it('unreadCount cùng điều kiện (chuông không đếm thông báo của dự án đã mất quyền)', async () => {
    const { service, prisma } = setup({ visible });
    await service.unreadCount('u1');
    expect(whereOf(prisma.notification.count)).toEqual({
      recipientId: 'u1',
      readAt: null,
      OR: [{ issueId: null }, { workspaceId: 'w1', issue: { project: visible } }],
    });
  });

  it('người thấy hết dự án (admin workspace): vẫn chỉ trong workspace còn là thành viên; mỗi workspace một điều kiện', async () => {
    const { service, prisma } = setup({ workspaces: ['w1', 'w2'], visible: {} });
    await service.listMine('u1', undefined, 30);
    expect(whereOf(prisma.notification.findMany)).toEqual({
      recipientId: 'u1',
      OR: [{ issueId: null }, { workspaceId: 'w1' }, { workspaceId: 'w2' }],
    });
  });

  it('admin hệ thống: không lọc', async () => {
    const { service, prisma } = setup({ isSystemAdmin: true, visible });
    await service.listMine('u1', undefined, 30);
    expect(whereOf(prisma.notification.findMany)).toEqual({ recipientId: 'u1' });
  });
});
