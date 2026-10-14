import { describe, expect, it, vi } from 'vitest';
import { WorklogsService } from './worklogs.service';

const t0 = new Date('2026-10-15T08:00:00Z');

interface IssueState {
  originalEstimate: number | null;
  remainingEstimate: number | null;
  timeSpent: number | null;
}

/** Prisma giả giữ trạng thái: issue + danh sách worklog; mọi thao tác đi qua `$transaction: fn => fn(tx)`. */
function setup(initial: Partial<IssueState> = {}, opts: { logs?: Array<{ id: string; authorId: string; timeSpent: number }>; perms?: string[]; isSystemAdmin?: boolean } = {}) {
  const issue: IssueState & { projectId: string; sprintId: string | null; key: string } = {
    originalEstimate: 28800, remainingEstimate: 28800, timeSpent: null,
    projectId: 'p1', sprintId: null, key: 'P-TASK-1', ...initial,
  };
  const logs = [...(opts.logs ?? [])].map((l) => ({ ...l, issueId: 'i1', startedAt: t0, comment: null, createdAt: t0, updatedAt: t0, author: { id: l.authorId, displayName: 'A', avatarUrl: null } }));
  const history: unknown[] = [];
  const tx = {
    issue: {
      updateMany: vi.fn((_args: unknown) => Promise.resolve({ count: 1 })),
      findFirst: vi.fn(() => Promise.resolve({ ...issue })),
      update: vi.fn(({ data }: { data: Partial<IssueState> }) => { Object.assign(issue, data); return Promise.resolve({}); }),
    },
    workLog: {
      create: vi.fn(({ data }: { data: { timeSpent: number; authorId: string } }) => {
        const row = { id: `w${logs.length + 1}`, issueId: 'i1', startedAt: t0, comment: null, createdAt: t0, updatedAt: t0, author: { id: data.authorId, displayName: 'A', avatarUrl: null }, ...data };
        logs.push(row);
        return Promise.resolve(row);
      }),
      findFirst: vi.fn(({ where }: { where: { id: string } }) => {
        const l = logs.find((x) => x.id === where.id);
        return Promise.resolve(l ? { ...l, issue: { id: 'i1', projectId: 'p1', key: 'P-TASK-1' } } : null);
      }),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const l = logs.find((x) => x.id === where.id)!;
        Object.assign(l, data);
        return Promise.resolve(l);
      }),
      delete: vi.fn(({ where }: { where: { id: string } }) => {
        logs.splice(logs.findIndex((x) => x.id === where.id), 1);
        return Promise.resolve({});
      }),
      aggregate: vi.fn(() => Promise.resolve({ _sum: { timeSpent: logs.reduce((s, l) => s + l.timeSpent, 0) } })),
    },
    issueHistory: { create: vi.fn((a: unknown) => { history.push(a); return Promise.resolve({}); }) },
  };
  const prisma = {
    $transaction: (fn: (t: unknown) => unknown) => fn(tx),
    user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: opts.isSystemAdmin ?? false })) },
    ...tx,
  };
  const events = { emit: vi.fn() };
  const rbac = { getEffectivePermissions: vi.fn(() => Promise.resolve(new Set(opts.perms ?? []))) };
  const issues = { getByKey: vi.fn(() => Promise.resolve({ id: 'i1', key: 'P-TASK-1' })) };
  const service = new WorklogsService(prisma as never, events as never, rbac as never, issues as never);
  return { service, tx, issue, logs, history, events, rbac };
}

describe('WorklogsService.create', () => {
  it('cộng dồn timeSpent và tự trừ remainingEstimate (auto = original − spent)', async () => {
    const { service, issue, tx } = setup({}, { logs: [{ id: 'w0', authorId: 'u9', timeSpent: 3600 }] });
    const dto = await service.create('w1', 'u1', 'i1', { timeSpent: '2h 30m' });

    expect(dto.timeSpentSec).toBe(9000);
    expect(issue.timeSpent).toBe(3600 + 9000);
    expect(issue.remainingEstimate).toBe(28800 - 12600);
    // khoá hàng issue (tăng version) TRƯỚC khi ghi để hai worklog đồng thời không cộng sai
    const lockOrder = tx.issue.updateMany.mock.invocationCallOrder[0] as number;
    expect(lockOrder).toBeLessThan(tx.workLog.create.mock.invocationCallOrder[0] as number);
    expect(tx.issue.updateMany.mock.calls[0]![0]).toMatchObject({ data: { version: { increment: 1 } } });
  });

  it('remainingEstimate không âm khi làm quá ước lượng', async () => {
    const { service, issue } = setup({ originalEstimate: 3600, remainingEstimate: 3600 });
    await service.create('w1', 'u1', 'i1', { timeSpent: '2h' });
    expect(issue.remainingEstimate).toBe(0);
  });

  it('adjustRemaining: leave giữ nguyên, { set } đặt đúng giá trị', async () => {
    const a = setup({ remainingEstimate: 5000 });
    await a.service.create('w1', 'u1', 'i1', { timeSpent: '1h', adjustRemaining: 'leave' });
    expect(a.issue.remainingEstimate).toBe(5000);

    const b = setup();
    await b.service.create('w1', 'u1', 'i1', { timeSpent: '1h', adjustRemaining: { set: '90m' } });
    expect(b.issue.remainingEstimate).toBe(5400);
  });

  it('không có ước lượng gốc thì auto giữ nguyên remaining', async () => {
    const { service, issue } = setup({ originalEstimate: null, remainingEstimate: null });
    await service.create('w1', 'u1', 'i1', { timeSpent: '1h' });
    expect(issue.remainingEstimate).toBeNull();
    expect(issue.timeSpent).toBe(3600);
  });

  it('ghi IssueHistory TIME_SPENT và phát ISSUE_UPDATED + WORKLOG_CREATED sau commit', async () => {
    const { service, history, events } = setup();
    await service.create('w1', 'u1', 'i1', { timeSpent: '2h 30m' });
    expect(history[0]).toMatchObject({ data: { field: 'TIME_SPENT', oldValue: '0m', newValue: '2h 30m', actorId: 'u1', issueId: 'i1', projectId: 'p1' } });
    expect(events.emit).toHaveBeenCalledWith('issue.updated', expect.objectContaining({ actorId: 'u1', changedFields: ['timeSpent', 'remainingEstimate'] }));
    expect(events.emit).toHaveBeenCalledWith('worklog.created', expect.objectContaining({ issueId: 'i1' }));
  });

  it('chuỗi thời gian sai => lỗi nghiệp vụ, không ghi gì', async () => {
    const { service, tx } = setup();
    await expect(service.create('w1', 'u1', 'i1', { timeSpent: 'abc' })).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    expect(tx.workLog.create).not.toHaveBeenCalled();
  });

  it('issue không còn (đã xoá mềm) => NotFound', async () => {
    const { service, tx } = setup();
    tx.issue.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.create('w1', 'u1', 'i1', { timeSpent: '1h' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('WorklogsService.update/remove — chỉ tác giả hoặc quản trị', () => {
  it('người khác (không phải admin) sửa => 403', async () => {
    const { service } = setup({ timeSpent: 3600 }, { logs: [{ id: 'w0', authorId: 'u9', timeSpent: 3600 }], perms: ['issue:edit'] });
    await expect(service.update('w1', 'u1', 'w0', { timeSpent: '2h' })).rejects.toMatchObject({ status: 403 });
    await expect(service.remove('w1', 'u1', 'w0')).rejects.toMatchObject({ status: 403 });
  });

  it('project admin sửa worklog người khác, tổng và remaining được tính lại', async () => {
    const { service, issue } = setup({ timeSpent: 3600, remainingEstimate: 25200 }, { logs: [{ id: 'w0', authorId: 'u9', timeSpent: 3600 }], perms: ['project:admin'] });
    await service.update('w1', 'u1', 'w0', { timeSpent: '2h' });
    expect(issue.timeSpent).toBe(7200);
    expect(issue.remainingEstimate).toBe(28800 - 7200);
  });

  it('tác giả xoá worklog của mình: timeSpent về 0, remaining về ước lượng gốc', async () => {
    const { service, issue, logs } = setup({ timeSpent: 3600, remainingEstimate: 25200 }, { logs: [{ id: 'w0', authorId: 'u1', timeSpent: 3600 }] });
    await service.remove('w1', 'u1', 'w0');
    expect(logs).toHaveLength(0);
    expect(issue.timeSpent).toBe(0);
    expect(issue.remainingEstimate).toBe(28800);
  });
});
