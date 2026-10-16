import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_GUIDES } from '@tirapro/shared';
import { GuidesBootstrapService } from './guides-bootstrap.service';

describe('GuidesBootstrapService', () => {
  it('chèn guide chưa có, bỏ qua guide cùng version, nâng cấp guide version thấp hơn', async () => {
    const tx = {
      $executeRaw: vi.fn(() => Promise.resolve(1)),
      guide: {
        findFirst: vi.fn(({ where }: { where: { key: string } }) =>
          Promise.resolve(
            where.key === 'tour-home'
              ? { id: 'g1', version: 1 }
              : where.key === 'tour-board'
                ? { id: 'g2', version: 0 }
                : null,
          ),
        ),
        create: vi.fn(() => Promise.resolve({})),
        update: vi.fn((..._a: unknown[]) => Promise.resolve({})),
      },
    };
    const prisma = {
      $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    };
    const svc = new GuidesBootstrapService(prisma as never);
    await svc.ensureDefaults();
    expect(tx.guide.update).toHaveBeenCalledTimes(1); // tour-board (v0 → v1)
    expect(tx.guide.update.mock.calls[0]![0]).toMatchObject({ where: { id: 'g2' } });
    expect(tx.guide.create.mock.calls.length).toBe(DEFAULT_GUIDES.length - 2);
    const first = (
      tx.guide.create.mock.calls as unknown as [{ data: { workspaceId: unknown } }][]
    )[0]![0];
    expect(first.data.workspaceId).toBeNull();
  });

  it('so khớp guide toàn cục theo (workspaceId = null, key) và lấy khoá tư vấn trong CÙNG transaction', async () => {
    const tx = {
      $executeRaw: vi.fn(() => Promise.resolve(1)),
      guide: {
        findFirst: vi.fn(() => Promise.resolve({ id: 'x', version: 99 })),
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    };
    await new GuidesBootstrapService(prisma as never).ensureDefaults();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.guide.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: null, key: DEFAULT_GUIDES[0]!.key } }),
    );
    expect(tx.guide.create).not.toHaveBeenCalled();
    expect(tx.guide.update).not.toHaveBeenCalled(); // DB mới hơn code → không hạ cấp
  });

  it('lỗi DB không làm API khởi động thất bại', async () => {
    const prisma = {
      $transaction: vi.fn(() => {
        throw new Error('db');
      }),
    };
    await expect(
      new GuidesBootstrapService(prisma as never).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
  });
});
