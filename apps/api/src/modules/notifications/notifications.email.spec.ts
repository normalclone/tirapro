import { describe, expect, it, vi } from 'vitest';
import type { NotificationType } from '@prisma/client';
import { effectiveEmailPrefs, NotificationsService } from './notifications.service';

describe('effectiveEmailPrefs', () => {
  it('settings rỗng / null / sai kiểu → mặc định', () => {
    const def = { mention: true, assigned: true, comment: false, transition: false };
    expect(effectiveEmailPrefs(null)).toEqual(def);
    expect(effectiveEmailPrefs({})).toEqual(def);
    expect(effectiveEmailPrefs({ notifications: 'rác' })).toEqual(def);
    expect(effectiveEmailPrefs({ notifications: { email: [1, 2] } })).toEqual(def);
  });

  it('khoá hợp lệ ghi đè mặc định, khoá sai kiểu bị bỏ qua', () => {
    expect(
      effectiveEmailPrefs({
        notifications: { email: { comment: true, mention: 'yes', transition: true } },
      }),
    ).toEqual({
      mention: true,
      assigned: true,
      comment: true,
      transition: true,
    });
  });
});

function setup(settings: unknown) {
  const prisma = {
    user: {
      findUnique: vi.fn((args: { where: { id: string } }) =>
        Promise.resolve(
          args.where.id === 'r1'
            ? { settings, email: 'r@x.vn', status: 'ACTIVE' }
            : { displayName: 'Minh' },
        ),
      ),
    },
    notification: {
      create: vi.fn(() =>
        Promise.resolve({
          id: 'n1',
          type: 'COMMENT_ADDED',
          issueId: null,
          commentId: null,
          actorId: 'a1',
          payload: {},
          readAt: null,
          createdAt: new Date(),
        }),
      ),
    },
  };
  const events = { emit: vi.fn() };
  const mail = { enqueue: vi.fn((_a: unknown) => Promise.resolve()) };
  const config = { get: vi.fn(() => 'http://localhost:5173') };
  const service = new NotificationsService(
    prisma as never,
    events as never,
    mail as never,
    config as never,
    { canSee: vi.fn(() => Promise.resolve(true)) } as never,
  );
  const create = (type: string) =>
    service.publish({
      recipientId: 'r1',
      workspaceId: 'w1',
      type: type as NotificationType,
      actorId: 'a1',
      payload: { key: 'TP-1', summary: 'Sửa lỗi', statusName: 'Done' },
    });
  return { create, prisma, mail, events };
}

describe('NotificationsService.create — email theo tuỳ chọn', () => {
  it('loại đang bật email → tạo notification in-app và enqueue một thư notification', async () => {
    const { create, mail, prisma } = setup({ notifications: { email: { comment: true } } });
    await create('COMMENT_ADDED');
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(mail.enqueue).toHaveBeenCalledTimes(1);
    const arg = mail.enqueue.mock.calls[0]![0] as {
      to: string;
      template: string;
      payload: { title: string; url: string };
    };
    expect(arg).toMatchObject({ to: 'r@x.vn', template: 'notification' });
    expect(arg.payload.title).toContain('Minh');
    expect(arg.payload.url).toBe('http://localhost:5173/issue/TP-1');
  });

  it('mặc định bình luận / đổi trạng thái tắt email → không enqueue, vẫn có in-app', async () => {
    const { create, mail, prisma } = setup({});
    await create('COMMENT_ADDED');
    await create('STATUS_CHANGED');
    expect(prisma.notification.create).toHaveBeenCalledTimes(2);
    expect(mail.enqueue).not.toHaveBeenCalled();
  });

  it('enqueue lỗi → nuốt lỗi, thông báo in-app vẫn được tạo', async () => {
    const { create, mail, prisma } = setup({ notifications: { email: { comment: true } } });
    mail.enqueue.mockRejectedValue(new Error('db chết'));
    await expect(create('COMMENT_ADDED')).resolves.toBeUndefined();
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });
});
