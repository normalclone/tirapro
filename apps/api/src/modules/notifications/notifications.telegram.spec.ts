import { describe, expect, it, vi } from 'vitest';
import type { NotificationType } from '@prisma/client';
import {
  effectiveTelegramPrefs,
  NotificationsService,
  TELEGRAM_SEND_TIMEOUT_MS,
} from './notifications.service';

describe('effectiveTelegramPrefs', () => {
  it('mặc định: chỉ được giao việc + được nhắc tên bật', () => {
    const on = Object.entries(effectiveTelegramPrefs(null))
      .filter(([, v]) => v)
      .map(([k]) => k)
      .sort();
    expect(on).toEqual(['ISSUE_ASSIGNED', 'MENTIONED']);
    expect(effectiveTelegramPrefs({})).toEqual(effectiveTelegramPrefs(null));
    expect(effectiveTelegramPrefs({ notifications: 'rác' })).toEqual(effectiveTelegramPrefs(null));
    expect(effectiveTelegramPrefs({ notifications: { telegram: [1] } })).toEqual(
      effectiveTelegramPrefs(null),
    );
  });

  it('khoá hợp lệ ghi đè mặc định; khoá lạ / sai kiểu bị bỏ qua', () => {
    const p = effectiveTelegramPrefs({
      notifications: {
        telegram: { MENTIONED: false, COMMENT_ADDED: true, STATUS_CHANGED: 'yes', X: true },
      },
    });
    expect(p.MENTIONED).toBe(false);
    expect(p.COMMENT_ADDED).toBe(true);
    expect(p.STATUS_CHANGED).toBe(false);
    expect(p.ISSUE_ASSIGNED).toBe(true);
    expect('X' in p).toBe(false);
  });
});

function setup(settings: unknown, opts: { status?: string } = {}) {
  const prisma = {
    user: {
      findUnique: vi.fn((args: { where: { id: string } }) =>
        Promise.resolve(
          args.where.id === 'r1'
            ? { settings, email: 'r@x.vn', status: opts.status ?? 'ACTIVE' }
            : { displayName: 'Nguyễn Thị Thuỳ Linh' },
        ),
      ),
      update: vi.fn(() => Promise.resolve({})),
    },
    notification: {
      create: vi.fn(() =>
        Promise.resolve({
          id: 'n1',
          type: 'ISSUE_ASSIGNED',
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
  const config = { get: vi.fn(() => 'https://tira.example') };
  const notifier = { send: vi.fn((_u: string, _o: string, _h: string) => Promise.resolve(true)) };
  const service = new NotificationsService(
    prisma as never,
    events as never,
    mail as never,
    config as never,
    { canSee: vi.fn(() => Promise.resolve(true)) } as never,
    notifier as never,
  );
  const publish = (type: string, over: Record<string, unknown> = {}) =>
    service.publish({
      recipientId: 'r1',
      organizationId: 'w1',
      type: type as NotificationType,
      actorId: 'a1',
      payload: {
        key: 'TIRA-BUG-28',
        summary: 'Lỗi <đăng nhập> & "xoay"',
        excerpt: 'xem <b>này</b>',
      },
      ...over,
    });
  return { service, publish, prisma, notifier, mail };
}

describe('NotificationsService — gửi Telegram cá nhân', () => {
  it('được giao việc (mặc định bật): gửi tin cho người nhận ở đúng tổ chức, tiêu đề như trong app + tiêu đề việc + liên kết', async () => {
    const { publish, notifier, prisma } = setup({});
    await publish('ISSUE_ASSIGNED');
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(notifier.send).toHaveBeenCalledTimes(1);
    const [userId, orgId, html] = notifier.send.mock.calls[0]!;
    expect([userId, orgId]).toEqual(['r1', 'w1']);
    expect(html).toContain('<b>Nguyễn Thị Thuỳ Linh giao TIRA-BUG-28 cho bạn</b>');
    expect(html).toContain('Lỗi &lt;đăng nhập&gt; &amp; &quot;xoay&quot;');
    expect(html).toContain('<i>xem &lt;b&gt;này&lt;/b&gt;</i>');
    expect(html).toContain('<a href="https://tira.example/issue/TIRA-BUG-28">');
  });

  it('loại tắt Telegram (mặc định: bình luận) → không gửi, vẫn có in-app', async () => {
    const { publish, notifier, prisma } = setup({});
    await publish('COMMENT_ADDED');
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('người dùng bật Telegram cho bình luận / tắt cho nhắc tên → theo đó', async () => {
    const { publish, notifier } = setup({
      notifications: { telegram: { COMMENT_ADDED: true, MENTIONED: false } },
    });
    await publish('COMMENT_ADDED');
    await publish('MENTIONED');
    expect(notifier.send).toHaveBeenCalledTimes(1);
  });

  it('Telegram độc lập in-app: tắt in-app mà bật Telegram vẫn gửi Telegram, không tạo dòng in-app', async () => {
    const { publish, notifier, prisma } = setup({ notifications: { ISSUE_ASSIGNED: false } });
    await publish('ISSUE_ASSIGNED');
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(notifier.send).toHaveBeenCalledTimes(1);
  });

  it('không gửi cho chính người gây ra sự kiện', async () => {
    const { publish, notifier } = setup({});
    await publish('ISSUE_ASSIGNED', { actorId: 'r1' });
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('người dùng đã vô hiệu hoá → không gửi', async () => {
    const { publish, notifier } = setup({}, { status: 'DEACTIVATED' });
    await publish('ISSUE_ASSIGNED');
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('gửi Telegram treo → quá 10 giây thì bỏ qua, publish vẫn xong (không giữ handler)', async () => {
    vi.useFakeTimers();
    try {
      const { publish, notifier, prisma } = setup({});
      notifier.send.mockImplementation(() => new Promise<boolean>(() => undefined));
      let done = false;
      const p = publish('ISSUE_ASSIGNED').then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(TELEGRAM_SEND_TIMEOUT_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      await p;
      expect(done).toBe(true);
      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gửi Telegram lỗi (ném) → nuốt, in-app + email vẫn chạy', async () => {
    const { publish, notifier, prisma, mail } = setup({});
    notifier.send.mockRejectedValue(new Error('telegram chết'));
    await expect(publish('ISSUE_ASSIGNED')).resolves.toBeUndefined();
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(mail.enqueue).toHaveBeenCalledTimes(1);
  });
});

describe('NotificationsService — tuỳ chọn Telegram', () => {
  it('getPreferences trả telegram + telegramDefaults', async () => {
    const { service } = setup({ notifications: { telegram: { COMMENT_ADDED: true } } });
    const r = await service.getPreferences('r1');
    expect(r.telegram.COMMENT_ADDED).toBe(true);
    expect(r.telegram.ISSUE_ASSIGNED).toBe(true);
    expect(r.telegramDefaults.COMMENT_ADDED).toBe(false);
  });

  it('updatePreferences gộp telegram vào settings.notifications.telegram, giữ nhánh khác', async () => {
    const { service, prisma } = setup({
      theme: 'dark',
      notifications: { ISSUE_UPDATED: true, email: { comment: true } },
    });
    const r = await service.updatePreferences(
      'r1',
      {},
      {},
      { STATUS_CHANGED: true, MENTIONED: false },
    );
    const call = prisma.user.update.mock.calls[0] as unknown as [
      { data: { settings: { theme: string; notifications: Record<string, unknown> } } },
    ];
    const saved = call[0].data.settings;
    expect(saved.theme).toBe('dark');
    expect(saved.notifications.ISSUE_UPDATED).toBe(true);
    expect((saved.notifications.email as { comment: boolean }).comment).toBe(true);
    expect(saved.notifications.telegram).toMatchObject({ STATUS_CHANGED: true, MENTIONED: false });
    expect(r.telegram.STATUS_CHANGED).toBe(true);
    expect(r.telegram.MENTIONED).toBe(false);
  });
});
