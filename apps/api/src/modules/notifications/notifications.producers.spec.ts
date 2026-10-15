import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service';

const issue = {
  id: 'i1',
  key: 'TP-1',
  summary: 'Sửa lỗi',
  workspaceId: 'w1',
  assigneeId: 'u2' as string | null,
};

function setup(members: string[] = []) {
  const prisma = {
    user: {
      // Người nhận bật hết mặc định; actor chỉ cần displayName.
      findUnique: vi.fn(() =>
        Promise.resolve({ settings: null, email: 'r@x.vn', status: 'ACTIVE', displayName: 'Minh' }),
      ),
    },
    notification: {
      create: vi.fn((a: { data: { type: string; recipientId: string } }) =>
        Promise.resolve({
          id: 'n',
          ...a.data,
          issueId: 'i1',
          commentId: null,
          actorId: 'a1',
          payload: {},
          readAt: null,
          createdAt: new Date(),
        }),
      ),
    },
    issue: { findFirst: vi.fn(() => Promise.resolve({ ...issue })) },
    workspaceMembership: {
      findMany: vi.fn((a: { where: { userId: { in: string[] } } }) =>
        Promise.resolve(
          a.where.userId.in.filter((id) => members.includes(id)).map((userId) => ({ userId })),
        ),
      ),
    },
  };
  const events = { emit: vi.fn() };
  const mail = { enqueue: vi.fn(() => Promise.resolve()) };
  const config = { get: vi.fn(() => 'http://localhost:5173') };
  const service = new NotificationsService(
    prisma as never,
    events as never,
    mail as never,
    config as never,
  );
  const created = () =>
    prisma.notification.create.mock.calls.map((c) => ({
      type: c[0].data.type,
      to: c[0].data.recipientId,
    }));
  return { service, prisma, mail, created };
}

describe('NotificationsService — ISSUE_ASSIGNED', () => {
  it('đổi người phụ trách sang người khác (≠ actor) → ISSUE_ASSIGNED + email', async () => {
    const { service, created, mail } = setup();
    await service.onIssueUpdated({
      issue,
      actorId: 'a1',
      changedFields: ['summary', 'assigneeId'],
    });
    expect(created()).toEqual([{ type: 'ISSUE_ASSIGNED', to: 'u2' }]);
    expect(mail.enqueue).toHaveBeenCalledTimes(1);
  });

  it('tự giao cho mình → không thông báo', async () => {
    const { service, created } = setup();
    await service.onIssueUpdated({ issue, actorId: 'u2', changedFields: ['assigneeId'] });
    expect(created()).toEqual([]);
  });

  it('người phụ trách không đổi → không phát ISSUE_ASSIGNED (ISSUE_UPDATED mặc định tắt nên không có gì)', async () => {
    const { service, created } = setup();
    await service.onIssueUpdated({ issue, actorId: 'a1', changedFields: ['summary'] });
    expect(created().some((n) => n.type === 'ISSUE_ASSIGNED')).toBe(false);
  });

  it('bỏ giao (assignee null) → không thông báo', async () => {
    const { service, created } = setup();
    await service.onIssueUpdated({
      issue: { ...issue, assigneeId: null },
      actorId: 'a1',
      changedFields: ['assigneeId'],
    });
    expect(created()).toEqual([]);
  });

  it('tạo issue đã có assignee ≠ actor → ISSUE_ASSIGNED; assignee = actor hoặc không có → không', async () => {
    const a = setup();
    await a.service.onIssueCreated({ issue, actorId: 'a1' });
    expect(a.created()).toEqual([{ type: 'ISSUE_ASSIGNED', to: 'u2' }]);
    const b = setup();
    await b.service.onIssueCreated({ issue, actorId: 'u2' });
    await b.service.onIssueCreated({ issue: { ...issue, assigneeId: null }, actorId: 'a1' });
    expect(b.created()).toEqual([]);
  });
});

describe('NotificationsService — MENTIONED', () => {
  const payload = { comment: { id: 'c1', authorId: 'a1' }, issueId: 'i1', actorId: 'a1' };

  it('chỉ thành viên workspace và ≠ actor mới nhận MENTIONED; truy vấn thành viên theo workspace của issue', async () => {
    const { service, created, prisma } = setup(['u3']);
    await service.onCommentAdded({ ...payload, mentionIds: ['u3', 'ngoai', 'a1'] });
    const types = created();
    expect(types).toContainEqual({ type: 'MENTIONED', to: 'u3' });
    expect(types.filter((n) => n.type === 'MENTIONED')).toHaveLength(1);
    const where = (
      prisma.workspaceMembership.findMany.mock.calls[0] as unknown as [
        { where: { workspaceId: string; userId: { in: string[] } } },
      ]
    )[0].where;
    expect(where.workspaceId).toBe('w1');
    expect(where.userId.in).toEqual(['u3', 'ngoai']);
    // assignee u2 vẫn nhận COMMENT_ADDED
    expect(types).toContainEqual({ type: 'COMMENT_ADDED', to: 'u2' });
  });

  it('assignee đã được nhắc tên → chỉ MENTIONED, không báo thêm COMMENT_ADDED', async () => {
    const { service, created } = setup(['u2']);
    await service.onCommentAdded({ ...payload, mentionIds: ['u2'] });
    expect(created()).toEqual([{ type: 'MENTIONED', to: 'u2' }]);
  });

  it('không có mentionIds → không truy vấn thành viên', async () => {
    const { service, prisma } = setup();
    await service.onCommentAdded(payload);
    expect(prisma.workspaceMembership.findMany).not.toHaveBeenCalled();
  });
});
