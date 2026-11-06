import { describe, expect, it, vi } from 'vitest';
import { TelegramNotifier } from './telegram-notifier.service';

function setup(
  opts: {
    link?: unknown;
    resolve?: { kind: string; token?: string };
    outcome?: string;
    globalAvailable?: boolean;
  } = {},
) {
  const link =
    opts.link === undefined
      ? {
          id: 'l1',
          chatId: '555',
          integration: { id: 'g1', config: { botToken: 'ENC' }, status: 'ACTIVE' },
        }
      : opts.link;
  const prisma = {
    userTelegramLink: {
      findUnique: vi.fn(() => Promise.resolve(link)),
      deleteMany: vi.fn(() => Promise.resolve({ count: 1 })),
    },
  };
  const telegram = {
    resolveBotToken: vi.fn(() => opts.resolve ?? { kind: 'own', token: 'T' }),
    available: vi.fn(() => opts.globalAvailable ?? true),
    sendDetailed: vi.fn(() => Promise.resolve(opts.outcome ?? 'ok')),
  };
  const notifier = new TelegramNotifier(prisma as never, telegram as never);
  return { notifier, prisma, telegram };
}

describe('TelegramNotifier.send', () => {
  it('có liên kết + bot ACTIVE → gửi vào chat riêng bằng token của kết nối, trả true', async () => {
    const { notifier, telegram, prisma } = setup();
    expect(await notifier.send('u1', 'w1', '<b>hi</b>')).toBe(true);
    expect(telegram.sendDetailed).toHaveBeenCalledWith('T', '555', '<b>hi</b>');
    expect(prisma.userTelegramLink.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_organizationId: { userId: 'u1', organizationId: 'w1' } },
      }),
    );
  });

  it('bot chung → token null', async () => {
    const { notifier, telegram } = setup({ resolve: { kind: 'global' } });
    await notifier.send('u1', 'w1', 'x');
    expect(telegram.sendDetailed).toHaveBeenCalledWith(null, '555', 'x');
  });

  it('không liên kết / kết nối không ACTIVE / token hỏng / bot chung thiếu → không gửi, false', async () => {
    expect(await setup({ link: null }).notifier.send('u1', 'w1', 'x')).toBe(false);
    const inactive = setup({
      link: { id: 'l1', chatId: '1', integration: { id: 'g', config: {}, status: 'ERROR' } },
    });
    expect(await inactive.notifier.send('u1', 'w1', 'x')).toBe(false);
    expect(inactive.telegram.sendDetailed).not.toHaveBeenCalled();
    const bad = setup({ resolve: { kind: 'unusable' } });
    expect(await bad.notifier.send('u1', 'w1', 'x')).toBe(false);
    expect(bad.telegram.sendDetailed).not.toHaveBeenCalled();
    const noGlobal = setup({ resolve: { kind: 'global' }, globalAvailable: false });
    expect(await noGlobal.notifier.send('u1', 'w1', 'x')).toBe(false);
  });

  it('bot bị chặn (403) → xoá liên kết để không gửi lại mãi, trả false', async () => {
    const { notifier, prisma } = setup({ outcome: 'blocked' });
    vi.spyOn(
      (notifier as unknown as { logger: { warn: () => void } }).logger,
      'warn',
    ).mockImplementation(() => undefined);
    expect(await notifier.send('u1', 'w1', 'x')).toBe(false);
    expect(prisma.userTelegramLink.deleteMany).toHaveBeenCalledWith({ where: { id: 'l1' } });
  });

  it('lỗi tạm thời (failed) → giữ liên kết; ngoại lệ bất ngờ → nuốt, không ném', async () => {
    const failed = setup({ outcome: 'failed' });
    expect(await failed.notifier.send('u1', 'w1', 'x')).toBe(false);
    expect(failed.prisma.userTelegramLink.deleteMany).not.toHaveBeenCalled();
    const boom = setup();
    boom.prisma.userTelegramLink.findUnique.mockRejectedValue(new Error('db down'));
    vi.spyOn(
      (boom.notifier as unknown as { logger: { warn: () => void } }).logger,
      'warn',
    ).mockImplementation(() => undefined);
    await expect(boom.notifier.send('u1', 'w1', 'x')).resolves.toBe(false);
  });
});
