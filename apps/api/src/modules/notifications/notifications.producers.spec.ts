import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { NotificationsService } from './notifications.service';

const issue = {
  id: 'i1',
  key: 'TP-1',
  summary: 'Sửa lỗi',
  workspaceId: 'w1',
  projectId: 'p1',
  assigneeId: 'u2' as string | null,
};

function setup(
  members: string[] = [],
  opts: {
    settings?: unknown;
    existingMentions?: string[];
    canSee?: (userId: string) => boolean;
  } = {},
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
      // Mặc định chưa có dòng nào để gộp / chưa có dòng trực tiếp.
      findFirst: vi.fn((_a?: unknown): Promise<unknown> => Promise.resolve(null)),
      deleteMany: vi.fn((_a?: unknown) => Promise.resolve({ count: 0 })),
      update: vi.fn((a: { where: { id: string }; data: Record<string, unknown> }) =>
        Promise.resolve({
          id: a.where.id,
          type: 'COMMENT_ADDED',
          issueId: 'i1',
          commentId: 'c1',
          actorId: 'a1',
          readAt: null,
          ...a.data,
        }),
      ),
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
    status: { findUnique: vi.fn(() => Promise.resolve({ name: 'In Review' })) },
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
  const access = {
    canSee: vi.fn((userId: string, _w: string, _p: string) =>
      Promise.resolve(opts.canSee ? opts.canSee(userId) : true),
    ),
  };
  const service = new NotificationsService(
    prisma as never,
    events as never,
    mail as never,
    config as never,
    access as never,
  );
  const created = () =>
    prisma.notification.create.mock.calls.map((c) => ({
      type: c[0].data.type,
      to: c[0].data.recipientId,
    }));
  return { service, prisma, mail, created, events, access };
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

describe('NotificationsService — payload giàu ngữ cảnh (A13)', () => {
  const createdData = (prisma: ReturnType<typeof setup>['prisma']) =>
    prisma.notification.create.mock.calls.map(
      (c) => c[0].data as unknown as { type: string; payload: Record<string, unknown> },
    );

  it('đổi trạng thái: payload có tên người, trạng thái cũ → mới, count=1, actors', async () => {
    const { service, prisma } = setup();
    await service.onIssueTransitioned({
      issue: { ...issue, status: { name: 'Done' } },
      actorId: 'a1',
      fromStatusId: 's0',
    });
    expect(prisma.status.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's0' } }),
    );
    expect(createdData(prisma)[0]!.payload).toMatchObject({
      actorName: 'Minh',
      fromStatusName: 'In Review',
      statusName: 'Done',
      count: 1,
      actors: [{ id: 'a1', name: 'Minh' }],
    });
  });

  it('đổi trạng thái không có fromStatusId → không tra trạng thái cũ', async () => {
    const { service, prisma } = setup();
    await service.onIssueTransitioned({
      issue: { ...issue, status: { name: 'Done' } },
      actorId: 'a1',
    });
    expect(prisma.status.findUnique).not.toHaveBeenCalled();
    expect(createdData(prisma)[0]!.payload.fromStatusName).toBeUndefined();
  });

  it('COMMENT_ADDED: payload có excerpt thuần văn bản (bỏ cú pháp Markdown)', async () => {
    const { service, prisma } = setup();
    await service.onCommentAdded({
      comment: { id: 'c1', authorId: 'a1', body: '**Đã** sửa [link](http://x.y)' },
      issueId: 'i1',
      actorId: 'a1',
    });
    const c = createdData(prisma).find((n) => n.type === 'COMMENT_ADDED');
    expect(c?.payload).toMatchObject({ excerpt: 'Đã sửa link', actorName: 'Minh' });
  });

  it('email MENTIONED dùng bộ dựng câu chung: tiêu đề có người + nơi nhắc, nội dung = trích đoạn', async () => {
    const { service, mail } = setup(['u3']);
    await service.onCommentAdded({
      comment: { id: 'c1', authorId: 'a1', body: 'xem giúp @[Ba](user:u3)' },
      issueId: 'i1',
      actorId: 'a1',
      mentionIds: ['u3'],
    });
    const arg = (
      mail.enqueue.mock.calls as unknown as [{ payload: { title: string; body: string } }][]
    )[0]![0];
    expect(arg.payload.title).toBe('Minh nhắc đến bạn trong TP-1');
    expect(arg.payload.body).toBe('xem giúp @Ba');
  });
});

describe('NotificationsService — gộp theo công việc trong 60 giây (A14)', () => {
  const NOW = new Date('2026-10-16T10:00:00Z');
  const old = (over: Record<string, unknown> = {}) => ({
    id: 'n1',
    type: 'COMMENT_ADDED',
    payload: {
      key: 'TP-1',
      summary: 'Sửa lỗi',
      count: 1,
      actorName: 'Minh',
      actors: [{ id: 'a1', name: 'Minh' }],
      excerpt: 'một',
    },
    issueId: 'i1',
    commentId: 'c1',
    actorId: 'a1',
    readAt: null,
    createdAt: new Date(NOW.getTime() - 20_000),
    ...over,
  });
  const comment = {
    comment: { id: 'c2', authorId: 'a1', body: 'hai' },
    issueId: 'i1',
    actorId: 'a1',
  };

  it('có dòng chưa đọc cùng (người nhận, việc, loại) trong 60 s → cập nhật, không tạo mới, phát lại notification.created', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const { service, prisma } = setup();
      const events = (service as unknown as { events: { emit: ReturnType<typeof vi.fn> } }).events;
      prisma.notification.findFirst.mockResolvedValueOnce(old());
      await service.onCommentAdded(comment);
      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(prisma.notification.update).toHaveBeenCalledTimes(1);
      const upd = prisma.notification.update.mock.calls[0]![0];
      expect(upd.where).toEqual({ id: 'n1', readAt: null });
      expect(upd.data).toMatchObject({
        payload: { count: 2, excerpt: 'hai' },
        commentId: 'c2',
      });
      expect(upd.data.createdAt).toEqual(NOW);
      expect(events.emit).toHaveBeenCalledWith(
        'notification.created',
        expect.objectContaining({ recipientId: 'u2' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('truy vấn gộp đúng điều kiện: người nhận, việc, loại, chưa đọc, trong 60 s', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const { service, prisma } = setup();
      await service.onCommentAdded(comment);
      const arg = prisma.notification.findFirst.mock.calls[0]![0] as {
        where: { createdAt: { gte: Date } };
      };
      expect(arg.where).toEqual({
        recipientId: 'u2',
        issueId: 'i1',
        type: 'COMMENT_ADDED',
        readAt: null,
        createdAt: { gte: new Date(NOW.getTime() - 60_000) },
      });
      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('MENTIONED hai lần liên tiếp → hai dòng riêng, không tìm dòng để gộp', async () => {
    const { service, prisma } = setup(['u3']);
    const body = { comment: { id: 'c1', authorId: 'a1', body: '@[Ba](user:u3)' }, issueId: 'i1' };
    await service.onCommentAdded({ ...body, actorId: 'a1', mentionIds: ['u3'] });
    await service.onCommentAdded({ ...body, actorId: 'a1', mentionIds: ['u3'] });
    expect(
      prisma.notification.create.mock.calls.filter((c) => c[0].data.type === 'MENTIONED'),
    ).toHaveLength(2);
    const types = prisma.notification.findFirst.mock.calls.map(
      (c) => (c[0] as { where: { type: unknown } }).where.type,
    );
    expect(types).not.toContain('MENTIONED');
  });

  it('WATCHING_UPDATE bị bỏ khi người nhận vừa có dòng trực tiếp (loại khác) cho cùng việc', async () => {
    const { service, prisma } = setup();
    prisma.notification.findFirst.mockResolvedValueOnce({ id: 'direct' });
    await service.publish(
      {
        recipientId: 'u2',
        workspaceId: 'w1',
        type: 'WATCHING_UPDATE',
        issueId: 'i1',
        actorId: 'a1',
        payload: { key: 'TP-1', summary: 'Sửa lỗi' },
      },
      { force: true },
    );
    const where = (prisma.notification.findFirst.mock.calls[0]![0] as { where: unknown }).where;
    expect(where).toMatchObject({
      recipientId: 'u2',
      issueId: 'i1',
      type: { not: 'WATCHING_UPDATE' },
      readAt: null,
    });
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('force: WATCHING_UPDATE tạo dòng dù người nhận tắt loại này (mặc định tắt)', async () => {
    const { service, prisma } = setup();
    await service.publish(
      {
        recipientId: 'u2',
        workspaceId: 'w1',
        type: 'WATCHING_UPDATE',
        issueId: 'i1',
        actorId: 'a1',
        payload: { key: 'TP-1', summary: 'Sửa lỗi' },
      },
      { force: true },
    );
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    const noForce = setup();
    await noForce.service.publish({
      recipientId: 'u2',
      workspaceId: 'w1',
      type: 'WATCHING_UPDATE',
      issueId: 'i1',
      actorId: 'a1',
      payload: {},
    });
    expect(noForce.prisma.notification.create).not.toHaveBeenCalled();
  });

  it('gộp không bỏ qua cài đặt: người nhận tắt COMMENT_ADDED (in-app) → không update/create', async () => {
    const { service, prisma } = setup([], {
      settings: { notifications: { COMMENT_ADDED: false } },
    });
    await service.onCommentAdded(comment);
    expect(prisma.notification.findFirst).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });
});

describe('NotificationsService — vòng sửa 1 (A14)', () => {
  const watch = {
    recipientId: 'u2',
    workspaceId: 'w1',
    type: 'WATCHING_UPDATE' as const,
    issueId: 'i1',
    actorId: 'a1',
    payload: { key: 'TP-1', summary: 'Sửa lỗi' },
  };

  it('chốt chặn trung tâm: không báo cho chính người thao tác, không truy vấn gì', async () => {
    const { service, prisma } = setup();
    await service.publish({ ...watch, recipientId: 'a1' }, { force: true });
    await service.publish({ ...watch, type: 'ISSUE_ASSIGNED', recipientId: 'a1' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('force KHÔNG vượt công tắc người dùng đã TẮT tường minh (không dòng, không realtime)', async () => {
    const { service, prisma } = setup([], {
      settings: { notifications: { WATCHING_UPDATE: false } },
    });
    const events = (service as unknown as { events: { emit: ReturnType<typeof vi.fn> } }).events;
    await service.publish(watch, { force: true });
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('force vẫn thay MẶC ĐỊNH tắt; người dùng bật tường minh thì không cần force', async () => {
    const a = setup();
    await a.service.publish(watch, { force: true });
    expect(a.prisma.notification.create).toHaveBeenCalledTimes(1);
    const b = setup([], { settings: { notifications: { WATCHING_UPDATE: true } } });
    await b.service.publish(watch);
    expect(b.prisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it('thông báo trực tiếp hấp thụ dòng theo dõi chưa đọc cùng việc trong 60 s (xoá trước khi đẩy realtime)', async () => {
    const { service, prisma } = setup();
    const events = (service as unknown as { events: { emit: ReturnType<typeof vi.fn> } }).events;
    const order: string[] = [];
    prisma.notification.deleteMany.mockImplementation(() => {
      order.push('delete');
      return Promise.resolve({ count: 1 });
    });
    events.emit.mockImplementation(() => order.push('emit'));
    await service.publish({ ...watch, type: 'ISSUE_ASSIGNED' });
    const arg = prisma.notification.deleteMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };
    expect(arg.where).toMatchObject({
      recipientId: 'u2',
      issueId: 'i1',
      type: 'WATCHING_UPDATE',
      readAt: null,
    });
    expect(order).toEqual(['delete', 'emit']);
  });

  it('gộp: người nhận bấm đọc giữa lúc tìm và lúc ghi (P2025) → tạo dòng mới, không nhập vào dòng đã đọc', async () => {
    const { service, prisma } = setup();
    prisma.notification.findFirst.mockResolvedValueOnce({
      id: 'n1',
      type: 'COMMENT_ADDED',
      payload: { count: 1 },
      commentId: 'c1',
      actorId: 'a1',
    });
    prisma.notification.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('x', { code: 'P2025', clientVersion: 'x' }),
    );
    await service.onCommentAdded({
      comment: { id: 'c2', authorId: 'a1', body: 'hai' },
      issueId: 'i1',
      actorId: 'a1',
    });
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });
});

describe('NotificationsService — dự án riêng tư: người nhận phải xem được công việc (P16)', () => {
  it('onIssueUpdated: không tạo thông báo cho assignee không thấy dự án riêng tư', async () => {
    const { service, prisma, access, mail, events } = setup([], { canSee: () => false });
    await service.onIssueUpdated({
      issue,
      actorId: 'a1',
      changedFields: ['assigneeId'],
    });
    expect(access.canSee).toHaveBeenCalledWith('u2', 'w1', 'p1');
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(mail.enqueue).not.toHaveBeenCalled(); // không xếp email (không trích đoạn ra ngoài)
    expect(events.emit).not.toHaveBeenCalled(); // không đẩy realtime
  });

  it('assignee là thành viên dự án thì vẫn được báo như cũ', async () => {
    const { service, created, access } = setup([], { canSee: () => true });
    await service.onIssueCreated({ issue, actorId: 'a1' });
    expect(created()).toEqual([{ type: 'ISSUE_ASSIGNED', to: 'u2' }]);
    expect(access.canSee).toHaveBeenCalledWith('u2', 'w1', 'p1');
  });

  it('onIssueTransitioned: assignee không thấy dự án → không có STATUS_CHANGED', async () => {
    const { service, created } = setup([], { canSee: () => false });
    await service.onIssueTransitioned({ issue, actorId: 'a1', fromStatusId: 's0' });
    expect(created()).toEqual([]);
  });

  it('onCommentAdded: @nhắc người không thấy dự án bị bỏ qua; người thấy vẫn nhận MENTIONED', async () => {
    const { service, created } = setup(['u3', 'u4'], { canSee: (id) => id !== 'u3' });
    await service.onCommentAdded({
      comment: { id: 'c1', authorId: 'a1', body: 'xin chào' },
      issueId: 'i1',
      actorId: 'a1',
      mentionIds: ['u3', 'u4'],
    });
    expect(created().filter((n) => n.type === 'MENTIONED')).toEqual([
      { type: 'MENTIONED', to: 'u4' },
    ]);
  });

  it('onCommentAdded: truy vấn công việc có projectId để kiểm quyền người nhận', async () => {
    const { service, prisma } = setup([]);
    await service.onCommentAdded({
      comment: { id: 'c1', authorId: 'a1', body: 'x' },
      issueId: 'i1',
      actorId: 'a1',
    });
    const sel = (prisma.issue.findFirst.mock.calls[0] as unknown as [{ select: object }])[0].select;
    expect(sel).toMatchObject({ projectId: true });
  });

  it('@trong mô tả: người không thấy dự án KHÔNG vào sổ Mention (thêm vào dự án sau vẫn được báo)', async () => {
    const { service, prisma, created } = setup(['u3', 'u4'], { canSee: (id) => id !== 'u3' });
    await service.onIssueDescriptionMentions({
      issue: { ...issue, assigneeId: null, description: '@[A](user:u3) @[B](user:u4)' },
      actorId: 'a1',
    });
    const data = (
      prisma.mention.createManyAndReturn.mock.calls[0] as unknown as [
        { data: { mentionedUserId: string }[] },
      ]
    )[0].data;
    expect(data.map((d) => d.mentionedUserId)).toEqual(['u4']);
    expect(created()).toEqual([{ type: 'MENTIONED', to: 'u4' }]);
  });

  it('người theo dõi (publish không có projectId, chỉ có issueId): tra dự án từ công việc rồi lọc', async () => {
    const { service, prisma, access, created } = setup([], { canSee: () => false });
    await service.publish(
      {
        recipientId: 'w9',
        workspaceId: 'w1',
        type: 'WATCHING_UPDATE',
        issueId: 'i1',
        actorId: 'a1',
        payload: { key: 'TP-1', summary: 's' },
      },
      { force: true },
    );
    expect(access.canSee).toHaveBeenCalledWith('w9', 'w1', 'p1');
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(created()).toEqual([]);
  });

  it('thông báo không gắn công việc (issueId trống) không bị kiểm quyền xem dự án', async () => {
    const { service, access } = setup([], { canSee: () => false });
    await service.publish({
      recipientId: 'u2',
      workspaceId: 'w1',
      type: 'SPRINT_STARTED',
      actorId: 'a1',
      payload: {},
    });
    expect(access.canSee).not.toHaveBeenCalled();
  });

  it('thông báo không gắn công việc, người nhận bật loại đó → vẫn được tạo (không bị lọc theo dự án)', async () => {
    const { service, access, created } = setup([], {
      canSee: () => false,
      settings: { notifications: { SPRINT_STARTED: true } },
    });
    await service.publish({
      recipientId: 'u2',
      workspaceId: 'w1',
      type: 'SPRINT_STARTED',
      actorId: 'a1',
      payload: {},
    });
    expect(access.canSee).not.toHaveBeenCalled();
    expect(created()).toEqual([{ type: 'SPRINT_STARTED', to: 'u2' }]);
  });
});
