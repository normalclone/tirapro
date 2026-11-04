import { describe, expect, it, vi } from 'vitest';
import { moveIssuesToStatus } from './issue-status-move';

const ref = (id: string, category: 'TODO' | 'IN_PROGRESS' | 'DONE') => ({ id, name: id, category });

function fakeTx(
  rows: Array<{
    id: string;
    projectId: string;
    sprintId: string | null;
    resolutionId: string | null;
  }>,
) {
  return {
    issue: {
      findMany: vi.fn((_a: { where: Record<string, unknown> }) => Promise.resolve(rows)),
      updateMany: vi.fn((_a: { where: { id: { in: string[] } }; data: Record<string, unknown> }) =>
        Promise.resolve({ count: 0 }),
      ),
    },
    issueHistory: {
      createMany: vi.fn((_a: { data: Array<Record<string, unknown>> }) =>
        Promise.resolve({ count: 0 }),
      ),
    },
  };
}
const rows = [
  { id: 'a', projectId: 'p1', sprintId: 's1', resolutionId: null },
  { id: 'b', projectId: 'p2', sprintId: null, resolutionId: 'r1' },
];
const args = (from: ReturnType<typeof ref>, to: ReturnType<typeof ref>) => ({
  where: { organizationId: 'w1', typeId: 't1' },
  from,
  to,
  actorId: 'u1',
  defaultResolutionId: 'r-def',
});

describe('moveIssuesToStatus', () => {
  it('tăng version, đặt trạng thái mới, ghi MỘT dòng lịch sử STATUS cho mỗi việc', async () => {
    const tx = fakeTx(rows);
    const r = await moveIssuesToStatus(
      tx as never,
      args(ref('old', 'IN_PROGRESS'), ref('new', 'IN_PROGRESS')),
    );
    expect(r).toEqual({ count: 2, projectIds: ['p1', 'p2'] });
    expect(tx.issue.findMany.mock.calls[0]![0].where).toMatchObject({
      organizationId: 'w1',
      typeId: 't1',
      statusId: 'old',
    });
    const w = tx.issue.updateMany.mock.calls[0]![0];
    expect(w.where.id.in).toEqual(['a', 'b']);
    expect(w.data).toMatchObject({ statusId: 'new', updatedById: 'u1', version: { increment: 1 } });
    expect(w.data).not.toHaveProperty('resolvedAt');
    const hist = tx.issueHistory.createMany.mock.calls[0]![0].data;
    expect(hist).toHaveLength(2);
    expect(hist[0]).toMatchObject({
      issueId: 'a',
      projectId: 'p1',
      sprintId: 's1',
      field: 'STATUS',
      oldValue: 'old',
      newValue: 'new',
      oldCategory: 'IN_PROGRESS',
      newCategory: 'IN_PROGRESS',
      actorId: 'u1',
    });
  });

  it('vào DONE: việc có Resolution giữ nguyên, việc chưa có nhận Resolution mặc định, cả hai có resolvedAt', async () => {
    const tx = fakeTx(rows);
    await moveIssuesToStatus(tx as never, args(ref('old', 'IN_PROGRESS'), ref('done', 'DONE')));
    const calls = tx.issue.updateMany.mock.calls.map((c) => c[0]);
    const withRes = calls.find((c) => c.where.id.in.includes('b'))!;
    const noRes = calls.find((c) => c.where.id.in.includes('a'))!;
    expect(withRes.data.resolvedAt).toBeInstanceOf(Date);
    expect(withRes.data).not.toHaveProperty('resolutionId');
    expect(noRes.data).toMatchObject({ resolutionId: 'r-def' });
    expect(noRes.data.resolvedAt).toBeInstanceOf(Date);
  });

  it('rời DONE: xoá resolution và resolvedAt; DONE → DONE giữ nguyên', async () => {
    const leave = fakeTx(rows);
    await moveIssuesToStatus(leave as never, args(ref('done', 'DONE'), ref('prog', 'IN_PROGRESS')));
    expect(leave.issue.updateMany.mock.calls[0]![0].data).toMatchObject({
      resolvedAt: null,
      resolutionId: null,
    });
    const same = fakeTx(rows);
    await moveIssuesToStatus(same as never, args(ref('closed', 'DONE'), ref('done', 'DONE')));
    expect(same.issue.updateMany.mock.calls[0]![0].data).not.toHaveProperty('resolvedAt');
  });

  it('không có việc nào => không ghi gì', async () => {
    const tx = fakeTx([]);
    expect(await moveIssuesToStatus(tx as never, args(ref('a', 'TODO'), ref('b', 'TODO')))).toEqual(
      { count: 0, projectIds: [] },
    );
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(tx.issueHistory.createMany).not.toHaveBeenCalled();
  });

  it('lô lớn được cắt từng 1000 id mỗi câu', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({
      id: `i${i}`,
      projectId: 'p1',
      sprintId: null,
      resolutionId: null,
    }));
    const tx = fakeTx(many);
    await moveIssuesToStatus(tx as never, args(ref('a', 'TODO'), ref('b', 'TODO')));
    expect(tx.issue.updateMany.mock.calls.map((c) => c[0].where.id.in.length)).toEqual([
      1000, 1000, 500,
    ]);
    expect(tx.issueHistory.createMany.mock.calls.map((c) => c[0].data.length)).toEqual([
      1000, 1000, 500,
    ]);
  });
});
