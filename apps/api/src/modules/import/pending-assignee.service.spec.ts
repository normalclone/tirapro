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
    /** issueId đã có người (không còn đủ điều kiện gán). */
    assignedAlready?: string[];
    hidden?: string[]; // `${userId}:${projectId}` người đó KHÔNG thấy
  } = {},
) {
  const pending = opts.pending ?? [];
  const tx = {
    issue: {
      findMany: vi.fn((a: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          a.where.id.in
            .filter((id) => !opts.assignedAlready?.includes(id))
            .map((id) => ({
              id,
              key: `K-${id}`,
              projectId: pending.find((p) => p.issueId === id)?.projectId ?? 'p1',
              sprintId: null,
              reporterId: 'rep',
            })),
        ),
      ),
      updateMany: vi.fn((a: { where: { id: { in: string[] } } }) =>
        Promise.resolve({ count: a.where.id.in.length }),
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
      findMany: vi.fn((a: { where: { email?: { in: string[] }; projectId?: string } }) =>
        Promise.resolve(
          pending.filter(
            (p) =>
              (!a.where.email || a.where.email.in.includes(p.email)) &&
              (!a.where.projectId || a.where.projectId === p.projectId),
          ),
        ),
      ),
    },
  };
  const access = {
    canSee: vi.fn((userId: string, _w: string, projectId: string) =>
      Promise.resolve(!opts.hidden?.includes(`${userId}:${projectId}`)),
    ),
  };
  const issues = {
    getDtosByIdsForSystem: vi.fn((_w: string, ids: string[]) =>
      Promise.resolve(
        ids.map((id) => ({ id, key: `K-${id}`, projectId: 'p1', reporterId: 'rep' })),
      ),
    ),
  };
  const events = { emit: vi.fn() };
  const notifications = { publish: vi.fn(() => Promise.resolve()) };
  const svc = new PendingAssigneeService(
    prisma as never,
    access as never,
    issues as never,
    events as never,
    notifications as never,
  );
  return { svc, prisma, tx, access, issues, events, notifications };
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
    const n = await svc.claimFor('w1', ['u1'], { actorId: 'admin' });
    expect(n).toBe(1);
    expect(prisma.importPendingAssignee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'w1', email: { in: ['an@x.com'] } } }),
    );
    const upd = tx.issue.updateMany.mock.calls[0]![0] as unknown as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(upd.data).toMatchObject({ assigneeId: 'u1', version: { increment: 1 } });
    expect(upd.where).toMatchObject({
      id: { in: ['i1'] },
      assigneeId: null,
      deletedAt: null,
    });
    // đủ điều kiện = chưa có người, chưa xoá, dự án chưa xoá/lưu trữ
    expect(tx.issue.findMany.mock.calls[0]![0].where).toMatchObject({
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
        bulk: true,
        issue: expect.objectContaining({ key: 'K-i1' }) as unknown,
      }),
    );
  });

  it('việc đã có người → không ghi lịch sử, không phát, nhưng VẪN xoá hàng chờ', async () => {
    const { svc, tx, events, notifications } = setup({ pending: [row()], assignedAlready: ['i1'] });
    expect(await svc.claimFor('w1', ['u1'])).toBe(0);
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(tx.issueHistory.createMany).not.toHaveBeenCalled();
    expect(tx.importPendingAssignee.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['pa1'] } },
    });
    expect(events.emit).not.toHaveBeenCalled();
    expect(notifications.publish).not.toHaveBeenCalled();
  });

  it('dự án riêng tư người đó chưa thấy → KHÔNG gán và GIỮ hàng chờ; dự án thấy được vẫn gán', async () => {
    const { svc, tx } = setup({
      pending: [row(), row({ id: 'pa2', issueId: 'i2', projectId: 'p-private' })],
      hidden: ['u1:p-private'],
    });
    expect(await svc.claimFor('w1', ['u1'])).toBe(1);
    const ids = tx.issue.updateMany.mock.calls.flatMap((c) => c[0].where.id.in);
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
    expect(issues.getDtosByIdsForSystem).not.toHaveBeenCalled();
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

  it('nhiều người: mỗi người nhận đúng việc của email mình (cập nhật theo lô cho từng người)', async () => {
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
      (c) => c[0] as unknown as { where: { id: { in: string[] } }; data: { assigneeId: string } },
    );
    expect(calls.map((c) => [c.where.id.in, c.data.assigneeId])).toEqual([
      [['i1'], 'u1'],
      [['i2'], 'u2'],
    ]);
  });
});

describe('PendingAssigneeService — gán hàng loạt không spam (L28 fix)', () => {
  const many = (n: number): Pending[] =>
    Array.from({ length: n }, (_, i) => row({ id: `pa${i}`, issueId: `i${i}` }));

  it('500 việc của một người: 1 updateMany, 1 createMany lịch sử, 1 truy vấn DTO, và MỘT thông báo gộp', async () => {
    const { svc, tx, issues, events, notifications } = setup({ pending: many(500) });
    expect(await svc.claimFor('w1', ['u1'], { actorId: 'admin' })).toBe(500);
    expect(tx.issue.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.issueHistory.createMany).toHaveBeenCalledTimes(1);
    expect(
      (tx.issueHistory.createMany.mock.calls[0] as unknown as [{ data: unknown[] }])[0].data,
    ).toHaveLength(500);
    expect(issues.getDtosByIdsForSystem).toHaveBeenCalledTimes(1); // không còn N getByKey tuần tự
    // realtime vẫn có cho từng việc nhưng cờ bulk để thông báo từng việc bị bỏ qua
    expect(events.emit).toHaveBeenCalledTimes(500);
    expect(events.emit.mock.calls.every((c) => (c[1] as { bulk: boolean }).bulk)).toBe(true);
    expect(notifications.publish).toHaveBeenCalledTimes(1);
    expect(notifications.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'u1',
        workspaceId: 'w1',
        type: 'ISSUE_ASSIGNED',
        actorId: 'admin',
        payload: expect.objectContaining({ bulk: 'jira-import', count: 500 }) as unknown,
      }),
    );
  });

  it('mỗi người một thông báo gộp riêng; người không được gán việc nào không nhận thông báo', async () => {
    const { svc, notifications } = setup({
      users: [
        { id: 'u1', email: 'an@x.com' },
        { id: 'u2', email: 'binh@x.com' },
      ],
      pending: [...many(3), row({ id: 'pb', issueId: 'ib', email: 'binh@x.com' })],
    });
    await svc.claimFor('w1', ['u1', 'u2']);
    const sent = notifications.publish.mock.calls.map(
      (c) => (c as unknown[])[0] as { recipientId: string; payload: { count: number } },
    );
    expect(sent.map((s) => [s.recipientId, s.payload.count])).toEqual([
      ['u1', 3],
      ['u2', 1],
    ]);
  });

  it('lỗi gửi thông báo/sự kiện sau commit không làm hỏng kết quả gán', async () => {
    const { svc, notifications } = setup({ pending: many(2) });
    notifications.publish.mockRejectedValueOnce(new Error('mail down'));
    expect(await svc.claimFor('w1', ['u1'])).toBe(2);
  });
});

describe('PendingAssigneeService — thử lại khi được cấp quyền xem dự án (L28 fix I1)', () => {
  it('được thêm vào dự án riêng tư: chỉ xét hàng chờ của dự án đó, giờ canSee → gán', async () => {
    const { svc, tx, prisma } = setup({
      pending: [
        row({ projectId: 'p-private' }),
        row({ id: 'pa2', issueId: 'i2', projectId: 'p1' }),
      ],
    });
    const n = await svc.onProjectAccessChanged({
      workspaceId: 'w1',
      projectId: 'p-private',
      userIds: ['u1'],
    });
    expect(n).toBeUndefined();
    expect(prisma.importPendingAssignee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ projectId: 'p-private' }) as unknown,
      }),
    );
    const ids = tx.issue.updateMany.mock.calls.flatMap((c) => c[0].where.id.in);
    expect(ids).toEqual(['i1']); // chỉ việc của dự án vừa được cấp quyền
  });

  it('dự án vừa mở công khai (userIds null): xét mọi hàng chờ của dự án, tìm người theo email trong workspace', async () => {
    const { svc, tx, prisma } = setup({
      pending: [
        row({ projectId: 'p-private' }),
        row({ id: 'pa2', issueId: 'i2', projectId: 'p-private', email: 'binh@x.com' }),
      ],
      users: [
        { id: 'u1', email: 'an@x.com' },
        { id: 'u2', email: 'binh@x.com' },
      ],
    });
    await svc.onProjectAccessChanged({ workspaceId: 'w1', projectId: 'p-private', userIds: null });
    expect(prisma.importPendingAssignee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'w1', projectId: 'p-private' } }),
    );
    const calls = tx.issue.updateMany.mock.calls.map(
      (c) => c[0] as unknown as { data: { assigneeId: string } },
    );
    expect(calls.map((c) => c.data.assigneeId)).toEqual(['u1', 'u2']);
  });

  it('người dùng ngoài workspace (email khớp nhưng không là thành viên) không được gán khi dự án mở công khai', async () => {
    const { svc, tx, prisma } = setup({ pending: [row({ projectId: 'p1' })], users: [] });
    await svc.onProjectAccessChanged({ workspaceId: 'w1', projectId: 'p1', userIds: null });
    // truy vấn user chỉ nhận thành viên workspace
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceMemberships: { some: { workspaceId: 'w1' } },
        }) as unknown,
      }),
    );
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('nuốt lỗi như member.added', async () => {
    const { svc, prisma } = setup();
    prisma.importPendingAssignee.findMany.mockRejectedValueOnce(new Error('db down'));
    await expect(
      svc.onProjectAccessChanged({ workspaceId: 'w1', projectId: 'p1', userIds: null }),
    ).resolves.toBeUndefined();
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
    expect(spy).toHaveBeenCalledWith('w1', ['u1'], { actorId: 'a' });
  });
});
