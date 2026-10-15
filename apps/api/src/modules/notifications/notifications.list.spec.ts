import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service';

function setup() {
  const prisma = { notification: { findMany: vi.fn((_a?: unknown) => Promise.resolve([])) } };
  const service = new NotificationsService(
    prisma as never,
    { emit: vi.fn() } as never,
    { enqueue: vi.fn() } as never,
    { get: vi.fn() } as never,
  );
  return { service, prisma };
}

describe('NotificationsService.listMine — lọc phía API', () => {
  it.each([
    ['all', { recipientId: 'u1' }],
    ['unread', { recipientId: 'u1', readAt: null }],
    ['mentioned', { recipientId: 'u1', type: 'MENTIONED' }],
    ['assigned', { recipientId: 'u1', type: 'ISSUE_ASSIGNED' }],
  ] as const)('filter=%s lọc đúng và luôn theo recipientId', async (filter, where) => {
    const { service, prisma } = setup();
    await service.listMine('u1', undefined, 30, filter);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
  });

  it('thiếu filter = như cũ (tất cả); cursor vẫn dùng được cùng bộ lọc', async () => {
    const { service, prisma } = setup();
    await service.listMine('u1', 'n9', 30);
    const arg = prisma.notification.findMany.mock.calls[0]![0] as {
      where: unknown;
      cursor: unknown;
      skip: number;
    };
    expect(arg.where).toEqual({ recipientId: 'u1' });
    expect(arg.cursor).toEqual({ id: 'n9' });
    expect(arg.skip).toBe(1);
  });
});
