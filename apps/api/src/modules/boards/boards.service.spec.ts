import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { BoardsService } from './boards.service';

/** expect.stringContaining có kiểu any — bọc lại để không phát sinh cảnh báo lint. */
const has = (text: string): unknown => expect.stringContaining(text);

const STATUSES = [
  { id: 's1', name: 'Todo', workflowId: 'wf' },
  { id: 's2', name: 'Doing', workflowId: 'wf' },
  { id: 's3', name: 'Done', workflowId: 'wf' },
];

function boardRow(over: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    projectId: 'p1',
    name: 'Board',
    type: 'SCRUM',
    filterJql: null,
    swimlaneConfig: {},
    project: { archivedAt: null, defaultWorkflowId: 'wf' },
    columns: [
      {
        id: 'c1',
        boardId: 'b1',
        name: 'Todo',
        order: 0,
        wipLimit: null,
        statuses: [{ statusId: 's1' }],
      },
      {
        id: 'c2',
        boardId: 'b1',
        name: 'Doing',
        order: 1,
        wipLimit: 3,
        statuses: [{ statusId: 's2' }],
      },
      {
        id: 'c3',
        boardId: 'b1',
        name: 'Done',
        order: 2,
        wipLimit: null,
        statuses: [{ statusId: 's3' }],
      },
    ],
    ...over,
  };
}

function make(
  board: unknown = boardRow(),
  opts: {
    lockedColumnIds?: string[];
    /** Loại việc → quy trình theo tổ chức (không có = mọi loại rơi về quy trình mặc định của dự án). */
    scheme?: Array<{ issueTypeId: string; workflowId: string }>;
    types?: Array<{ id: string }>;
    statuses?: Array<{ id: string; name: string; workflowId: string }>;
    /** Trạng thái đang nằm trong cột của bảng (trước khi lưu); mặc định = đúng các trạng thái trong `board.columns`. */
    linked?: Array<{ statusId: string; name: string }>;
    /** Số việc của dự án theo trạng thái (kể cả thùng rác). */
    issueCounts?: Record<string, number>;
  } = {},
) {
  const liveIds =
    opts.lockedColumnIds ?? (board as { columns: Array<{ id: string }> }).columns.map((c) => c.id);
  const tx = {
    $queryRaw: vi.fn(() => Promise.resolve([{ id: 'b1' }])),
    boardColumn: {
      findMany: vi.fn(() => Promise.resolve(liveIds.map((id) => ({ id })))),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
      update: vi.fn(() => Promise.resolve({})),
      create: vi.fn((args: { data: { name: string } }) =>
        Promise.resolve({ id: `new-${args.data.name}` }),
      ),
    },
    boardColumnStatus: {
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
      createMany: vi.fn((_args: { data: Array<{ columnId: string; statusId: string }> }) =>
        Promise.resolve({ count: 0 }),
      ),
    },
  };
  const prisma = {
    $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)),
    board: {
      findFirst: vi.fn(() => Promise.resolve(board)),
      update: vi.fn(() => Promise.resolve({})),
    },
    status: {
      findMany: vi.fn((a: { where: { workflowId: { in: string[] } } }) =>
        Promise.resolve(
          (opts.statuses ?? STATUSES).filter((s) => a.where.workflowId.in.includes(s.workflowId)),
        ),
      ),
    },
    // Resolver quy trình theo loại việc.
    project: {
      findUnique: vi.fn(() => Promise.resolve({ organizationId: 'w1', defaultWorkflowId: 'wf' })),
    },
    projectWorkflowOverride: { findMany: vi.fn(() => Promise.resolve([])) },
    organizationWorkflowScheme: { findMany: vi.fn(() => Promise.resolve(opts.scheme ?? [])) },
    issueType: { findMany: vi.fn(() => Promise.resolve(opts.types ?? [{ id: 'tTask' }])) },
    // Trạng thái đang nằm trong cột + đếm việc: để kiểm "bỏ trạng thái còn việc khỏi bảng".
    boardColumnStatus: {
      findMany: vi.fn(() => {
        const cols =
          (board as { columns?: Array<{ statuses?: Array<{ statusId: string }> }> }).columns ?? [];
        const rows =
          opts.linked ??
          cols.flatMap((c) =>
            (c.statuses ?? []).map((l) => ({ statusId: l.statusId, name: l.statusId })),
          );
        return Promise.resolve(
          rows.map((r) => ({ statusId: r.statusId, status: { name: r.name } })),
        );
      }),
    },
    issue: {
      groupBy: vi.fn((a: { where: { statusId: { in: string[] } } }) =>
        Promise.resolve(
          a.where.statusId.in
            .filter((id) => (opts.issueCounts?.[id] ?? 0) > 0)
            .map((id) => ({ statusId: id, _count: { _all: opts.issueCounts![id]! } })),
        ),
      ),
    },
  };
  const service = new BoardsService(prisma as never, {} as never, {} as never);
  return { service, prisma, tx };
}

const col = (name: string, statusIds: string[], extra: Record<string, unknown> = {}) => ({
  name,
  statusIds,
  ...extra,
});

describe('BoardsService.setColumns', () => {
  it('thiếu trạng thái của workflow => lỗi liệt kê tên trạng thái thiếu, không ghi gì', async () => {
    const { service, prisma } = make();
    await expect(
      service.setColumns('w1', 'b1', {
        columns: [col('Việc cần làm', ['s1']), col('Đang làm', ['s2'])],
      }),
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
      service.setColumns('w1', 'b1', {
        columns: [col('A', ['s1', 's2', 's3'], { id: 'cột-của-board-khác' })],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('dự án đã lưu trữ => chặn', async () => {
    const { service, prisma } = make(
      boardRow({ project: { archivedAt: new Date(), defaultWorkflowId: 'wf' } }),
    );
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
    expect(tx.boardColumn.deleteMany).toHaveBeenCalledWith({
      where: { boardId: 'b1', id: { notIn: ['c1', 'c3'] } },
    });
    const updates = tx.boardColumn.update.mock.calls as unknown as Array<
      [{ where: { id: string }; data: Record<string, unknown> }]
    >;
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
      columns: [
        col('Doing', ['s2'], { id: 'c1' }),
        col('Todo', ['s1'], { id: 'c2' }),
        col('Done', ['s3'], { id: 'c3' }),
      ],
    });
    const names = (
      tx.boardColumn.update.mock.calls as unknown as Array<[{ data: { name: string } }]>
    ).map(([a]) => a.data.name);
    const firstFinal = names.findIndex((n) => !n.startsWith('~'));
    expect(names.slice(0, firstFinal).every((n) => n.startsWith('~'))).toBe(true);
    expect(firstFinal).toBeGreaterThan(0);
  });

  it('cột mới (không id) được tạo theo đúng thứ tự mảng', async () => {
    const { service, tx } = make(boardRow({ columns: [] }));
    await service.setColumns('w1', 'b1', {
      columns: [col('Một', ['s1', 's2']), col('Hai', ['s3'], { wipLimit: 2 })],
    });
    const creates = tx.boardColumn.create.mock.calls as unknown as Array<
      [{ data: { name: string; order: number; wipLimit: number | null } }]
    >;
    expect(creates.map(([a]) => [a.data.name, a.data.order, a.data.wipLimit])).toEqual([
      ['Một', 0, null],
      ['Hai', 1, 2],
    ]);
    const links = tx.boardColumnStatus.createMany.mock.calls[0]![0].data;
    expect(links.map((l) => l.columnId)).toEqual(['new-Một', 'new-Một', 'new-Hai']);
  });
});

describe('BoardsService.setColumns — khoá board và xung đột', () => {
  it('khoá dòng Board (FOR UPDATE) là câu đầu tiên trong transaction, trước mọi ghi', async () => {
    const { service, tx } = make();
    await service.setColumns('w1', 'b1', {
      columns: [
        col('Todo', ['s1'], { id: 'c1' }),
        col('Doing', ['s2'], { id: 'c2' }),
        col('Done', ['s3'], { id: 'c3' }),
      ],
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]!).toBeLessThan(
      tx.boardColumn.deleteMany.mock.invocationCallOrder[0]!,
    );
  });

  it('FW3: khoá chạy TRƯỚC khi đọc lại cột, và chỉ khoá board chưa xoá mềm (deletedAt IS NULL)', async () => {
    const { service, tx } = make();
    await service.setColumns('w1', 'b1', {
      columns: [
        col('Todo', ['s1'], { id: 'c1' }),
        col('Doing', ['s2'], { id: 'c2' }),
        col('Done', ['s3'], { id: 'c3' }),
      ],
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]!).toBeLessThan(
      tx.boardColumn.findMany.mock.invocationCallOrder[0]!,
    );
    const strings = (tx.$queryRaw.mock.calls[0] as unknown as [readonly string[]])[0];
    const sql = strings.join('?');
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain('FOR UPDATE');
  });

  it('FW3: board bị xoá mềm giữa chừng (khoá không trả dòng nào) => 404, không đọc/ghi cột', async () => {
    const { service, tx } = make();
    tx.$queryRaw.mockResolvedValue([]);
    await expect(
      service.setColumns('w1', 'b1', {
        columns: [
          col('Todo', ['s1'], { id: 'c1' }),
          col('Doing', ['s2'], { id: 'c2' }),
          col('Done', ['s3'], { id: 'c3' }),
        ],
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(tx.boardColumn.findMany).not.toHaveBeenCalled();
    expect(tx.boardColumn.deleteMany).not.toHaveBeenCalled();
  });

  it('cột client tham chiếu đã bị người khác xoá (so với bản đọc lại sau khoá) => lỗi rõ ràng, không ghi', async () => {
    const { service, tx } = make(boardRow(), { lockedColumnIds: ['c1', 'c3'] }); // c2 đã bị xoá
    await expect(
      service.setColumns('w1', 'b1', {
        columns: [col('A', ['s1', 's2'], { id: 'c1' }), col('B', ['s3'], { id: 'c2' })],
      }),
    ).rejects.toMatchObject({ status: 422, message: has('vừa được người khác thay đổi') });
    expect(tx.boardColumn.update).not.toHaveBeenCalled();
    expect(tx.boardColumn.deleteMany).not.toHaveBeenCalled();
  });

  it('P2002 khi ghi cột => thông báo tên trùng thay vì 500', async () => {
    const { service, tx } = make();
    tx.boardColumn.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(
      service.setColumns('w1', 'b1', {
        columns: [
          col('Todo', ['s1'], { id: 'c1' }),
          col('Doing', ['s2'], { id: 'c2' }),
          col('Done', ['s3'], { id: 'c3' }),
        ],
      }),
    ).rejects.toMatchObject({ status: 422, message: has('trùng') });
  });

  it('P2025 khi ghi cột => thông báo bảng vừa thay đổi thay vì 500', async () => {
    const { service, tx } = make();
    tx.boardColumn.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('gone', { code: 'P2025', clientVersion: 'x' }),
    );
    await expect(
      service.setColumns('w1', 'b1', {
        columns: [
          col('Todo', ['s1'], { id: 'c1' }),
          col('Doing', ['s2'], { id: 'c2' }),
          col('Done', ['s3'], { id: 'c3' }),
        ],
      }),
    ).rejects.toMatchObject({ status: 422, message: has('vừa được người khác thay đổi') });
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

  it('FW12: đổi loại SCRUM -> KANBAN và KANBAN -> SCRUM => ghi type, trả BoardDto có type', async () => {
    const { service, prisma } = make(boardRow({ type: 'SCRUM' }));
    await service.update('w1', 'b1', { type: 'KANBAN' });
    expect(prisma.board.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'b1' }, data: { type: 'KANBAN' } }),
    );
    const k = make(boardRow({ type: 'KANBAN' }));
    const dto = await k.service.update('w1', 'b1', { type: 'SCRUM' });
    expect(k.prisma.board.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { type: 'SCRUM' } }),
    );
    expect(dto).toMatchObject({ id: 'b1', type: 'KANBAN' }); // DTO đọc lại từ DB, có trường type
  });

  it('FW12: không gửi type => không đụng type', async () => {
    const { service, prisma } = make();
    await service.update('w1', 'b1', { name: 'Mới' });
    expect(prisma.board.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Mới' } }),
    );
  });

  it('FW12: dự án đã lưu trữ => chặn đổi loại, không ghi', async () => {
    const { service, prisma } = make(
      boardRow({ project: { archivedAt: new Date(), defaultWorkflowId: 'wf' } }),
    );
    await expect(service.update('w1', 'b1', { type: 'KANBAN' })).rejects.toMatchObject({
      status: 422,
      message: has('lưu trữ'),
    });
    expect(prisma.board.update).not.toHaveBeenCalled();
  });

  it('filterJql hợp lệ + swimlane => lưu filter và swimlaneConfig { by }', async () => {
    const { service, prisma } = make();
    await service.update('w1', 'b1', { filterJql: 'assignee = currentUser()', swimlaneBy: 'epic' });
    expect(prisma.board.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'b1' },
        data: { filterJql: 'assignee = currentUser()', swimlaneConfig: { by: 'epic' } },
      }),
    );
  });

  it('filterJql rỗng => bỏ bộ lọc (null)', async () => {
    const { service, prisma } = make();
    await service.update('w1', 'b1', { filterJql: '   ' });
    expect(prisma.board.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { filterJql: null } }),
    );
  });
});

describe('BoardsService — dự án đã xoá mềm = board không tồn tại (I3)', () => {
  it('get/setColumns/update/listForProject tra board với project.deletedAt = null; không khớp => 404', async () => {
    const { service, prisma } = make(null, { lockedColumnIds: [] });
    await expect(service.get('w1', 'b1')).rejects.toMatchObject({ status: 404 });
    await expect(
      service.setColumns('w1', 'b1', { columns: [col('A', ['s1', 's2', 's3'])] }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.update('w1', 'b1', { name: 'x' })).rejects.toMatchObject({ status: 404 });
    for (const call of prisma.board.findFirst.mock.calls as unknown as [{ where: unknown }][])
      expect(call[0].where).toMatchObject({ project: { organizationId: 'w1', deletedAt: null } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('BoardsService.listIssues — board có filterJql sắp theo rank (Minor 5)', () => {
  it('truyền orderByRank cho SearchService; board không filterJql đi đường IssuesService.list', async () => {
    const search = { search: vi.fn(() => Promise.resolve({ data: [] })) };
    const issues = { list: vi.fn(() => Promise.resolve({ data: [] })) };
    const board = { projectId: 'p1', filterJql: 'assignee = currentUser()' };
    const prisma = { board: { findFirst: vi.fn(() => Promise.resolve(board)) } };
    const service = new BoardsService(prisma as never, issues as never, search as never);
    await service.listIssues('w1', 'u1', 'b1', undefined, 50);
    expect(search.search).toHaveBeenCalledWith(
      'w1',
      'u1',
      expect.objectContaining({ orderByRank: true, projectId: 'p1', excludeUntriaged: true }),
    );
    board.filterJql = '';
    await service.listIssues('w1', 'u1', 'b1', undefined, 50);
    expect(issues.list).toHaveBeenCalledTimes(1);
  });
});

describe('BoardsService.listForProject — thiếu projectId (rò rỉ dự án riêng tư)', () => {
  it('projectId trống ⇒ 422, KHÔNG truy vấn (nếu không Prisma liệt kê bảng của MỌI dự án, kể cả riêng tư)', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const service = new BoardsService({ board: { findMany } } as never, {} as never, {} as never);
    await expect(
      service.listForProject('w1', undefined as unknown as string),
    ).rejects.toMatchObject({ status: 422 });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('có projectId ⇒ lọc theo dự án đó', async () => {
    const findMany = vi.fn((..._a: unknown[]) => Promise.resolve([]));
    const service = new BoardsService({ board: { findMany } } as never, {} as never, {} as never);
    await service.listForProject('w1', 'p1');
    expect(findMany.mock.calls[0]![0]).toMatchObject({ where: { projectId: 'p1' } });
  });
});

describe('BoardsService.setColumns — nhiều quy trình theo loại việc', () => {
  // Task → wfStd (a1, a2); Bug → wfBug (b1, b2); quy trình mặc định cũ `wf` (s1..s3) không còn loại việc nào dùng.
  const STATUSES_MULTI = [
    ...STATUSES,
    { id: 'a1', name: 'To Do', workflowId: 'wfStd' },
    { id: 'a2', name: 'Done', workflowId: 'wfStd' },
    { id: 'b1', name: 'New', workflowId: 'wfBug' },
    { id: 'b2', name: 'Closed', workflowId: 'wfBug' },
  ];
  const multi = {
    scheme: [
      { issueTypeId: 'tTask', workflowId: 'wfStd' },
      { issueTypeId: 'tBug', workflowId: 'wfBug' },
    ],
    types: [{ id: 'tTask' }, { id: 'tBug' }],
    statuses: STATUSES_MULTI,
  };

  it('cột phải phủ trạng thái của MỌI quy trình đang dùng: thiếu trạng thái Bug => 422 nêu tên', async () => {
    const { service, prisma } = make(boardRow(), multi);
    await expect(
      service.setColumns('w1', 'b1', {
        columns: [col('Mới', ['a1', 'b1']), col('Xong', ['a2'])],
      }),
    ).rejects.toMatchObject({ status: 422, message: has('Closed') });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('một cột gom trạng thái của nhiều quy trình => ghi thành công', async () => {
    const { service, tx } = make(boardRow(), multi);
    await service.setColumns('w1', 'b1', {
      columns: [col('Mới', ['a1', 'b1']), col('Xong', ['a2', 'b2'])],
    });
    const links = tx.boardColumnStatus.createMany.mock.calls[0]![0].data;
    expect(links.map((l) => l.statusId).sort()).toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  it('trạng thái của quy trình mặc định cũ vẫn được phép nằm trong cột (không bắt buộc)', async () => {
    const { service, tx } = make(boardRow(), multi);
    await service.setColumns('w1', 'b1', {
      columns: [col('Mới', ['a1', 'b1', 's1']), col('Xong', ['a2', 'b2', 's2', 's3'])],
    });
    expect(tx.boardColumnStatus.createMany).toHaveBeenCalledTimes(1);
  });

  it('chỉ có quy trình cũ trong cột mà thiếu quy trình mới => vẫn 422 (cột cũ không đủ)', async () => {
    const { service } = make(boardRow(), multi);
    await expect(
      service.setColumns('w1', 'b1', { columns: [col('Cũ', ['s1', 's2', 's3'])] }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('không có quy trình nào (không scheme, không mặc định) => không truy vấn trạng thái với workflowId rỗng', async () => {
    const board = boardRow({ project: { archivedAt: null, defaultWorkflowId: null } });
    const { service, prisma } = make(board, { types: [{ id: 'tTask' }] });
    prisma.project.findUnique.mockResolvedValue({
      organizationId: 'w1',
      defaultWorkflowId: null,
    } as never);
    await expect(
      service.setColumns('w1', 'b1', { columns: [col('A', ['s1'])] }),
    ).rejects.toMatchObject({ status: 422 });
    expect(prisma.status.findMany).not.toHaveBeenCalled();
  });
});

describe('BoardsService.setColumns — không bỏ khỏi bảng trạng thái còn việc', () => {
  // Quy trình của dự án gồm s1..s3 (bắt buộc); `old` là trạng thái cũ còn nằm trong cột của bảng (quy trình mặc định cũ).
  const base = () => boardRow();
  const keep = [col('A', ['s1']), col('B', ['s2']), col('C', ['s3'])];

  it('bỏ trạng thái cũ còn việc (kể cả thùng rác) → 422 BOARD_STATUS_HAS_ISSUES nêu tên và số việc, không ghi gì', async () => {
    const { service, tx, prisma } = make(base(), {
      linked: [
        { statusId: 's1', name: 'Todo' },
        { statusId: 's2', name: 'Doing' },
        { statusId: 's3', name: 'Done' },
        { statusId: 'old', name: 'Đang làm (cũ)' },
      ],
      issueCounts: { old: 3 },
    });
    await expect(service.setColumns('w1', 'b1', { columns: keep })).rejects.toMatchObject({
      status: 422,
      code: 'BOARD_STATUS_HAS_ISSUES',
      details: [{ field: 'old', message: 'Đang làm (cũ): 3 việc' }],
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.boardColumnStatus.createMany).not.toHaveBeenCalled();
  });

  it('thông báo lỗi nêu cả tên trạng thái lẫn số việc', async () => {
    const { service } = make(base(), {
      linked: [
        { statusId: 's1', name: 'Todo' },
        { statusId: 's2', name: 'Doing' },
        { statusId: 's3', name: 'Done' },
        { statusId: 'old', name: 'Đang làm (cũ)' },
      ],
      issueCounts: { old: 3 },
    });
    await expect(service.setColumns('w1', 'b1', { columns: keep })).rejects.toThrow(
      /“Đang làm \(cũ\)” \(3 việc\)/,
    );
  });

  it('bỏ trạng thái cũ KHÔNG còn việc → lưu bình thường', async () => {
    const { service, tx } = make(base(), {
      linked: [
        { statusId: 's1', name: 'Todo' },
        { statusId: 's2', name: 'Doing' },
        { statusId: 's3', name: 'Done' },
        { statusId: 'old', name: 'Cũ' },
      ],
      issueCounts: {},
    });
    await service.setColumns('w1', 'b1', { columns: keep });
    expect(tx.boardColumnStatus.createMany).toHaveBeenCalledTimes(1);
  });

  it('giữ trạng thái còn việc (chỉ chuyển cột) → không bị chặn, không đếm việc', async () => {
    const { service, prisma } = make(base(), { issueCounts: { s1: 9 } });
    await service.setColumns('w1', 'b1', { columns: keep });
    // s1..s3 vẫn nằm trong cột mới → không có trạng thái nào bị bỏ → không truy vấn đếm việc.
    expect(prisma.issue.groupBy).not.toHaveBeenCalled();
  });
});
