import { describe, expect, it, vi } from 'vitest';
import { DigestsService } from './digests.service';

function setup(
  resolution: { kind: 'global' } | { kind: 'own'; token: string } | { kind: 'unusable' },
) {
  const prisma = {
    reportSubscription: {
      findFirst: vi.fn(() =>
        Promise.resolve({ id: 's1', workspaceId: 'w1', projectId: null, channelId: 'ch1' }),
      ),
      update: vi.fn(() => Promise.resolve({})),
    },
    integrationChannel: {
      findFirst: vi.fn(() =>
        Promise.resolve({
          externalId: 'c1',
          integration: { id: 'g1', type: 'TELEGRAM', status: 'ACTIVE', config: { botToken: 'x' } },
        }),
      ),
    },
  };
  const telegram = {
    resolveBotToken: vi.fn(() => resolution),
    send: vi.fn(() => Promise.resolve(true)),
  };
  const integrations = { reportUnusableToken: vi.fn(() => Promise.resolve()) };
  const service = new DigestsService(
    prisma as never,
    telegram as never,
    {} as never,
    integrations as never,
  );
  vi.spyOn(service, 'buildDigest').mockResolvedValue('tổng kết');
  return { service, prisma, telegram, integrations };
}

describe('DigestsService.run — token không dùng được', () => {
  it('unusable → 422, không gửi bằng bot toàn cục, đánh dấu tích hợp lỗi', async () => {
    const { service, telegram, integrations } = setup({ kind: 'unusable' });
    await expect(service.run('w1', 's1')).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('không dùng được') as unknown,
    });
    expect(telegram.send).not.toHaveBeenCalled();
    expect(integrations.reportUnusableToken).toHaveBeenCalledWith('g1');
  });

  it('own/global → gửi như cũ', async () => {
    const { service, telegram } = setup({ kind: 'own', token: 'T' });
    await expect(service.run('w1', 's1')).resolves.toMatchObject({ sent: true });
    expect(telegram.send).toHaveBeenCalledWith('T', 'c1', 'tổng kết');
  });
});
