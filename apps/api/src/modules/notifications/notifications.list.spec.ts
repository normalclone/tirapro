import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service';

const visible = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };

function setup(opts: { isSystemAdmin?: boolean; workspaces?: string[]; visible?: unknown } = {}) {
  const prisma = {
    notification: {
      findMany: vi.fn((_a?: unknown) => Promise.resolve([] as unknown[])),
      count: vi.fn((_a?: unknown) => Promise.resolve(0)),
    },
    user: {
      findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: !!opts.isSystemAdmin })),
      findMany: vi.fn((_a?: unknown) =>
        Promise.resolve([] as { id: string; displayName: string }[]),
      ),
    },
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

describe('NotificationsService.listMine — điền tên người thực hiện khi đọc', () => {
  const row = (id: string, actorId: string | null, payload: Record<string, unknown>) => ({
    id,
    type: 'STATUS_CHANGED',
    issueId: 'i1',
    commentId: null,
    actorId,
    payload,
    readAt: null,
    createdAt: new Date('2026-10-15T00:00:00Z'),
  });

  it('dòng có actorId mà payload thiếu actorName được điền tên; MỘT truy vấn user cho cả trang', async () => {
    const { service, prisma } = setup();
    prisma.notification.findMany.mockImplementation(() =>
      Promise.resolve([
        row('n1', 'a1', { key: 'D-1' }),
        row('n2', 'a1', { key: 'D-2' }),
        row('n3', 'a2', { key: 'D-3', actorName: 'Đã có tên' }),
        row('n4', 'a3', { key: 'D-4' }),
        row('n5', null, { key: 'D-5' }),
      ]),
    );
    prisma.user.findMany.mockImplementation(() =>
      Promise.resolve([
        { id: 'a1', displayName: 'Dũng' },
        { id: 'a3', displayName: 'Trang' },
      ]),
    );
    const page = await service.listMine('u1', undefined, 30);
    const names = page.data.map((n) => (n.payload as { actorName?: string }).actorName);
    expect(names).toEqual(['Dũng', 'Dũng', 'Đã có tên', 'Trang', undefined]);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    const arg = prisma.user.findMany.mock.calls[0]![0] as { where: { id: { in: string[] } } };
    expect([...arg.where.id.in].sort()).toEqual(['a1', 'a3']);
  });

  it('người đã xoá (không tra được): giữ nguyên payload, không bịa tên', async () => {
    const { service, prisma } = setup();
    prisma.notification.findMany.mockImplementation(() =>
      Promise.resolve([row('n1', 'gone', { key: 'D-1' })]),
    );
    const page = await service.listMine('u1', undefined, 30);
    expect(page.data[0]!.payload).toEqual({ key: 'D-1' });
  });

  it('không dòng nào cần tra tên: không truy vấn user', async () => {
    const { service, prisma } = setup();
    prisma.notification.findMany.mockImplementation(() =>
      Promise.resolve([row('n1', 'a1', { actorName: 'X' }), row('n2', null, {})]),
    );
    await service.listMine('u1', undefined, 30);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('chỉ điền khi đọc: không ghi DB', async () => {
    const { service, prisma } = setup();
    prisma.notification.findMany.mockImplementation(() =>
      Promise.resolve([row('n1', 'a1', { key: 'D-1' })]),
    );
    prisma.user.findMany.mockImplementation(() =>
      Promise.resolve([{ id: 'a1', displayName: 'Dũng' }]),
    );
    await service.listMine('u1', undefined, 30);
    expect((prisma.notification as Record<string, unknown>).update).toBeUndefined();
  });
});
