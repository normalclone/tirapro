import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { SprintsService } from './sprints.service';

const sprintRow = (over: Record<string, unknown> = {}) => ({
  id: 's1', projectId: 'p1', boardId: null, name: 'Sprint 1', goal: null, state: 'ACTIVE',
  startDate: null, endDate: null, completeDate: null, sequence: 1,
  project: { archivedAt: null }, ...over,
});

const dupError = () => new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });

function make(tx: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const prisma = { $transaction: (fn: (t: unknown) => unknown) => fn(tx), ...tx, ...extra };
  const events = { emit: vi.fn() };
  return { service: new SprintsService(prisma as never, events as never), events, prisma };
}

describe('SprintsService.create — sequence unique', () => {
  it('trùng sequence (P2002) => tính lại và thử lại, thành công ở lần 2', async () => {
    const create = vi.fn((_args: { data: { sequence: number } }) => Promise.resolve(sprintRow()));
    create.mockRejectedValueOnce(dupError()).mockResolvedValueOnce(sprintRow({ sequence: 3 }));
    const findFirst = vi.fn().mockResolvedValueOnce({ sequence: 1 }).mockResolvedValueOnce({ sequence: 2 });
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
          Promise.resolve(args.select.id ? [{ id: 'i1' }, { id: 'i2' }] : [])),
        updateMany: vi.fn(() => Promise.resolve({ count: 2 })),
      },
      issueHistory: { createMany: vi.fn((_args: { data: unknown[] }) => Promise.resolve({ count: 0 })) },
      sprintSnapshot: { create: vi.fn() },
    };
  }

  it('complete(): ghi history SPRINT cho từng issue bị đẩy ra backlog, emit sau transaction', async () => {
    const tx = completeTx(1);
    const { service, events } = make(tx);
    await service.complete('w1', 's1', 'u1');
    const rows = tx.issueHistory.createMany.mock.calls[0]![0].data as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.issueId)).toEqual(['i1', 'i2']);
    expect(rows[0]).toMatchObject({ field: 'SPRINT', oldValue: 's1', newValue: null, actorId: 'u1', projectId: 'p1' });
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
          Promise.resolve(args.where.state === 'ACTIVE' ? { id: 'other' } : sprintRow({ state: 'FUTURE' }))),
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

describe('SprintsService.listForProject — groupBy thay cho kéo từng issue', () => {
  it('đếm + cộng điểm bằng một groupBy, sprint trống => 0/0', async () => {
    const sprintFindMany = vi.fn(() => Promise.resolve([
      sprintRow({ id: 's1', sequence: 2 }),
      sprintRow({ id: 's2', sequence: 1, state: 'FUTURE' }),
    ]));
    const groupBy = vi.fn(() => Promise.resolve([{ sprintId: 's1', _count: { _all: 3 }, _sum: { storyPoints: 8.5 } }]));
    const { service } = make({ sprint: { findMany: sprintFindMany }, issue: { groupBy } });
    const list = await service.listForProject('w1', 'p1');
    expect(list.map((s) => [s.id, s.issueCount, s.totalPoints])).toEqual([['s1', 3, 8.5], ['s2', 0, 0]]);
    expect(groupBy).toHaveBeenCalledWith({
      by: ['sprintId'],
      where: { sprintId: { in: ['s1', 's2'] }, deletedAt: null },
      _count: { _all: true },
      _sum: { storyPoints: true },
    });
    // không include issues nữa
    expect((sprintFindMany.mock.calls[0] as unknown as [Record<string, unknown>])[0]).not.toHaveProperty('include');
  });

  it('điểm null được tính là 0; không có sprint thì không gọi groupBy', async () => {
    const groupBy = vi.fn(() => Promise.resolve([{ sprintId: 's1', _count: { _all: 2 }, _sum: { storyPoints: null } }]));
    const findMany = vi.fn().mockResolvedValueOnce([sprintRow({ id: 's1' })]).mockResolvedValueOnce([]);
    const { service } = make({ sprint: { findMany }, issue: { groupBy } });
    const [one] = await service.listForProject('w1', 'p1');
    expect(one).toMatchObject({ issueCount: 2, totalPoints: 0 });
    groupBy.mockClear();
    expect(await service.listForProject('w1', 'p1')).toEqual([]);
    expect(groupBy).not.toHaveBeenCalled();
  });
});

describe('SprintsService.complete — chọn đích cho việc chưa xong', () => {
  /** tx giả: sprint s1 (project p1, sequence 4 là lớn nhất), 2 issue chưa Done là i1, i2. */
  function tx(over: { targetCount?: number; stateCount?: number } = {}) {
    return {
      sprint: {
        findFirst: vi.fn((args: { select?: { sequence?: boolean } }) =>
          Promise.resolve(args.select?.sequence ? { sequence: 4 } : sprintRow())),
        updateMany: vi.fn((args: { where: { id: string; state?: string } }) =>
          Promise.resolve({ count: args.where.state === 'ACTIVE' ? (over.stateCount ?? 1) : (over.targetCount ?? 1) })),
        create: vi.fn((_args: { data: Record<string, unknown> }) => Promise.resolve({ id: 's-new' })),
        findUniqueOrThrow: vi.fn(() => Promise.resolve(sprintRow({ state: 'CLOSED' }))),
      },
      issue: {
        findMany: vi.fn((args: { select: { id?: boolean } }) =>
          Promise.resolve(args.select.id ? [{ id: 'i1' }, { id: 'i2' }] : [])),
        updateMany: vi.fn((_args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise.resolve({ count: 2 })),
      },
      issueHistory: { createMany: vi.fn((_args: { data: Array<Record<string, unknown>> }) => Promise.resolve({ count: 0 })) },
      sprintSnapshot: { create: vi.fn((_args: { data: { kind: string } }) => Promise.resolve({})) },
    };
  }

  it("'new' => tạo sprint FUTURE kế tiếp, chuyển N issue sang đó + N history, snapshot CLOSE", async () => {
    const t = tx();
    const { service, events } = make(t);
    await service.complete('w1', 's1', 'u1', { moveIncompleteTo: 'new' });
    expect(t.sprint.create.mock.calls[0]![0].data).toMatchObject({ projectId: 'p1', name: 'Sprint 5', sequence: 5, state: 'FUTURE' });
    const upd = t.issue.updateMany.mock.calls[0]![0];
    expect(upd.data).toMatchObject({ sprintId: 's-new', version: { increment: 1 } });
    expect(upd.where).toMatchObject({ id: { in: ['i1', 'i2'] }, sprintId: 's1' });
    const rows = t.issueHistory.createMany.mock.calls[0]![0].data;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ field: 'SPRINT', oldValue: 's1', newValue: 's-new', actorId: 'u1' });
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
    const lock = t.sprint.updateMany.mock.calls.find(([a]) => a.where.id === 's2')![0] as unknown as { where: Record<string, unknown> };
    expect(lock.where).toMatchObject({ id: 's2', projectId: 'p1', state: 'FUTURE', deletedAt: null });
    expect(t.issue.updateMany.mock.calls[0]![0].data).toMatchObject({ sprintId: 's2' });
  });

  it('{ sprintId } không còn FUTURE/khác project/đã xoá => lỗi, transaction dừng trước khi đụng issue', async () => {
    const t = tx({ targetCount: 0 });
    const { service, events } = make(t);
    await expect(service.complete('w1', 's1', 'u1', { moveIncompleteTo: { sprintId: 's2' } })).rejects.toMatchObject({ status: 422 });
    expect(t.issue.updateMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('sprint đích trùng chính sprint đang đóng => lỗi', async () => {
    const t = tx();
    const { service } = make(t);
    await expect(service.complete('w1', 's1', 'u1', { moveIncompleteTo: { sprintId: 's1' } })).rejects.toMatchObject({ status: 422 });
  });

  it('dự án đã lưu trữ => không complete được', async () => {
    const t = tx();
    t.sprint.findFirst = vi.fn(() => Promise.resolve(sprintRow({ project: { archivedAt: new Date() } })));
    const { service } = make(t);
    await expect(service.complete('w1', 's1', 'u1')).rejects.toMatchObject({ status: 422, message: expect.stringContaining('lưu trữ') });
    expect(t.sprint.updateMany).not.toHaveBeenCalled();
  });
});

describe('SprintsService.remove / update', () => {
  it('remove(): sprint ACTIVE => lỗi, không xoá', async () => {
    const t = { sprint: { findFirst: vi.fn(() => Promise.resolve(sprintRow({ state: 'ACTIVE' }))), updateMany: vi.fn() } };
    const { service } = make(t);
    await expect(service.remove('w1', 's1', 'u1')).rejects.toMatchObject({ status: 422 });
    expect(t.sprint.updateMany).not.toHaveBeenCalled();
  });

  it('remove(): sprint FUTURE => xoá mềm + đưa issue về backlog + history SPRINT trong cùng transaction', async () => {
    const t = {
      sprint: {
        findFirst: vi.fn(() => Promise.resolve(sprintRow({ state: 'FUTURE' }))),
        updateMany: vi.fn((_args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise.resolve({ count: 1 })),
      },
      issue: {
        findMany: vi.fn(() => Promise.resolve([{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }])),
        updateMany: vi.fn((_args: { data: Record<string, unknown> }) => Promise.resolve({ count: 3 })),
      },
      issueHistory: { createMany: vi.fn((_args: { data: Array<Record<string, unknown>> }) => Promise.resolve({ count: 3 })) },
    };
    const { service, prisma } = make(t);
    const spy = vi.spyOn(prisma, '$transaction');
    await expect(service.remove('w1', 's1', 'u1')).resolves.toEqual({ success: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(t.sprint.updateMany.mock.calls[0]![0]).toMatchObject({ where: { id: 's1', state: 'FUTURE', deletedAt: null }, data: { deletedAt: expect.any(Date) } });
    expect(t.issue.updateMany.mock.calls[0]![0].data).toMatchObject({ sprintId: null, version: { increment: 1 } });
    const rows = t.issueHistory.createMany.mock.calls[0]![0].data;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ field: 'SPRINT', oldValue: 's1', newValue: null, actorId: 'u1' });
  });

  it('remove(): thua race (sprint vừa được start) => lỗi, không đụng issue', async () => {
    const t = {
      sprint: { findFirst: vi.fn(() => Promise.resolve(sprintRow({ state: 'FUTURE' }))), updateMany: vi.fn(() => Promise.resolve({ count: 0 })) },
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
        findFirst: vi.fn(() => Promise.resolve(sprintRow({ state: 'ACTIVE', startDate: new Date('2026-10-01T00:00:00Z') }))),
        updateMany: vi.fn((_args: { data: Record<string, unknown> }) => Promise.resolve({ count: 1 })),
        findUniqueOrThrow: vi.fn(() => Promise.resolve(sprintRow())),
      },
    };
    const { service } = make(t);
    await expect(service.update('w1', 's1', { name: 'Tên mới' })).rejects.toMatchObject({ status: 422 });
    await expect(service.update('w1', 's1', { startDate: '2026-10-02T00:00:00.000Z' })).rejects.toMatchObject({ status: 422 });
    expect(t.sprint.updateMany).not.toHaveBeenCalled();
    await service.update('w1', 's1', { goal: 'Mục tiêu', endDate: '2026-10-20T00:00:00.000Z' });
    expect(t.sprint.updateMany.mock.calls[0]![0].data).toMatchObject({ goal: 'Mục tiêu', endDate: new Date('2026-10-20T00:00:00.000Z') });
  });

  it('update(): ngày kết thúc trước ngày bắt đầu => lỗi; sprint CLOSED không sửa được', async () => {
    const t = {
      sprint: {
        findFirst: vi.fn(() => Promise.resolve(sprintRow({ state: 'FUTURE', startDate: new Date('2026-10-10T00:00:00Z') }))),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
        findUniqueOrThrow: vi.fn(() => Promise.resolve(sprintRow())),
      },
    };
    const { service } = make(t);
    await expect(service.update('w1', 's1', { endDate: '2026-10-05T00:00:00.000Z' })).rejects.toMatchObject({ status: 422 });
    t.sprint.findFirst = vi.fn(() => Promise.resolve(sprintRow({ state: 'CLOSED' })));
    await expect(service.update('w1', 's1', { goal: 'x' })).rejects.toMatchObject({ status: 422 });
  });
});
