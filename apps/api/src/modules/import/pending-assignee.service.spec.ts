import { describe, expect, it, vi } from 'vitest';
import { PendingAssigneeService } from './pending-assignee.service';

interface Pending {
  id: string;
  issueId: string;
  projectId: string;
  email: string;
  sourceName: string;
}

function setup(
  opts: {
    pending?: Pending[];
    users?: Array<{ id: string; email: string; status?: string }>;
    updated?: Record<string, number>; // issueId → count của updateMany (mặc định 1)
    hidden?: string[]; // `${userId}:${projectId}` người đó KHÔNG thấy
  } = {},
) {
  const tx = {
    issue: {
      updateMany: vi.fn((a: { where: { id: string } }) =>
        Promise.resolve({ count: opts.updated?.[a.where.id] ?? 1 }),
      ),
    },
    issueHistory: { createMany: vi.fn(() => Promise.resolve({ count: 1 })) },
    importPendingAssignee: { deleteMany: vi.fn(() => Promise.resolve({ count: 1 })) },
  };
  const prisma = {
    $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    user: {
      findMany: vi.fn(() =>
        Promise.resolve(
          (opts.users ?? [{ id: 'u1', email: 'An@X.com' }]).map((u) => ({
            status: 'ACTIVE',
            ...u,
          })),
        ),
      ),
    },
    importPendingAssignee: {
      findMany: vi.fn((a: { where: { email: { in: string[] } } }) =>
        Promise.resolve((opts.pending ?? []).filter((p) => a.where.email.in.includes(p.email))),
      ),
    },
    issue: {
      findMany: vi.fn((a: { where: { id: { in: string[] } } }) =>
        Promise.resolve(a.where.id.in.map((id) => ({ id, key: `K-${id}`, reporterId: 'rep' }))),
      ),
    },
  };
  const access = {
    canSee: vi.fn((userId: string, _w: string, projectId: string) =>
      Promise.resolve(!opts.hidden?.includes(`${userId}:${projectId}`)),
    ),
  };
  const issues = {
    getByKey: vi.fn((_w: string, key: string) => Promise.resolve({ id: key.slice(2), key })),
  };
  const events = { emit: vi.fn() };
  const svc = new PendingAssigneeService(
    prisma as never,
    access as never,
    issues as never,
    events as never,
  );
  return { svc, prisma, tx, access, issues, events };
}

const row = (over: Partial<Pending> = {}): Pending => ({
  id: 'pa1',
  issueId: 'i1',
  projectId: 'p1',
  email: 'an@x.com',
  sourceName: 'An',
  ...over,
});

describe('PendingAssigneeService.claimFor (L28)', () => {
  it('email khớp không phân biệt hoa/thường → gán, ghi lịch sử ASSIGNEE, xoá hàng chờ, phát ISSUE_UPDATED', async () => {
    const { svc, tx, events, prisma } = setup({ pending: [row()] });
    const n = await svc.claimFor('w1', ['u1'], 'admin');
    expect(n).toBe(1);
    // tra theo email chữ thường dù user lưu "An@X.com"
    expect(prisma.importPendingAssignee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'w1', email: { in: ['an@x.com'] } } }),
    );
    const upd = tx.issue.updateMany.mock.calls[0]![0] as unknown as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(upd.data).toMatchObject({ assigneeId: 'u1', version: { increment: 1 } });
    expect(upd.where).toMatchObject({
      id: 'i1',
      assigneeId: null,
      deletedAt: null,
      project: { deletedAt: null, archivedAt: null },
    });
    const hist = (
      tx.issueHistory.createMany.mock.calls[0] as unknown as [
        { data: Array<Record<string, unknown>> },
      ]
    )[0].data;
    expect(hist).toEqual([
      expect.objectContaining({
        issueId: 'i1',
        projectId: 'p1',
        field: 'ASSIGNEE',
        oldValue: null,
        newValue: 'u1',
        actorId: 'admin',
      }),
    ]);
    expect(tx.importPendingAssignee.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['pa1'] } },
    });
    expect(events.emit).toHaveBeenCalledWith(
      'issue.updated',
      expect.objectContaining({
        actorId: 'admin',
        changedFields: ['assigneeId'],
        issue: expect.objectContaining({ key: 'K-i1' }) as unknown,
      }),
    );
  });

  it('việc đã có người (updateMany count 0) → không ghi lịch sử, không phát, nhưng VẪN xoá hàng chờ', async () => {
    const { svc, tx, events } = setup({ pending: [row()], updated: { i1: 0 } });
    const n = await svc.claimFor('w1', ['u1']);
    expect(n).toBe(0);
    expect(tx.issueHistory.createMany).not.toHaveBeenCalled();
    expect(tx.importPendingAssignee.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['pa1'] } },
    });
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('dự án riêng tư người đó chưa thấy → KHÔNG gán và GIỮ hàng chờ; dự án thấy được vẫn gán', async () => {
    const { svc, tx } = setup({
      pending: [row(), row({ id: 'pa2', issueId: 'i2', projectId: 'p-private' })],
      hidden: ['u1:p-private'],
    });
    const n = await svc.claimFor('w1', ['u1']);
    expect(n).toBe(1);
    const ids = tx.issue.updateMany.mock.calls.map((c) => c[0].where.id);
    expect(ids).toEqual(['i1']);
    expect(tx.importPendingAssignee.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['pa1'] } },
    });
  });

  it('actorId vắng → ghi lịch sử dưới tên người nhập (reporter của việc)', async () => {
    const { svc, tx } = setup({ pending: [row()] });
    await svc.claimFor('w1', ['u1']);
    const hist = (
      tx.issueHistory.createMany.mock.calls[0] as unknown as [{ data: Array<{ actorId: string }> }]
    )[0].data;
    expect(hist[0]!.actorId).toBe('rep');
  });

  it('không có hàng chờ khớp → không mở transaction, không truy vấn việc/quyền', async () => {
    const { svc, prisma, access, issues } = setup({ pending: [] });
    expect(await svc.claimFor('w1', ['u1'])).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(access.canSee).not.toHaveBeenCalled();
    expect(issues.getByKey).not.toHaveBeenCalled();
  });

  it('danh sách người rỗng → 0, không truy vấn gì', async () => {
    const { svc, prisma } = setup();
    expect(await svc.claimFor('w1', [])).toBe(0);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('tài khoản đã vô hiệu hoá không nhận việc', async () => {
    const { svc, tx } = setup({
      pending: [row()],
      users: [{ id: 'u1', email: 'an@x.com', status: 'DEACTIVATED' }],
    });
    expect(await svc.claimFor('w1', ['u1'])).toBe(0);
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('nhiều người, nhiều việc: mỗi người chỉ nhận việc đúng email của mình', async () => {
    const { svc, tx } = setup({
      users: [
        { id: 'u1', email: 'an@x.com' },
        { id: 'u2', email: 'binh@x.com' },
      ],
      pending: [
        row(),
        row({ id: 'pa2', issueId: 'i2', email: 'binh@x.com' }),
        row({ id: 'pa3', issueId: 'i3', email: 'khac@x.com' }),
      ],
    });
    expect(await svc.claimFor('w1', ['u1', 'u2'])).toBe(2);
    const calls = tx.issue.updateMany.mock.calls.map(
      (c) => c[0] as { where: { id: string }; data: { assigneeId: string } },
    );
    expect(calls.map((c) => [c.where.id, c.data.assigneeId])).toEqual([
      ['i1', 'u1'],
      ['i2', 'u2'],
    ]);
  });
});

describe('PendingAssigneeService.onMemberAdded (L28)', () => {
  it('nuốt lỗi: gán thất bại không làm hỏng thao tác thêm thành viên', async () => {
    const { svc, prisma } = setup();
    prisma.user.findMany.mockRejectedValueOnce(new Error('db down'));
    await expect(
      svc.onMemberAdded({ workspaceId: 'w1', userIds: ['u1'] }),
    ).resolves.toBeUndefined();
  });

  it('chuyển workspaceId/userIds/actorId vào claimFor', async () => {
    const { svc } = setup();
    const spy = vi.spyOn(svc, 'claimFor').mockResolvedValue(0);
    await svc.onMemberAdded({ workspaceId: 'w1', userIds: ['u1'], actorId: 'a' });
    expect(spy).toHaveBeenCalledWith('w1', ['u1'], 'a');
  });
});
