import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { SprintsService } from './sprints.service';

const sprintRow = (over: Record<string, unknown> = {}) => ({
  id: 's1', projectId: 'p1', boardId: null, name: 'Sprint 1', goal: null, state: 'ACTIVE',
  startDate: null, endDate: null, completeDate: null, sequence: 1, ...over,
});

const dupError = () => new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });

function make(tx: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const prisma = { $transaction: (fn: (t: unknown) => unknown) => fn(tx), ...tx, ...extra };
  const events = { emit: vi.fn() };
  return { service: new SprintsService(prisma as never, events as never), events, prisma };
}

describe('SprintsService.create — sequence unique', () => {
  it('trùng sequence (P2002) => tính lại và thử lại, thành công ở lần 2', async () => {
    const create = vi.fn().mockRejectedValueOnce(dupError()).mockResolvedValueOnce(sprintRow({ sequence: 3 }));
    const findFirst = vi.fn().mockResolvedValueOnce({ sequence: 1 }).mockResolvedValueOnce({ sequence: 2 });
    const { service } = make({
      project: { findFirst: vi.fn(async () => ({ id: 'p1' })) },
      sprint: { findFirst, create },
    });
    const dto = await service.create('w1', 'p1', { name: 'S' } as never);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![0].data.sequence).toBe(2);
    expect(create.mock.calls[1]![0].data.sequence).toBe(3);
    expect(dto.sequence).toBe(3);
  });

  it('trùng 3 lần liền => báo lỗi nghiệp vụ, không thử vô hạn', async () => {
    const create = vi.fn().mockRejectedValue(dupError());
    const { service } = make({
      project: { findFirst: vi.fn(async () => ({ id: 'p1' })) },
      sprint: { findFirst: vi.fn(async () => ({ sequence: 1 })), create },
    });
    await expect(service.create('w1', 'p1', { name: 'S' } as never)).rejects.toMatchObject({ status: 422 });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('lỗi khác P2002 được ném nguyên, không thử lại', async () => {
    const create = vi.fn().mockRejectedValue(new Error('boom'));
    const { service } = make({
      project: { findFirst: vi.fn(async () => ({ id: 'p1' })) },
      sprint: { findFirst: vi.fn(async () => null), create },
    });
    await expect(service.create('w1', 'p1', { name: 'S' } as never)).rejects.toThrow('boom');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('SprintsService.complete / start — transaction', () => {
  function completeTx(count: number) {
    return {
      sprint: {
        findFirst: vi.fn(async () => sprintRow()),
        updateMany: vi.fn(async () => ({ count })),
        findUniqueOrThrow: vi.fn(async () => sprintRow({ state: 'CLOSED' })),
      },
      issue: {
        findMany: vi.fn(async (args: { select: { id?: boolean } }) =>
          args.select.id ? [{ id: 'i1' }, { id: 'i2' }] : []),
        updateMany: vi.fn(async () => ({ count: 2 })),
      },
      issueHistory: { createMany: vi.fn() },
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
      project: { update: vi.fn(async () => ({ id: 'p1' })) },
      sprint: {
        findFirst: vi.fn(async (args: { where: { id?: string; state?: string } }) =>
          args.where.state === 'ACTIVE' ? { id: 'other' } : sprintRow({ state: 'FUTURE' })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const { service, events } = make(tx);
    await expect(service.start('w1', 's1')).rejects.toMatchObject({ status: 422 });
    expect(tx.project.update).toHaveBeenCalledTimes(1); // khoá project trước khi kiểm tra
    expect(tx.sprint.updateMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });
});
