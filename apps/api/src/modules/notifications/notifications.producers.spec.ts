import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service';

const issue = {
  id: 'i1',
  key: 'TP-1',
  summary: 'Sửa lỗi',
  workspaceId: 'w1',
  assigneeId: 'u2' as string | null,
};

function setup(
  members: string[] = [],
  opts: { settings?: unknown; existingMentions?: string[] } = {},
) {
  const prisma = {
    user: {
      // Người nhận bật hết mặc định; actor chỉ cần displayName.
      findUnique: vi.fn(() =>
        Promise.resolve({
          settings: opts.settings ?? null,
          email: 'r@x.vn',
          status: 'ACTIVE',
          displayName: 'Minh',
        }),
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
    // Mô phỏng chỉ mục duy nhất: chỉ dòng CHƯA có sổ mới được chèn và trả về.
    mention: {
      createManyAndReturn: vi.fn((a: { data: { mentionedUserId: string }[] }) =>
        Promise.resolve(
          a.data
            .filter((d) => !(opts.existingMentions ?? []).includes(d.mentionedUserId))
            .map((d) => ({ mentionedUserId: d.mentionedUserId })),
        ),
      ),
    },
    $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(prisma)),
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

describe('NotificationsService — @mention kèm trích đoạn', () => {
  const payload = { comment: { id: 'c1', authorId: 'a1' }, issueId: 'i1', actorId: 'a1' };
  const createdPayloads = (prisma: ReturnType<typeof setup>['prisma']) =>
    prisma.notification.create.mock.calls.map(
      (c) => c[0].data as unknown as { type: string; payload: Record<string, unknown> },
    );

  it('onCommentAdded: payload MENTIONED có excerpt (đã đổi token → @Tên) và where=comment', async () => {
    const { service, prisma } = setup(['u3']);
    await service.onCommentAdded({
      ...payload,
      comment: { ...payload.comment, body: 'Chào @[Ba](user:u3), xem giúp' },
      mentionIds: ['u3'],
    });
    const m = createdPayloads(prisma).find((n) => n.type === 'MENTIONED');
    expect(m?.payload).toMatchObject({
      key: 'TP-1',
      summary: 'Sửa lỗi',
      excerpt: 'Chào @Ba, xem giúp',
      where: 'comment',
    });
  });

  it('người nhận tắt MENTIONED (in-app + email) → không notification.create, không mail.enqueue', async () => {
    const { service, prisma, mail } = setup(['u3'], {
      settings: { notifications: { MENTIONED: false, email: { mention: false } } },
    });
    await service.onCommentAdded({ ...payload, mentionIds: ['u3'] });
    expect(
      prisma.notification.create.mock.calls.filter((c) => c[0].data.type === 'MENTIONED'),
    ).toEqual([]);
    expect(mail.enqueue).not.toHaveBeenCalled();
  });

  it('onCommentUpdated: chỉ newMentionIds được báo MENTIONED (không báo COMMENT_ADDED)', async () => {
    const { service, created } = setup(['u3']);
    await service.onCommentUpdated({
      comment: { id: 'c1', authorId: 'a1', body: 'thêm @[Ba](user:u3)' },
      issueId: 'i1',
      actorId: 'a1',
      newMentionIds: ['u3'],
    });
    expect(created()).toEqual([{ type: 'MENTIONED', to: 'u3' }]);
  });

  it('onCommentUpdated: không có newMentionIds → không làm gì', async () => {
    const { service, prisma } = setup(['u3']);
    await service.onCommentUpdated({
      comment: { id: 'c1', authorId: 'a1' },
      issueId: 'i1',
      actorId: 'a1',
    });
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});

describe('NotificationsService — @mention trong mô tả công việc', () => {
  const withDesc = { ...issue, description: 'cc @[Ba](user:u3)' };

  it('@ mới trong mô tả → ghi sổ + thông báo CÙNG transaction, một MENTIONED where=description', async () => {
    const { service, prisma, created } = setup(['u3']);
    await service.onIssueDescriptionMentions({
      issue: withDesc,
      actorId: 'a1',
      changedFields: ['description'],
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.mention.createManyAndReturn).toHaveBeenCalledWith({
      data: [{ mentionedUserId: 'u3', issueId: 'i1' }],
      skipDuplicates: true,
      select: { mentionedUserId: true },
    });
    expect(created()).toEqual([{ type: 'MENTIONED', to: 'u3' }]);
    const data = prisma.notification.create.mock.calls[0]![0].data as unknown as {
      payload: Record<string, unknown>;
    };
    expect(data.payload).toMatchObject({ where: 'description', excerpt: 'cc @Ba' });
  });

  it('đã có dòng sổ (lần hai, hoặc sự kiện đồng thời thua cuộc ở ON CONFLICT) → không báo thêm', async () => {
    const { service, created, mail } = setup(['u3'], { existingMentions: ['u3'] });
    await service.onIssueDescriptionMentions({
      issue: withDesc,
      actorId: 'a1',
      changedFields: ['description'],
    });
    expect(created()).toEqual([]);
    expect(mail.enqueue).not.toHaveBeenCalled();
  });

  it('hai sự kiện đồng thời cùng @ người mới: chỉ một bên chèn được → đúng một thông báo', async () => {
    const { service, prisma, created } = setup(['u3']);
    const seen = new Set<string>();
    // sổ dùng chung: bên chèn trước thắng, bên sau nhận về mảng rỗng (ON CONFLICT DO NOTHING)
    prisma.mention.createManyAndReturn.mockImplementation(
      (a: { data: { mentionedUserId: string }[] }) => {
        const out = a.data.filter((d) => !seen.has(d.mentionedUserId));
        out.forEach((d) => seen.add(d.mentionedUserId));
        return Promise.resolve(out.map((d) => ({ mentionedUserId: d.mentionedUserId })));
      },
    );
    const ev = { issue: withDesc, actorId: 'a1', changedFields: ['description'] };
    await Promise.all([
      service.onIssueDescriptionMentions(ev),
      service.onIssueDescriptionMentions(ev),
    ]);
    expect(created()).toEqual([{ type: 'MENTIONED', to: 'u3' }]);
  });

  it('tạo thông báo lỗi giữa chừng → transaction rollback, không phát event/email', async () => {
    const { service, prisma, mail } = setup(['u3']);
    prisma.notification.create.mockRejectedValueOnce(new Error('DB lỗi'));
    await service.onIssueDescriptionMentions({
      issue: withDesc,
      actorId: 'a1',
      changedFields: ['description'],
    });
    expect(mail.enqueue).not.toHaveBeenCalled();
  });

  it('ISSUE_UPDATED không đổi description → bỏ qua', async () => {
    const { service, prisma } = setup(['u3']);
    await service.onIssueDescriptionMentions({
      issue: withDesc,
      actorId: 'a1',
      changedFields: ['summary'],
    });
    expect(prisma.workspaceMembership.findMany).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('ISSUE_CREATED (không có changedFields) có description → xử lý', async () => {
    const { service, created } = setup(['u3']);
    await service.onIssueDescriptionMentions({ issue: withDesc, actorId: 'a1' });
    expect(created()).toEqual([{ type: 'MENTIONED', to: 'u3' }]);
  });

  it('không tự nhắc chính mình (actor)', async () => {
    const { service, created } = setup(['u3']);
    await service.onIssueDescriptionMentions({ issue: withDesc, actorId: 'u3' });
    expect(created()).toEqual([]);
  });
});
