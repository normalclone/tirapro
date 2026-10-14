import { describe, expect, it, vi } from 'vitest';
import { BoardsService } from './boards.service';

/** expect.stringContaining có kiểu any — bọc lại để không phát sinh cảnh báo lint. */
const has = (text: string): unknown => expect.stringContaining(text);

const STATUSES = [
  { id: 's1', name: 'Todo' },
  { id: 's2', name: 'Doing' },
  { id: 's3', name: 'Done' },
];

function boardRow(over: Record<string, unknown> = {}) {
  return {
    id: 'b1', projectId: 'p1', name: 'Board', type: 'SCRUM', filterJql: null, swimlaneConfig: {},
    project: { archivedAt: null, defaultWorkflowId: 'wf' },
    columns: [
      { id: 'c1', boardId: 'b1', name: 'Todo', order: 0, wipLimit: null, statuses: [{ statusId: 's1' }] },
      { id: 'c2', boardId: 'b1', name: 'Doing', order: 1, wipLimit: 3, statuses: [{ statusId: 's2' }] },
      { id: 'c3', boardId: 'b1', name: 'Done', order: 2, wipLimit: null, statuses: [{ statusId: 's3' }] },
    ],
    ...over,
  };
}

function make(board: unknown = boardRow()) {
  const tx = {
    boardColumn: {
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
      update: vi.fn(() => Promise.resolve({})),
      create: vi.fn((args: { data: { name: string } }) => Promise.resolve({ id: `new-${args.data.name}` })),
    },
    boardColumnStatus: {
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
      createMany: vi.fn((_args: { data: Array<{ columnId: string; statusId: string }> }) => Promise.resolve({ count: 0 })),
    },
  };
  const prisma = {
    $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)),
    board: { findFirst: vi.fn(() => Promise.resolve(board)), update: vi.fn(() => Promise.resolve({})) },
    status: { findMany: vi.fn(() => Promise.resolve(STATUSES)) },
  };
  const service = new BoardsService(prisma as never, {} as never, {} as never);
  return { service, prisma, tx };
}

const col = (name: string, statusIds: string[], extra: Record<string, unknown> = {}) => ({ name, statusIds, ...extra });

describe('BoardsService.setColumns', () => {
  it('thiếu trạng thái của workflow => lỗi liệt kê tên trạng thái thiếu, không ghi gì', async () => {
    const { service, prisma } = make();
    await expect(
      service.setColumns('w1', 'b1', { columns: [col('Việc cần làm', ['s1']), col('Đang làm', ['s2'])] }),
    ).rejects.toMatchObject({ status: 422, message: has('Done') });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('một trạng thái nằm ở hai cột => lỗi nêu tên trạng thái trùng', async () => {
    const { service, prisma } = make();
    await expect(
      service.setColumns('w1', 'b1', { columns: [col('A', ['s1', 's2']), col('B', ['s2', 's3'])] }),
    ).rejects.toMatchObject({ status: 422, message: has('Doing') });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('trạng thái không thuộc workflow của dự án => lỗi', async () => {
    const { service } = make();
    await expect(
      service.setColumns('w1', 'b1', { columns: [col('A', ['s1', 's2', 's3', 'lạ'])] }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('tên cột trùng nhau => lỗi (unique [boardId, name])', async () => {
    const { service } = make();
    await expect(
      service.setColumns('w1', 'b1', { columns: [col('A', ['s1']), col('a', ['s2', 's3'])] }),
    ).rejects.toMatchObject({ status: 422, message: has('trùng') });
  });

  it('id cột không thuộc board này => 404', async () => {
    const { service } = make();
    await expect(
      service.setColumns('w1', 'b1', { columns: [col('A', ['s1', 's2', 's3'], { id: 'cột-của-board-khác' })] }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('dự án đã lưu trữ => chặn', async () => {
    const { service, prisma } = make(boardRow({ project: { archivedAt: new Date(), defaultWorkflowId: 'wf' } }));
    await expect(
      service.setColumns('w1', 'b1', { columns: [col('A', ['s1', 's2', 's3'])] }),
    ).rejects.toMatchObject({ status: 422, message: has('lưu trữ') });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('hợp lệ => một transaction: xoá cột bị bỏ, cập nhật cột cũ theo thứ tự mảng, tạo cột mới, ghi lại liên kết trạng thái', async () => {
    const { service, tx, prisma } = make();
    await service.setColumns('w1', 'b1', {
      columns: [
        col('Mới + Đang làm', ['s1', 's2'], { id: 'c1', wipLimit: 5 }),
        col('Xong', ['s3'], { id: 'c3' }),
      ],
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // c2 không còn trong danh sách => bị xoá
    expect(tx.boardColumn.deleteMany).toHaveBeenCalledWith({ where: { boardId: 'b1', id: { notIn: ['c1', 'c3'] } } });
    const updates = tx.boardColumn.update.mock.calls as unknown as Array<[{ where: { id: string }; data: Record<string, unknown> }]>;
    const final = updates.filter(([a]) => !String(a.data.name).startsWith('~'));
    expect(final.map(([a]) => [a.where.id, a.data.name, a.data.order, a.data.wipLimit])).toEqual([
      ['c1', 'Mới + Đang làm', 0, 5],
      ['c3', 'Xong', 1, null],
    ]);
    const links = tx.boardColumnStatus.createMany.mock.calls[0]![0].data;
    expect(links).toEqual([
      { columnId: 'c1', statusId: 's1' },
      { columnId: 'c1', statusId: 's2' },
      { columnId: 'c3', statusId: 's3' },
    ]);
  });

  it('đổi tên hoán vị giữa hai cột không đụng unique tạm thời (đổi sang tên tạm trước)', async () => {
    const { service, tx } = make();
    await service.setColumns('w1', 'b1', {
      columns: [col('Doing', ['s2'], { id: 'c1' }), col('Todo', ['s1'], { id: 'c2' }), col('Done', ['s3'], { id: 'c3' })],
    });
    const names = (tx.boardColumn.update.mock.calls as unknown as Array<[{ data: { name: string } }]>).map(([a]) => a.data.name);
    const firstFinal = names.findIndex((n) => !n.startsWith('~'));
    expect(names.slice(0, firstFinal).every((n) => n.startsWith('~'))).toBe(true);
    expect(firstFinal).toBeGreaterThan(0);
  });

  it('cột mới (không id) được tạo theo đúng thứ tự mảng', async () => {
    const { service, tx } = make(boardRow({ columns: [] }));
    await service.setColumns('w1', 'b1', { columns: [col('Một', ['s1', 's2']), col('Hai', ['s3'], { wipLimit: 2 })] });
    const creates = tx.boardColumn.create.mock.calls as unknown as Array<[{ data: { name: string; order: number; wipLimit: number | null } }]>;
    expect(creates.map(([a]) => [a.data.name, a.data.order, a.data.wipLimit])).toEqual([['Một', 0, null], ['Hai', 1, 2]]);
    const links = tx.boardColumnStatus.createMany.mock.calls[0]![0].data;
    expect(links.map((l) => l.columnId)).toEqual(['new-Một', 'new-Một', 'new-Hai']);
  });
});

describe('BoardsService.update', () => {
  it('filterJql sai cú pháp => lỗi tiếng Việt, không ghi', async () => {
    const { service, prisma } = make();
    await expect(service.update('w1', 'b1', { filterJql: 'status = = x' })).rejects.toMatchObject({
      status: 422,
      message: has('Bộ lọc JQL không hợp lệ'),
    });
    expect(prisma.board.update).not.toHaveBeenCalled();
  });

  it('filterJql hợp lệ + swimlane => lưu filter và swimlaneConfig { by }', async () => {
    const { service, prisma } = make();
    await service.update('w1', 'b1', { filterJql: 'assignee = currentUser()', swimlaneBy: 'epic' });
    expect(prisma.board.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'b1' }, data: { filterJql: 'assignee = currentUser()', swimlaneConfig: { by: 'epic' } } }),
    );
  });

  it('filterJql rỗng => bỏ bộ lọc (null)', async () => {
    const { service, prisma } = make();
    await service.update('w1', 'b1', { filterJql: '   ' });
    expect(prisma.board.update).toHaveBeenCalledWith(expect.objectContaining({ data: { filterJql: null } }));
  });
});
