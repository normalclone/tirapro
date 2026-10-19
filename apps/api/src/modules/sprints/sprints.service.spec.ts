import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { hasTriageVisible } from '../../common/triage-visibility.testutil';
import { SprintsService } from './sprints.service';

/** expect.stringContaining có kiểu any — bọc lại để không phát sinh cảnh báo lint. */
const has = (text: string): unknown => expect.stringContaining(text);
const anyDate: unknown = expect.any(Date);

const sprintRow = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  projectId: 'p1',
  boardId: null,
  name: 'Sprint 1',
  goal: null,
  state: 'ACTIVE',
  startDate: null,
  endDate: null,
  completeDate: null,
  sequence: 1,
  project: { archivedAt: null },
  ...over,
});

/** Payload của snapshot CLOSE đầu tiên được tạo trên tx giả. */
const closePayload = (t: {
  sprintSnapshot: { create: { mock: { calls: Array<[{ data: unknown }]> } } };
}): { carriedOver: unknown[]; movedTo: unknown } =>
  (t.sprintSnapshot.create.mock.calls[0]![0].data as { payload: never }).payload;

const dupError = () =>
  new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });

function make(tx: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const prisma = { $transaction: (fn: (t: unknown) => unknown) => fn(tx), ...tx, ...extra };
  const events = { emit: vi.fn() };
  return { service: new SprintsService(prisma as never, events as never), events, prisma };
}

describe('SprintsService.create — sequence unique', () => {
  it('trùng sequence (P2002) => tính lại và thử lại, thành công ở lần 2', async () => {
    const create = vi.fn((_args: { data: { sequence: number } }) => Promise.resolve(sprintRow()));
    create.mockRejectedValueOnce(dupError()).mockResolvedValueOnce(sprintRow({ sequence: 3 }));
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ sequence: 1 })
      .mockResolvedValueOnce({ sequence: 2 });
    const { service } = make({
      project: { findFirst: vi.fn(() => Promise.resolve({ id: 'p1' })) },
      sprint: { findFirst, create },
    });
    const dto = await service.create('w1', 'p1', { name: 'S' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![0].data.sequence).toBe(2);
    expect(create.mock.calls[1]![0].data.sequence).toBe(3);
    expect(dto.sequence).toBe(3);
  });

  it('trùng 3 lần liền => báo lỗi nghiệp vụ, không thử vô hạn', async () => {
    const create = vi.fn().mockRejectedValue(dupError());
    const { service } = make({
      project: { findFirst: vi.fn(() => Promise.resolve({ id: 'p1' })) },
      sprint: { findFirst: vi.fn(() => Promise.resolve({ sequence: 1 })), create },
    });
    await expect(service.create('w1', 'p1', { name: 'S' })).rejects.toMatchObject({ status: 422 });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('lỗi khác P2002 được ném nguyên, không thử lại', async () => {
    const create = vi.fn().mockRejectedValue(new Error('boom'));
    const { service } = make({
      project: { findFirst: vi.fn(() => Promise.resolve({ id: 'p1' })) },
      sprint: { findFirst: vi.fn(() => Promise.resolve(null)), create },
    });
    await expect(service.create('w1', 'p1', { name: 'S' })).rejects.toThrow('boom');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('SprintsService.complete / start — transaction', () => {
  function completeTx(count: number) {
    return {
      sprint: {
        findFirst: vi.fn(() => Promise.resolve(sprintRow())),
        updateMany: vi.fn(() => Promise.resolve({ count })),
        findUniqueOrThrow: vi.fn(() => Promise.resolve(sprintRow({ state: 'CLOSED' }))),
      },
      issue: {
        findMany: vi.fn((args: { select: { id?: boolean } }) =>
          Promise.resolve(args.select.id ? [{ id: 'i1' }, { id: 'i2' }] : []),
        ),
        updateMany: vi.fn(() => Promise.resolve({ count: 2 })),
      },
      issueHistory: {
        createMany: vi.fn((_args: { data: unknown[] }) => Promise.resolve({ count: 0 })),
      },
      sprintSnapshot: { create: vi.fn() },
    };
  }

  it('complete(): ghi history SPRINT cho từng issue bị đẩy ra backlog, emit sau transaction', async () => {
    const tx = completeTx(1);
    const { service, events } = make(tx);
    await service.complete('w1', 's1', 'u1');
    const rows = tx.issueHistory.createMany.mock.calls[0]![0].data as Array<
      Record<string, unknown>
    >;
    expect(rows.map((r) => r.issueId)).toEqual(['i1', 'i2']);
    expect(rows[0]).toMatchObject({
      field: 'SPRINT',
      oldValue: 's1',
      newValue: null,
      actorId: 'u1',
      projectId: 'p1',
    });
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('complete(): sprint không còn ACTIVE (thua race) => lỗi, không đụng issue, không emit', async () => {
    const tx = completeTx(0);
    const { service, events } = make(tx);
    await expect(service.complete('w1', 's1', 'u1')).rejects.toMatchObject({ status: 422 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('start(): đã có sprint ACTIVE trong project => lỗi, không chuyển trạng thái', async () => {
    const tx = {
      project: { update: vi.fn(() => Promise.resolve({ id: 'p1' })) },
      sprint: {
        findFirst: vi.fn((args: { where: { id?: string; state?: string } }) =>
          Promise.resolve(
            args.where.state === 'ACTIVE' ? { id: 'other' } : sprintRow({ state: 'FUTURE' }),
          ),
        ),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      },
    };
    const { service, events } = make(tx);
    await expect(service.start('w1', 's1')).rejects.toMatchObject({ status: 422 });
    expect(tx.project.update).toHaveBeenCalledTimes(1); // khoá project trước khi kiểm tra
    expect(tx.sprint.updateMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });
});

describe('SprintsService.start — ngày và mục tiêu trong cùng giao dịch', () => {
  const D = (d: string) => new Date(`${d}T00:00:00.000Z`);

  function startTx(sprint: Record<string, unknown> = {}) {
    const futureRow = sprintRow({ state: 'FUTURE', ...sprint });
    return {
      project: { update: vi.fn(() => Promise.resolve({ id: 'p1' })) },
      sprint: {
        findFirst: vi.fn((args: { where: { state?: string } }) =>
          Promise.resolve(args.where.state === 'ACTIVE' ? null : futureRow),
        ),
        updateMany: vi.fn((_args: { data: Record<string, unknown> }) =>
          Promise.resolve({ count: 1 }),
        ),
        findUniqueOrThrow: vi.fn(() => Promise.resolve({ ...futureRow, state: 'ACTIVE' })),
      },
    };
  }

  function makeStart(tx: ReturnType<typeof startTx>) {
    const made = make(tx);
    vi.spyOn(made.service, 'snapshot').mockResolvedValue(undefined);
    return made;
  }

  it('áp ngày bắt đầu, ngày kết thúc và mục tiêu cùng lúc chuyển ACTIVE', async () => {
    const tx = startTx();
    const { service, events } = makeStart(tx);
    await service.start('w1', 's1', {
      startDate: '2026-10-15T00:00:00.000Z',
      endDate: '2026-10-29T00:00:00.000Z',
      goal: 'G',
    });
    expect(tx.sprint.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.sprint.updateMany.mock.calls[0]![0].data).toEqual({
      state: 'ACTIVE',
      startDate: D('2026-10-15'),
      endDate: D('2026-10-29'),
      goal: 'G',
    });
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('ngày kết thúc trước ngày bắt đầu => BusinessRuleException, KHÔNG ghi sprint, KHÔNG emit', async () => {
    const tx = startTx();
    const { service, events } = makeStart(tx);
    await expect(
      service.start('w1', 's1', {
        startDate: '2026-10-29T00:00:00.000Z',
        endDate: '2026-10-15T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.sprint.updateMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('chỉ gửi endDate: so với ngày bắt đầu sẵn có của sprint', async () => {
    const tx = startTx({ startDate: D('2026-10-20') });
    const { service } = makeStart(tx);
    await expect(
      service.start('w1', 's1', { endDate: '2026-10-10T00:00:00.000Z' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.sprint.updateMany).not.toHaveBeenCalled();
  });

  it('chỉ gửi startDate muộn hơn endDate sẵn có => lỗi', async () => {
    const tx = startTx({ endDate: D('2026-10-10') });
    const { service } = makeStart(tx);
    await expect(
      service.start('w1', 's1', { startDate: '2026-10-20T00:00:00.000Z' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.sprint.updateMany).not.toHaveBeenCalled();
  });

  it('không body => hành vi cũ: giữ ngày sẵn có, thiếu thì bắt đầu hôm nay, không đụng endDate/goal', async () => {
    const tx = startTx();
    const { service } = makeStart(tx);
    await service.start('w1', 's1');
    expect(tx.sprint.updateMany.mock.calls[0]![0].data).toEqual({
      state: 'ACTIVE',
      startDate: anyDate,
    });

    const tx2 = startTx({ startDate: D('2026-10-01') });
    await makeStart(tx2).service.start('w1', 's1', {});
    expect(tx2.sprint.updateMany.mock.calls[0]![0].data).toEqual({
      state: 'ACTIVE',
      startDate: D('2026-10-01'),
    });
  });

  it('ngày kết thúc bằng ngày bắt đầu là hợp lệ (sprint một ngày)', async () => {
    const tx = startTx();
    const { service } = makeStart(tx);
    await service.start('w1', 's1', {
      startDate: '2026-10-15T00:00:00.000Z',
      endDate: '2026-10-15T00:00:00.000Z',
    });
    expect(tx.sprint.updateMany).toHaveBeenCalledTimes(1);
  });

  it('ngày hiệu lực lấy từ bản đọc SAU khi khoá, không phải bản đọc trước (PATCH xen giữa không bị ghi đè)', async () => {
    const tx = startTx({ startDate: D('2026-10-01') });
    // Lần đọc đầu (requireSprint) thấy startDate cũ; lần đọc trong transaction thấy PATCH đã dời sang 20/10.
    const stale = sprintRow({ state: 'FUTURE', startDate: D('2026-10-01') });
    const fresh = sprintRow({ state: 'FUTURE', startDate: D('2026-10-20') });
    tx.sprint.findFirst = vi
      .fn()
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(fresh)
      .mockResolvedValueOnce(null);
    const { service } = makeStart(tx);
    // endDate 10/10 hợp lệ với bản cũ nhưng trước ngày bắt đầu mới => phải bị chặn.
    await expect(
      service.start('w1', 's1', { endDate: '2026-10-10T00:00:00.000Z' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.sprint.updateMany).not.toHaveBeenCalled();

    // Không gửi ngày => giữ startDate MỚI (20/10), không ghi đè về 01/10.
    const tx2 = startTx();
    tx2.sprint.findFirst = vi
      .fn()
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(fresh)
      .mockResolvedValueOnce(null);
    await makeStart(tx2).service.start('w1', 's1', {});
    expect(tx2.sprint.updateMany.mock.calls[0]![0].data).toEqual({
      state: 'ACTIVE',
      startDate: D('2026-10-20'),
    });
  });

  it('mục tiêu được trim khi lưu', async () => {
    const tx = startTx();
    const { service } = makeStart(tx);
    await service.start('w1', 's1', { goal: '  Ra mắt beta  ' });
    expect(tx.sprint.updateMany.mock.calls[0]![0].data).toMatchObject({ goal: 'Ra mắt beta' });
  });

  it('null xoá endDate / mục tiêu; mục tiêu toàn khoảng trắng coi như xoá', async () => {
    const tx = startTx({ endDate: D('2026-10-10'), goal: 'cũ' });
    const { service } = makeStart(tx);
    await service.start('w1', 's1', { endDate: null, goal: '   ' });
    expect(tx.sprint.updateMany.mock.calls[0]![0].data).toMatchObject({
      state: 'ACTIVE',
      endDate: null,
      goal: null,
    });
  });
});

describe('SprintsService.listForProject — groupBy thay cho kéo từng issue', () => {
  it('đếm + cộng điểm bằng một groupBy, sprint trống => 0/0', async () => {
    const sprintFindMany = vi.fn(() =>
      Promise.resolve([
        sprintRow({ id: 's1', sequence: 2 }),
        sprintRow({ id: 's2', sequence: 1, state: 'FUTURE' }),
      ]),
    );
    const groupBy = vi.fn(() =>
      Promise.resolve([{ sprintId: 's1', _count: { _all: 3 }, _sum: { storyPoints: 8.5 } }]),
    );
    const { service } = make({ sprint: { findMany: sprintFindMany }, issue: { groupBy } });
    const list = await service.listForProject('w1', 'p1');
    expect(list.map((s) => [s.id, s.issueCount, s.totalPoints])).toEqual([
      ['s1', 3, 8.5],
      ['s2', 0, 0],
    ]);
    expect(groupBy).toHaveBeenCalledWith({
      by: ['sprintId'],
      // việc chưa duyệt không tính vào sprint (cùng quy tắc với Board/Việc chờ)
      where: {
        sprintId: { in: ['s1', 's2'] },
        deletedAt: null,
        OR: [{ triageState: null }, { triageState: 'ACCEPTED' }],
      },
      _count: { _all: true },
      _sum: { storyPoints: true },
    });
    // không include issues nữa
    expect(
      (sprintFindMany.mock.calls[0] as unknown as [Record<string, unknown>])[0],
    ).not.toHaveProperty('include');
  });

  it('điểm null được tính là 0; không có sprint thì không gọi groupBy', async () => {
    const groupBy = vi.fn(() =>
      Promise.resolve([{ sprintId: 's1', _count: { _all: 2 }, _sum: { storyPoints: null } }]),
    );
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([sprintRow({ id: 's1' })])
      .mockResolvedValueOnce([]);
    const { service } = make({ sprint: { findMany }, issue: { groupBy } });
    const [one] = await service.listForProject('w1', 'p1');
    expect(one).toMatchObject({ issueCount: 2, totalPoints: 0 });
    groupBy.mockClear();
    expect(await service.listForProject('w1', 'p1')).toEqual([]);
    expect(groupBy).not.toHaveBeenCalled();
  });
});

/** tx giả: sprint s1 (project p1, sequence 4 là lớn nhất), 2 issue chưa Done là i1, i2. */
function tx(over: { targetCount?: number; stateCount?: number } = {}) {
  return {
    sprint: {
      findFirst: vi.fn((args: { select?: { sequence?: boolean } }) =>
        Promise.resolve(args.select?.sequence ? { sequence: 4 } : sprintRow()),
      ),
      updateMany: vi.fn((args: { where: { id: string; state?: string } }) =>
        Promise.resolve({
          count: args.where.state === 'ACTIVE' ? (over.stateCount ?? 1) : (over.targetCount ?? 1),
        }),
      ),
      create: vi.fn((_args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 's-new', name: 'Sprint 5' }),
      ),
      findUniqueOrThrow: vi.fn(() => Promise.resolve(sprintRow({ state: 'CLOSED' }))),
    },
    issue: {
      findMany: vi.fn((args: { select: { id?: boolean } }) =>
        Promise.resolve(args.select.id ? [{ id: 'i1' }, { id: 'i2' }] : []),
      ),
      updateMany: vi.fn(
        (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
          Promise.resolve({ count: 2 }),
      ),
    },
    issueHistory: {
      createMany: vi.fn((_args: { data: Array<Record<string, unknown>> }) =>
        Promise.resolve({ count: 0 }),
      ),
    },
    sprintSnapshot: { create: vi.fn((_args: { data: { kind: string } }) => Promise.resolve({})) },
  };
}

describe('SprintsService.complete — chọn đích cho việc chưa xong', () => {
  it("'new' => tạo sprint FUTURE kế tiếp, chuyển N issue sang đó + N history, snapshot CLOSE", async () => {
    const t = tx();
    const { service, events } = make(t);
    await service.complete('w1', 's1', 'u1', { moveIncompleteTo: 'new' });
    expect(t.sprint.create.mock.calls[0]![0].data).toMatchObject({
      projectId: 'p1',
      name: 'Sprint 5',
      sequence: 5,
      state: 'FUTURE',
    });
    const upd = t.issue.updateMany.mock.calls[0]![0];
    expect(upd.data).toMatchObject({ sprintId: 's-new', version: { increment: 1 } });
    expect(upd.where).toMatchObject({ id: { in: ['i1', 'i2'] }, sprintId: 's1' });
    const rows = t.issueHistory.createMany.mock.calls[0]![0].data;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      field: 'SPRINT',
      oldValue: 's1',
      newValue: 's-new',
      actorId: 'u1',
    });
    expect(t.sprintSnapshot.create.mock.calls[0]![0].data.kind).toBe('CLOSE');
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it("'backlog' (mặc định) => sprintId = null, history newValue null, không tạo sprint", async () => {
    const t = tx();
    const { service } = make(t);
    await service.complete('w1', 's1', 'u1');
    expect(t.sprint.create).not.toHaveBeenCalled();
    expect(t.issue.updateMany.mock.calls[0]![0].data).toMatchObject({ sprintId: null });
    expect(t.issueHistory.createMany.mock.calls[0]![0].data[0]).toMatchObject({ newValue: null });
  });

  it('{ sprintId } => khoá + kiểm sprint đích còn FUTURE rồi chuyển issue sang đó', async () => {
    const t = tx();
    const { service } = make(t);
    await service.complete('w1', 's1', 'u1', { moveIncompleteTo: { sprintId: 's2' } });
    const lock = t.sprint.updateMany.mock.calls.find(
      ([a]) => a.where.id === 's2',
    )![0] as unknown as { where: Record<string, unknown> };
    expect(lock.where).toMatchObject({
      id: 's2',
      projectId: 'p1',
      state: 'FUTURE',
      deletedAt: null,
    });
    expect(t.issue.updateMany.mock.calls[0]![0].data).toMatchObject({ sprintId: 's2' });
  });

  it('{ sprintId } không còn FUTURE/khác project/đã xoá => lỗi, transaction dừng trước khi đụng issue', async () => {
    const t = tx({ targetCount: 0 });
    const { service, events } = make(t);
    await expect(
      service.complete('w1', 's1', 'u1', { moveIncompleteTo: { sprintId: 's2' } }),
    ).rejects.toMatchObject({ status: 422 });
    expect(t.issue.updateMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('sprint đích trùng chính sprint đang đóng => lỗi', async () => {
    const t = tx();
    const { service } = make(t);
    await expect(
      service.complete('w1', 's1', 'u1', { moveIncompleteTo: { sprintId: 's1' } }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('dự án đã lưu trữ => không complete được', async () => {
    const t = tx();
    t.sprint.findFirst = vi.fn(() =>
      Promise.resolve(sprintRow({ project: { archivedAt: new Date() } })),
    );
    const { service } = make(t);
    await expect(service.complete('w1', 's1', 'u1')).rejects.toMatchObject({
      status: 422,
      message: has('lưu trữ'),
    });
    expect(t.sprint.updateMany).not.toHaveBeenCalled();
  });
});

describe('SprintsService.complete — payload của snapshot CLOSE', () => {
  it("snapshot CLOSE ghi payload: việc chưa xong bị chuyển tiếp + nơi chuyển ('new'), chụp TRƯỚC khi di chuyển issue", async () => {
    const t = tx();
    t.issue.findMany.mockImplementation((args: { select: { id?: boolean } }) =>
      Promise.resolve(
        args.select.id
          ? [
              { id: 'i1', key: 'DEMO-TASK-1', summary: 'Một', storyPoints: 3 },
              { id: 'i2', key: 'DEMO-TASK-2', summary: 'Hai', storyPoints: null },
            ]
          : [],
      ),
    );
    const order: string[] = [];
    t.sprintSnapshot.create.mockImplementation((_a: unknown) => {
      order.push('snapshot');
      return Promise.resolve({});
    });
    t.issue.updateMany.mockImplementation((_a: unknown) => {
      order.push('move');
      return Promise.resolve({ count: 2 });
    });
    const { service } = make(t);
    await service.complete('w1', 's1', 'u1', { moveIncompleteTo: 'new' });
    expect(t.sprintSnapshot.create.mock.calls[0]![0].data.kind).toBe('CLOSE');
    expect(closePayload(t)).toEqual({
      carriedOver: [
        { id: 'i1', key: 'DEMO-TASK-1', summary: 'Một', storyPoints: 3 },
        { id: 'i2', key: 'DEMO-TASK-2', summary: 'Hai', storyPoints: null },
      ],
      movedTo: { kind: 'new', sprintId: 's-new', sprintName: 'Sprint 5' },
    });
    expect(order).toEqual(['snapshot', 'move']);
  });

  it("payload movedTo: 'backlog' không kèm sprint; { sprintId } kèm tên sprint đích", async () => {
    const t1 = tx();
    await make(t1).service.complete('w1', 's1', 'u1');
    expect(closePayload(t1).movedTo).toEqual({ kind: 'backlog' });

    const t2 = tx();
    await make(t2).service.complete('w1', 's1', 'u1', { moveIncompleteTo: { sprintId: 's9' } });
    expect(closePayload(t2).movedTo).toEqual({
      kind: 'sprint',
      sprintId: 's9',
      sprintName: 'Sprint 1', // tên do mock findFirst trả (sprintRow)
    });
  });
});

describe('SprintsService — việc chưa duyệt không tính vào snapshot/payload sprint', () => {
  it('snapshot(): where issue lọc TRIAGE_VISIBLE (cam kết/hoàn thành/velocity không lẫn việc chưa duyệt)', async () => {
    const t = tx();
    const { service } = make(t);
    await service.snapshot(t as never, 's1', 'DAILY');
    const arg = t.issue.findMany.mock.calls[0]![0] as unknown as { where: unknown };
    expect(hasTriageVisible(arg.where)).toBe(true);
  });

  it('complete(): việc chưa duyệt vẫn được đưa ra khỏi sprint nhưng KHÔNG liệt vào carriedOver của payload', async () => {
    const t = tx();
    t.issue.findMany.mockImplementation((args: { select: { id?: boolean } }) =>
      Promise.resolve(
        args.select.id
          ? [
              { id: 'i1', key: 'D-1', summary: 'Một', storyPoints: 3, triageState: null },
              { id: 'i2', key: 'D-2', summary: 'Hai', storyPoints: 1, triageState: 'PENDING' },
              { id: 'i3', key: 'D-3', summary: 'Ba', storyPoints: 2, triageState: 'ACCEPTED' },
            ]
          : [],
      ),
    );
    const { service } = make(t);
    await service.complete('w1', 's1', 'u1');
    expect((closePayload(t).carriedOver as { key: string }[]).map((c) => c.key)).toEqual([
      'D-1',
      'D-3',
    ]);
    // cả ba vẫn bị chuyển ra khỏi sprint (không bỏ sót việc trong sprint đã đóng)
    const moved = t.issue.updateMany.mock.calls[0]![0] as unknown as {
      where: { id: { in: string[] } };
    };
    expect(moved.where.id.in).toEqual(['i1', 'i2', 'i3']);
  });
});

describe('SprintsService.remove / update', () => {
  it('remove(): sprint ACTIVE => lỗi, không xoá', async () => {
    const t = {
      sprint: {
        findFirst: vi.fn(() => Promise.resolve(sprintRow({ state: 'ACTIVE' }))),
        updateMany: vi.fn(),
      },
    };
    const { service } = make(t);
    await expect(service.remove('w1', 's1', 'u1')).rejects.toMatchObject({ status: 422 });
    expect(t.sprint.updateMany).not.toHaveBeenCalled();
  });

  it('remove(): sprint FUTURE => xoá mềm + đưa issue về backlog + history SPRINT trong cùng transaction', async () => {
    const t = {
      sprint: {
        findFirst: vi.fn(() => Promise.resolve(sprintRow({ state: 'FUTURE' }))),
        updateMany: vi.fn(
          (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
            Promise.resolve({ count: 1 }),
        ),
      },
      issue: {
        findMany: vi.fn(() => Promise.resolve([{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }])),
        updateMany: vi.fn((_args: { data: Record<string, unknown> }) =>
          Promise.resolve({ count: 3 }),
        ),
      },
      issueHistory: {
        createMany: vi.fn((_args: { data: Array<Record<string, unknown>> }) =>
          Promise.resolve({ count: 3 }),
        ),
      },
    };
    const { service, prisma } = make(t);
    const spy = vi.spyOn(prisma, '$transaction');
    await expect(service.remove('w1', 's1', 'u1')).resolves.toEqual({ success: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(t.sprint.updateMany.mock.calls[0]![0]).toMatchObject({
      where: { id: 's1', state: 'FUTURE', deletedAt: null },
      data: { deletedAt: anyDate },
    });
    expect(t.issue.updateMany.mock.calls[0]![0].data).toMatchObject({
      sprintId: null,
      version: { increment: 1 },
    });
    const rows = t.issueHistory.createMany.mock.calls[0]![0].data;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      field: 'SPRINT',
      oldValue: 's1',
      newValue: null,
      actorId: 'u1',
    });
  });

  it('remove(): thua race (sprint vừa được start) => lỗi, không đụng issue', async () => {
    const t = {
      sprint: {
        findFirst: vi.fn(() => Promise.resolve(sprintRow({ state: 'FUTURE' }))),
        updateMany: vi.fn(() => Promise.resolve({ count: 0 })),
      },
      issue: { findMany: vi.fn(), updateMany: vi.fn() },
      issueHistory: { createMany: vi.fn() },
    };
    const { service } = make(t);
    await expect(service.remove('w1', 's1', 'u1')).rejects.toMatchObject({ status: 422 });
    expect(t.issue.updateMany).not.toHaveBeenCalled();
  });

  it('update(): sprint ACTIVE chỉ sửa được mục tiêu + ngày kết thúc', async () => {
    const t = {
      sprint: {
        findFirst: vi.fn(() =>
          Promise.resolve(
            sprintRow({ state: 'ACTIVE', startDate: new Date('2026-10-01T00:00:00Z') }),
          ),
        ),
        updateMany: vi.fn((_args: { data: Record<string, unknown> }) =>
          Promise.resolve({ count: 1 }),
        ),
        findUniqueOrThrow: vi.fn(() => Promise.resolve(sprintRow())),
      },
    };
    const { service } = make(t);
    await expect(service.update('w1', 's1', { name: 'Tên mới' })).rejects.toMatchObject({
      status: 422,
    });
    await expect(
      service.update('w1', 's1', { startDate: '2026-10-02T00:00:00.000Z' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(t.sprint.updateMany).not.toHaveBeenCalled();
    await service.update('w1', 's1', { goal: 'Mục tiêu', endDate: '2026-10-20T00:00:00.000Z' });
    expect(t.sprint.updateMany.mock.calls[0]![0].data).toMatchObject({
      goal: 'Mục tiêu',
      endDate: new Date('2026-10-20T00:00:00.000Z'),
    });
  });

  it('update(): ngày kết thúc trước ngày bắt đầu => lỗi; sprint CLOSED không sửa được', async () => {
    const t = {
      sprint: {
        findFirst: vi.fn(() =>
          Promise.resolve(
            sprintRow({ state: 'FUTURE', startDate: new Date('2026-10-10T00:00:00Z') }),
          ),
        ),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
        findUniqueOrThrow: vi.fn(() => Promise.resolve(sprintRow())),
      },
    };
    const { service } = make(t);
    await expect(
      service.update('w1', 's1', { endDate: '2026-10-05T00:00:00.000Z' }),
    ).rejects.toMatchObject({ status: 422 });
    t.sprint.findFirst = vi.fn(() => Promise.resolve(sprintRow({ state: 'CLOSED' })));
    await expect(service.update('w1', 's1', { goal: 'x' })).rejects.toMatchObject({ status: 422 });
  });
});

describe('SprintsService — dự án đã xoá mềm = sprint không tồn tại (I3)', () => {
  it('start/complete/update/remove tra sprint với project.deletedAt = null; không khớp => 404, không ghi', async () => {
    const tx = {
      sprint: {
        findFirst: vi.fn((_args: { where: unknown }) => Promise.resolve(null)),
        updateMany: vi.fn(),
      },
      issue: { updateMany: vi.fn() },
    };
    const { service } = make(tx);
    await expect(service.start('w1', 's1')).rejects.toMatchObject({ status: 404 });
    await expect(
      service.complete('w1', 's1', 'u1', { moveIncompleteTo: 'backlog' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.update('w1', 's1', { goal: 'x' })).rejects.toMatchObject({ status: 404 });
    await expect(service.remove('w1', 's1', 'u1')).rejects.toMatchObject({ status: 404 });
    for (const call of tx.sprint.findFirst.mock.calls)
      expect(call[0].where).toMatchObject({ project: { workspaceId: 'w1', deletedAt: null } });
    expect(tx.sprint.updateMany).not.toHaveBeenCalled();
  });
});

describe('SprintsService.listForProject — thiếu projectId (rò rỉ dự án riêng tư)', () => {
  it('projectId trống ⇒ 422, KHÔNG truy vấn (Prisma bỏ qua điều kiện undefined và trả sprint của MỌI dự án)', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const { service } = make({ sprint: { findMany }, issue: { groupBy: vi.fn() } });
    await expect(
      service.listForProject('w1', undefined as unknown as string),
    ).rejects.toMatchObject({
      status: 422,
    });
    await expect(service.listForProject('w1', '')).rejects.toMatchObject({ status: 422 });
    expect(findMany).not.toHaveBeenCalled();
  });
});
