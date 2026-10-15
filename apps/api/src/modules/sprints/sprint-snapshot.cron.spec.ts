import { describe, expect, it, vi } from 'vitest';
import { SprintSnapshotCron } from './sprint-snapshot.cron';

type SnapArgs = { where: { sprintId: string } };

function make(opts: {
  sprints: Array<{ id: string; startDate: Date | null }>;
  existing?: string[];
  failOn?: string;
}) {
  const prisma = {
    sprint: { findMany: vi.fn(() => Promise.resolve(opts.sprints)) },
    sprintSnapshot: {
      findFirst: vi.fn((args: SnapArgs) =>
        Promise.resolve(opts.existing?.includes(args.where.sprintId) ? { id: 'x' } : null),
      ),
    },
    $transaction: (fn: (t: unknown) => unknown) => fn({}),
  };
  const sprints = {
    snapshot: vi.fn((_tx: unknown, id: string, _kind: string, _at: Date) =>
      id === opts.failOn ? Promise.reject(new Error('boom')) : Promise.resolve(),
    ),
  };
  const redis = { isAvailable: () => false, getClient: () => null };
  return {
    cron: new SprintSnapshotCron(prisma as never, redis as never, sprints as never),
    prisma,
    sprints,
  };
}

const NOW = new Date('2026-10-16T00:05:00Z');

describe('SprintSnapshotCron', () => {
  it('chụp DAILY cho sprint ACTIVE, đóng dấu cuối ngày hôm qua (23:59:59.999 UTC)', async () => {
    const { cron, sprints, prisma } = make({
      sprints: [{ id: 's1', startDate: new Date('2026-10-10T00:00:00Z') }],
    });
    expect(await cron.snapshotActiveSprints(NOW)).toBe(1);
    const [, id, kind, at] = sprints.snapshot.mock.calls[0]!;
    expect([id, kind, at.toISOString()]).toEqual(['s1', 'DAILY', '2026-10-15T23:59:59.999Z']);
    // chỉ quét sprint ACTIVE chưa xoá, mọi workspace (không lọc workspaceId)
    expect(prisma.sprint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { state: 'ACTIVE', deletedAt: null, project: { deletedAt: null } },
      }),
    );
  });

  it('đã có snapshot DAILY của ngày đó => không ghi trùng (chạy lại/hai node vẫn an toàn)', async () => {
    const { cron, sprints } = make({
      sprints: [
        { id: 's1', startDate: null },
        { id: 's2', startDate: null },
      ],
      existing: ['s1'],
    });
    expect(await cron.snapshotActiveSprints(NOW)).toBe(1);
    expect(sprints.snapshot.mock.calls.map((c) => c[1])).toEqual(['s2']);
  });

  it('sprint vừa start sau ngày được chụp => bỏ qua', async () => {
    const { cron, sprints } = make({
      sprints: [{ id: 's1', startDate: new Date('2026-10-16T00:03:00Z') }],
    });
    expect(await cron.snapshotActiveSprints(NOW)).toBe(0);
    expect(sprints.snapshot).not.toHaveBeenCalled();
  });

  it('một sprint lỗi không chặn các sprint còn lại', async () => {
    const { cron, sprints } = make({
      sprints: [
        { id: 's1', startDate: null },
        { id: 's2', startDate: null },
      ],
      failOn: 's1',
    });
    expect(await cron.snapshotActiveSprints(NOW)).toBe(1);
    expect(sprints.snapshot).toHaveBeenCalledTimes(2);
  });
});
