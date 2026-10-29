import { describe, expect, it, vi } from 'vitest';
import { RankService } from './rank.service';

// Hai mốc "sát nhau" (next = prev + số 0) => rankBetween ném RankGapError, KHÔNG phải mốc đảo thứ tự.
const TIGHT = { prev: 'n', next: 'n0' };

function make(txOverrides: Record<string, unknown> = {}) {
  const tx = {
    project: { update: vi.fn(() => Promise.resolve({ id: 'p1' })) },
    issue: {
      findMany: vi.fn(() => Promise.resolve([{ id: 'a' }, { id: 'm' }, { id: 'b' }])),
      findFirst: vi.fn(),
    },
    $executeRaw: vi.fn(() => Promise.resolve(3)),
    ...txOverrides,
  };
  const prisma = { $transaction: (fn: (t: unknown) => unknown) => fn(tx), ...tx };
  const events = { emit: vi.fn() };
  return { svc: new RankService(prisma as never, events as never), tx, prisma, events };
}

describe('RankService.resolveRank', () => {
  it('còn chỗ chèn => tính 1 lần, không rebalance', async () => {
    const { svc, tx, events } = make();
    const read = vi.fn(() => Promise.resolve({ prev: 'a', next: 'z' }));
    const rank = await svc.resolveRank('p1', tx as never, null, null, read);
    expect(rank > 'a' && rank < 'z').toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('hết chỗ chèn (RankGapError) => đúng 1 câu UPDATE cho cả project, đọc lại mốc, phát PROJECT_RANKS_REBALANCED', async () => {
    const { svc, prisma, tx, events } = make();
    let rebalanced = false;
    tx.project.update.mockImplementation(() => {
      rebalanced = true;
      return Promise.resolve({ id: 'p1' });
    });
    const read = vi.fn(() => Promise.resolve(rebalanced ? { prev: 'i', next: 'r' } : TIGHT));
    const rank = await svc.resolveRank('p1', prisma as never, null, 'm', read);
    expect(rank > 'i' && rank < 'r').toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [, movedId, ids, ranks] = tx.$executeRaw.mock.calls[0] as unknown as [
      unknown,
      string,
      string[],
      string[],
    ];
    expect(movedId).toBe('m');
    expect(ids).toEqual(['a', 'm', 'b']);
    expect(new Set(ranks).size).toBe(ids.length);
    expect(events.emit).toHaveBeenCalledWith('project.ranks_rebalanced', { projectId: 'p1' });
  });

  it('trong transaction của bên gọi: sự kiện chạy qua `deferred`, chưa phát ngay', async () => {
    const { svc, tx, events } = make();
    let n = 0;
    const read = vi.fn(() => Promise.resolve(n++ === 0 ? TIGHT : { prev: 'i', next: 'r' }));
    const deferred: Array<() => void> = [];
    await svc.resolveRank('p1', tx as never, deferred, null, read);
    expect(events.emit).not.toHaveBeenCalled();
    deferred.forEach((f) => f());
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('sau rebalance vẫn hết chỗ => BusinessRuleException, không lặp vô hạn', async () => {
    const { svc, tx } = make();
    const read = vi.fn(() => Promise.resolve(TIGHT));
    await expect(svc.resolveRank('p1', tx as never, null, null, read)).rejects.toThrow(
      /tải lại trang/,
    );
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('hai mốc đảo thứ tự => 409 RANK_NEIGHBORS_STALE ngay lần đọc đầu, KHÔNG rebalance', async () => {
    const { svc, tx, events } = make();
    const read = vi.fn(() => Promise.resolve({ prev: 'n', next: 'i' }));
    await expect(svc.resolveRank('p1', tx as never, null, 'm', read)).rejects.toMatchObject({
      status: 409,
      code: 'RANK_NEIGHBORS_STALE',
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(tx.project.update).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('mốc đảo thứ tự xuất hiện SAU rebalance => 409 RANK_NEIGHBORS_STALE', async () => {
    const { svc, tx } = make();
    let n = 0;
    const read = vi.fn(() => Promise.resolve(n++ === 0 ? TIGHT : { prev: 'r', next: 'i' }));
    await expect(svc.resolveRank('p1', tx as never, null, null, read)).rejects.toMatchObject({
      status: 409,
      code: 'RANK_NEIGHBORS_STALE',
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('prev === next sau khi bỏ số 0 đuôi KHÔNG tính là đảo => đi đường rebalance', async () => {
    const { svc, tx } = make();
    let n = 0;
    const read = vi.fn(() =>
      Promise.resolve(n++ === 0 ? { prev: 'n', next: 'n' } : { prev: 'i', next: 'r' }),
    );
    const rank = await svc.resolveRank('p1', tx as never, null, null, read);
    expect(rank > 'i' && rank < 'r').toBe(true);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
});

describe('RankService.rankOf', () => {
  it('mốc không tồn tại => 404', async () => {
    const { svc, tx } = make();
    tx.issue.findFirst.mockResolvedValue(null);
    await expect(svc.rankOf('w1', 'p1', 'x')).rejects.toMatchObject({ status: 404 });
  });

  it('mốc còn sống => trả rank, tìm theo workspace/project và bỏ issue đã xoá mềm', async () => {
    const { svc, tx } = make();
    tx.issue.findFirst.mockResolvedValue({ rank: 'k' });
    await expect(svc.rankOf('w1', 'p1', 'x')).resolves.toBe('k');
    expect(tx.issue.findFirst).toHaveBeenCalledWith({
      where: { id: 'x', workspaceId: 'w1', projectId: 'p1', deletedAt: null },
      select: { rank: true },
    });
  });
});

describe('RankService.rankOf — đọc qua tx khi được truyền (R3)', () => {
  it('có db (tx): đọc bằng tx.issue.findFirst, KHÔNG đụng this.prisma', async () => {
    const outside = { issue: { findFirst: vi.fn() } };
    const tx = { issue: { findFirst: vi.fn(() => Promise.resolve({ rank: 'k' })) } };
    const svc = new RankService(outside as never, { emit: vi.fn() } as never);
    await expect(svc.rankOf('w1', 'p1', 'x', tx as never)).resolves.toBe('k');
    expect(tx.issue.findFirst).toHaveBeenCalledTimes(1);
    expect(outside.issue.findFirst).not.toHaveBeenCalled();
  });
  it('không truyền db: vẫn dùng this.prisma như cũ (tham số mặc định)', async () => {
    const outside = { issue: { findFirst: vi.fn(() => Promise.resolve({ rank: 'z' })) } };
    const svc = new RankService(outside as never, { emit: vi.fn() } as never);
    await expect(svc.rankOf('w1', 'p1', 'x')).resolves.toBe('z');
    expect(outside.issue.findFirst).toHaveBeenCalledTimes(1);
  });
});
