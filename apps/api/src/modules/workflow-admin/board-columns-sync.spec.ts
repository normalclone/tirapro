import { describe, expect, it, vi } from 'vitest';
import {
  appendMissingBoardStatuses,
  pickColumnForCategory,
  pruneUnusedBoardStatuses,
} from './board-columns-sync';

describe('pickColumnForCategory', () => {
  const cols = [
    { id: 'todo', categories: ['TODO' as const] },
    { id: 'doing', categories: ['IN_PROGRESS' as const, 'IN_PROGRESS' as const] },
    { id: 'done', categories: ['DONE' as const] },
  ];
  it('cột đầu tiên đang chứa trạng thái cùng nhóm', () => {
    expect(pickColumnForCategory(cols, 'TODO')).toBe('todo');
    expect(pickColumnForCategory(cols, 'IN_PROGRESS')).toBe('doing');
    expect(pickColumnForCategory(cols, 'DONE')).toBe('done');
  });
  it('bảng không có trạng thái nhóm đó: TODO → cột đầu, DONE → cột cuối, IN_PROGRESS → cột thứ hai', () => {
    const noDoing = [
      { id: 'a', categories: ['TODO' as const] },
      { id: 'b', categories: ['TODO' as const] },
      { id: 'c', categories: ['TODO' as const] },
    ];
    expect(pickColumnForCategory(noDoing, 'DONE')).toBe('c');
    expect(pickColumnForCategory(noDoing, 'IN_PROGRESS')).toBe('b');
    expect(pickColumnForCategory([{ id: 'only', categories: [] }], 'IN_PROGRESS')).toBe('only');
    expect(pickColumnForCategory([], 'TODO')).toBeNull();
  });
});

describe('appendMissingBoardStatuses (M1: bảng vẫn lưu được, không thẻ nào biến mất)', () => {
  /** Quy trình mới `wfNew`: 3 trạng thái cùng nhóm với 3 cột mặc định, 1 trạng thái đã có sẵn trên bảng. */
  const NEW_STATUSES = [
    { id: 'n-todo', category: 'TODO' },
    { id: 'n-prog', category: 'IN_PROGRESS' },
    { id: 'n-review', category: 'IN_PROGRESS' },
    { id: 'n-done', category: 'DONE' },
  ];
  function fakeTx(boardColumns: Array<{ id: string; statuses: string[] }>, extra: string[] = []) {
    const board = {
      id: 'b1',
      columns: boardColumns.map((c) => ({
        id: c.id,
        statuses: c.statuses.map((statusId) => ({ statusId })),
      })),
    };
    const old = [
      { id: 'o-todo', category: 'TODO' },
      { id: 'o-prog', category: 'IN_PROGRESS' },
      { id: 'o-done', category: 'DONE' },
    ];
    return {
      status: {
        findMany: vi.fn((a: { where: { workflowId?: unknown; id?: unknown } }) =>
          Promise.resolve(
            a.where.workflowId
              ? [...NEW_STATUSES, ...extra.map((id) => ({ id, category: 'TODO' }))]
              : old,
          ),
        ),
      },
      board: { findMany: vi.fn(() => Promise.resolve([board])) },
      boardColumnStatus: {
        createMany: vi.fn((_a: { data: Array<{ columnId: string; statusId: string }> }) =>
          Promise.resolve({ count: 0 }),
        ),
      },
    };
  }
  const cols = () => [
    { id: 'c-todo', statuses: ['o-todo'] },
    { id: 'c-prog', statuses: ['o-prog'] },
    { id: 'c-done', statuses: ['o-done'] },
  ];

  it('thêm trạng thái còn thiếu vào cột To Do / In Progress / Done theo NHÓM, không gỡ trạng thái cũ', async () => {
    const tx = fakeTx(cols());
    const r = await appendMissingBoardStatuses(tx as never, 'p1', ['wfNew']);
    expect(r.added).toBe(4);
    const links = tx.boardColumnStatus.createMany.mock.calls[0]![0].data;
    expect(links).toEqual(
      expect.arrayContaining([
        { columnId: 'c-todo', statusId: 'n-todo' },
        { columnId: 'c-prog', statusId: 'n-prog' },
        { columnId: 'c-prog', statusId: 'n-review' },
        { columnId: 'c-done', statusId: 'n-done' },
      ]),
    );
    expect(links).toHaveLength(4);
  });

  it('trạng thái đã nằm trong một cột bất kỳ thì bỏ qua; idempotent khi đã đủ', async () => {
    const tx = fakeTx([
      { id: 'c-todo', statuses: ['o-todo', 'n-todo'] },
      { id: 'c-prog', statuses: ['o-prog'] },
      { id: 'c-done', statuses: ['o-done', 'n-done', 'n-prog', 'n-review'] },
    ]);
    const r = await appendMissingBoardStatuses(tx as never, 'p1', ['wfNew']);
    expect(r.added).toBe(0);
    expect(tx.boardColumnStatus.createMany).not.toHaveBeenCalled();
  });

  it('không có quy trình đang dùng => không truy vấn gì; bảng không có cột => không thêm', async () => {
    const tx = fakeTx(cols());
    expect(await appendMissingBoardStatuses(tx as never, 'p1', [])).toEqual({ added: 0 });
    expect(tx.status.findMany).not.toHaveBeenCalled();
    const empty = fakeTx([]);
    expect((await appendMissingBoardStatuses(empty as never, 'p1', ['wfNew'])).added).toBe(0);
  });
});

describe('pruneUnusedBoardStatuses (không để cột "ma" sau khi chuyển đổi)', () => {
  /** Hai cột: `A` có {old1, new1}, `B` có {old2} (chỉ trạng thái cũ), `C` có {old3, new3}. `busy` = trạng thái còn việc. */
  function fakeTx(busy: string[]) {
    const links = [
      { columnId: 'A', statusId: 'old1' },
      { columnId: 'B', statusId: 'old2' },
      { columnId: 'C', statusId: 'old3' },
    ];
    const perColumn: Record<string, number> = { A: 2, B: 1, C: 2 };
    return {
      boardColumnStatus: {
        findMany: vi.fn(() => Promise.resolve(links)),
        groupBy: vi.fn(() =>
          Promise.resolve(
            Object.entries(perColumn).map(([columnId, n]) => ({ columnId, _count: { _all: n } })),
          ),
        ),
        deleteMany: vi.fn(() => Promise.resolve({ count: 1 })),
      },
      issue: {
        groupBy: vi.fn(() =>
          Promise.resolve(busy.map((statusId) => ({ statusId, _count: { _all: 3 } }))),
        ),
      },
    };
  }

  it('gỡ trạng thái cũ không còn việc; giữ trạng thái còn việc và trạng thái cuối cùng của cột', async () => {
    const tx = fakeTx(['old3']);
    const r = await pruneUnusedBoardStatuses(tx as never, 'p1', ['wfNew']);
    // old1: không việc, cột A còn new1 → gỡ. old2: không việc nhưng là trạng thái cuối của cột B → giữ. old3: còn việc → giữ.
    expect(r.removed).toBe(1);
    expect(tx.boardColumnStatus.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.boardColumnStatus.deleteMany).toHaveBeenCalledWith({
      where: { columnId: 'A', statusId: 'old1' },
    });
  });
  it('chỉ xét trạng thái NGOÀI quy trình đang dùng và đếm việc của chính dự án (kể cả thùng rác)', async () => {
    const tx = fakeTx([]);
    await pruneUnusedBoardStatuses(tx as never, 'p1', ['wfNew', 'wfBug']);
    expect(tx.boardColumnStatus.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          column: { board: { projectId: 'p1', deletedAt: null } },
          status: { workflowId: { notIn: ['wfNew', 'wfBug'] } },
        },
      }),
    );
    const where = (
      tx.issue.groupBy.mock.calls[0] as unknown as [{ where: Record<string, unknown> }]
    )[0].where;
    expect(where).toEqual({ projectId: 'p1', statusId: { in: ['old1', 'old2', 'old3'] } });
  });
  it('không có quy trình đang dùng → không đụng gì', async () => {
    const tx = fakeTx([]);
    expect(await pruneUnusedBoardStatuses(tx as never, 'p1', [])).toEqual({ removed: 0 });
    expect(tx.boardColumnStatus.findMany).not.toHaveBeenCalled();
  });
});
