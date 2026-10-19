import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from '../../notifications/notifications.service';
import { runNotify } from './notify';
import type { ActionContext } from './types';

/**
 * Automation `notify` phải đi qua chốt thông báo trung tâm: người KHÔNG xem được dự án (riêng tư) của việc
 * không được tạo thông báo / đẩy realtime (payload mang khoá + tiêu đề việc); thành viên dự án vẫn nhận.
 * Dùng NotificationsService THẬT (chỉ giả prisma/access) để bắt đúng lỗi "ghi thẳng prisma.notification.create".
 */
const SYS = 'SYS';
const MEMBER = 'member';
const OUTSIDER = 'outsider';

function setup(opts: {
  wsRoleMembers?: string[];
  projectRoleMembers?: string[];
  settings?: unknown;
}) {
  const created: { recipientId: string; payload: unknown }[] = [];
  const prisma = {
    user: {
      findUnique: vi.fn(() =>
        Promise.resolve({
          settings: opts.settings ?? null,
          email: 'r@x.vn',
          status: 'ACTIVE',
          displayName: 'Tirapro Automation',
        }),
      ),
    },
    notification: {
      findFirst: vi.fn(() => Promise.resolve(null)),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
      create: vi.fn((a: { data: { recipientId: string; payload: unknown } }) => {
        created.push({ recipientId: a.data.recipientId, payload: a.data.payload });
        return Promise.resolve({
          id: `n-${created.length}`,
          ...a.data,
          type: 'ISSUE_UPDATED',
          issueId: 'i1',
          commentId: null,
          actorId: SYS,
          readAt: null,
          createdAt: new Date(),
        });
      }),
    },
    workspaceMembership: {
      findMany: vi.fn((a: { where: { userId?: { in: string[] }; role?: unknown } }) =>
        Promise.resolve(
          a.where.role
            ? (opts.wsRoleMembers ?? []).map((userId) => ({ userId }))
            : (a.where.userId?.in ?? []).map((userId) => ({ userId })),
        ),
      ),
    },
    projectMembership: {
      findMany: vi.fn(() =>
        Promise.resolve((opts.projectRoleMembers ?? []).map((userId) => ({ userId }))),
      ),
    },
  };
  const events = { emit: vi.fn() };
  const mail = { enqueue: vi.fn(() => Promise.resolve()) };
  const config = { get: vi.fn(() => 'http://localhost:5173') };
  // Dự án p-private: chỉ MEMBER (và hệ thống) xem được.
  const access = {
    canSee: vi.fn((userId: string, _w: string, _p: string) => Promise.resolve(userId === MEMBER)),
  };
  const notifications = new NotificationsService(
    prisma as never,
    events as never,
    mail as never,
    config as never,
    access as never,
  );
  const ctx = {
    deps: { prisma, notifications, events },
    workspaceId: 'w1',
    actorId: SYS,
    rule: { id: 'r1', name: 'Báo khi P1' },
    trigger: 'ISSUE_CREATED',
    triggerActorId: null,
    dryRun: false,
    meta: {},
    issue: {
      id: 'i1',
      key: 'HRX-1',
      summary: 'Việc nhạy cảm',
      projectId: 'p-private',
      workspaceId: 'w1',
    },
    reload: vi.fn(),
    actorName: () => Promise.resolve('Tirapro Automation'),
  } as unknown as ActionContext;
  const pushed = () =>
    events.emit.mock.calls
      .filter((c) => (c as unknown[])[0] === 'notification.created')
      .map((c) => (c as unknown as [string, { recipientId: string }])[1].recipientId);
  return { ctx, created, events, pushed, access, prisma };
}

const msg = 'Có việc mới';

describe('automation notify — dự án riêng tư', () => {
  it('userIds gồm người ngoài dự án riêng tư → KHÔNG tạo thông báo, KHÔNG đẩy realtime cho họ', async () => {
    const { ctx, created, pushed } = setup({});
    const out = await runNotify(ctx, { type: 'notify', userIds: [MEMBER, OUTSIDER], message: msg });
    expect(created.map((c) => c.recipientId)).toEqual([MEMBER]);
    expect(pushed()).toEqual([MEMBER]);
    expect(out).toContain('1 người');
  });

  it('roles ở cấp workspace: người có vai đó nhưng không xem được dự án thì bị loại; thành viên dự án nhận', async () => {
    const { ctx, created, pushed } = setup({
      wsRoleMembers: [OUTSIDER],
      projectRoleMembers: [MEMBER],
    });
    await runNotify(ctx, { type: 'notify', roles: ['Developer'], message: msg });
    expect(created.map((c) => c.recipientId)).toEqual([MEMBER]);
    expect(pushed()).toEqual([MEMBER]);
    expect(JSON.stringify(created)).toContain('HRX-1'); // thành viên vẫn thấy khoá việc
  });

  it('chỉ có người ngoài → lỗi rõ ràng (không im lặng), không ghi gì', async () => {
    const { ctx, created, pushed } = setup({ wsRoleMembers: [OUTSIDER] });
    await expect(
      runNotify(ctx, { type: 'notify', roles: ['Developer'], message: msg }),
    ).rejects.toThrow(/xem được công việc/);
    expect(created).toEqual([]);
    expect(pushed()).toEqual([]);
  });

  it('chạy thử: đếm đúng người xem được và không ghi gì', async () => {
    const { ctx, created } = setup({});
    (ctx as { dryRun: boolean }).dryRun = true;
    const out = await runNotify(ctx, { type: 'notify', userIds: [MEMBER, OUTSIDER], message: msg });
    expect(out).toContain('1 người');
    expect(created).toEqual([]);
  });

  it('tôn trọng cài đặt: người đã TẮT tường minh ISSUE_UPDATED thì không nhận; mặc định tắt thì quy tắc vẫn gửi (force)', async () => {
    const off = setup({ settings: { notifications: { ISSUE_UPDATED: false } } });
    await runNotify(off.ctx, { type: 'notify', userIds: [MEMBER], message: msg });
    expect(off.created).toEqual([]);

    const def = setup({});
    await runNotify(def.ctx, { type: 'notify', userIds: [MEMBER], message: msg });
    expect(def.created).toHaveLength(1);
  });

  it('gộp 60 giây: đã có dòng cùng việc chưa đọc thì cập nhật dòng đó, không tạo dòng mới', async () => {
    const { ctx, prisma, created } = setup({});
    prisma.notification.findFirst.mockImplementation(((a: { where: { type?: string } }) =>
      Promise.resolve(
        a.where.type === 'ISSUE_UPDATED'
          ? {
              id: 'old',
              type: 'ISSUE_UPDATED',
              issueId: 'i1',
              commentId: null,
              actorId: SYS,
              recipientId: MEMBER,
              payload: { key: 'HRX-1', summary: 'cũ', count: 1 },
              readAt: null,
              createdAt: new Date(),
            }
          : null,
      )) as never);
    (prisma.notification as unknown as { update: unknown }).update = vi.fn(
      (a: { where: { id: string }; data: Record<string, unknown> }) =>
        Promise.resolve({
          id: a.where.id,
          type: 'ISSUE_UPDATED',
          issueId: 'i1',
          commentId: null,
          actorId: SYS,
          readAt: null,
          createdAt: new Date(),
          ...a.data,
        }),
    );
    await runNotify(ctx, { type: 'notify', userIds: [MEMBER], message: msg });
    expect(created).toEqual([]);
    expect(
      (prisma.notification as unknown as { update: { mock: { calls: unknown[] } } }).update.mock
        .calls,
    ).toHaveLength(1);
  });
});

describe('automation notify — sửa hàng loạt gộp thông báo (D-I2)', () => {
  it('5 việc cùng lô (cùng quy tắc + người nhận) => chỉ MỘT thông báo, kèm cỡ lô', async () => {
    const { ctx, created } = setup({});
    for (let i = 0; i < 5; i++) {
      const c = {
        ...ctx,
        batch: { id: 'batch-A', size: 5 },
        issue: { ...ctx.issue, id: `i${i}`, key: `HRX-${i}` },
      } as ActionContext;
      await runNotify(c, { type: 'notify', userIds: [MEMBER], message: msg });
    }
    expect(created).toHaveLength(1);
    expect(JSON.stringify(created[0]!.payload)).toContain('sửa hàng loạt 5 việc');
  });

  it('lô khác nhau (hoặc không có lô) không bị gộp với nhau', async () => {
    const { ctx, created } = setup({});
    await runNotify(
      { ...ctx, batch: { id: 'batch-B', size: 2 } },
      {
        type: 'notify',
        userIds: [MEMBER],
        message: msg,
      },
    );
    await runNotify(
      { ...ctx, batch: { id: 'batch-C', size: 2 } },
      {
        type: 'notify',
        userIds: [MEMBER],
        message: msg,
      },
    );
    expect(created).toHaveLength(2);
    const { ctx: c2, created: created2 } = setup({});
    await runNotify(c2, { type: 'notify', userIds: [MEMBER], message: msg });
    expect(created2).toHaveLength(1);
    expect(JSON.stringify(created2[0]!.payload)).not.toContain('hàng loạt');
  });
});
