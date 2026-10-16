import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { WatchersService } from '../watchers/watchers.service';

/** Kho thông báo trong bộ nhớ, hiểu đủ các điều kiện `where` mà logic gộp dùng. */
interface Row {
  id: string;
  type: string;
  recipientId: string;
  issueId: string | null;
  commentId: string | null;
  actorId: string | null;
  payload: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    const val: unknown = (row as unknown as Record<string, unknown>)[k];
    if (k === 'createdAt') {
      if (row.createdAt < (v as { gte: Date }).gte) return false;
    } else if (v && typeof v === 'object' && 'not' in v) {
      if (val === v.not) return false;
    } else if (val !== v) return false;
  }
  return true;
}

function setup(opts: { watchers: string[]; assignee?: string }) {
  const rows: Row[] = [];
  let seq = 0;
  const prisma = {
    user: {
      findUnique: vi.fn(() =>
        Promise.resolve({
          settings: null,
          email: 'r@x.vn',
          status: 'ACTIVE',
          displayName: 'Trang',
        }),
      ),
    },
    notification: {
      findFirst: vi.fn((a: { where: Record<string, unknown> }) =>
        Promise.resolve([...rows].reverse().find((r) => matches(r, a.where)) ?? null),
      ),
      create: vi.fn((a: { data: Omit<Row, 'id' | 'readAt' | 'createdAt'> }) => {
        const row: Row = { id: `n${++seq}`, readAt: null, createdAt: new Date(), ...a.data };
        rows.push(row);
        return Promise.resolve(row);
      }),
      update: vi.fn((a: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const row = rows.find((r) => matches(r, a.where));
        if (!row)
          return Promise.reject(
            new Prisma.PrismaClientKnownRequestError('x', { code: 'P2025', clientVersion: 'x' }),
          );
        Object.assign(row, a.data);
        return Promise.resolve(row);
      }),
      deleteMany: vi.fn((a: { where: Record<string, unknown> }) => {
        const gone = rows.filter((r) => matches(r, a.where));
        for (const r of gone) rows.splice(rows.indexOf(r), 1);
        return Promise.resolve({ count: gone.length });
      }),
    },
    issueWatcher: {
      findMany: vi.fn(() => Promise.resolve(opts.watchers.map((userId) => ({ userId })))),
    },
    // Mô phỏng sổ mention + transaction: thông báo ghi trong tx chỉ "thấy được" sau khi commit (đẩy vào rows ở cuối).
    mention: {
      createManyAndReturn: vi.fn((a: { data: { mentionedUserId: string }[] }) =>
        Promise.resolve(a.data.map((d) => ({ mentionedUserId: d.mentionedUserId }))),
      ),
    },
    workspaceMembership: {
      findMany: vi.fn((a: { where: { userId: { in: string[] } } }) =>
        Promise.resolve(a.where.userId.in.map((userId) => ({ userId }))),
      ),
    },
    $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(prisma)),
    issue: {
      findFirst: vi.fn(() =>
        Promise.resolve({
          id: 'i1',
          workspaceId: 'w1',
          key: 'TP-1',
          summary: 'Sửa lỗi',
          assigneeId: opts.assignee ?? null,
        }),
      ),
    },
  };
  const events = { emit: vi.fn() };
  const mail = { enqueue: vi.fn(() => Promise.resolve()) };
  const config = { get: vi.fn(() => 'http://x') };
  const notifications = new NotificationsService(
    prisma as never,
    events as never,
    mail as never,
    config as never,
    { canSee: vi.fn(() => Promise.resolve(true)) } as never,
  );
  const watchers = new WatchersService(prisma as never, notifications);
  return { rows, notifications, watchers, events };
}

const issue = { id: 'i1', workspaceId: 'w1', key: 'TP-1', summary: 'Sửa lỗi' };

describe('không gửi đôi theo dõi vs trực tiếp — cả hai thứ tự', () => {
  const withDesc = { ...issue, assigneeId: null, description: 'cc @[Ba](user:w1)' };
  const types = (rows: Row[]) => rows.map((r) => r.type);

  it('@nhắc trong mô tả, người đó đang theo dõi — theo dõi chạy TRƯỚC (trực tiếp chưa commit)', async () => {
    const { rows, notifications, watchers } = setup({ watchers: ['w1'] });
    await watchers.onIssueUpdated({
      issue: withDesc,
      actorId: 'a1',
      changedFields: ['description'],
    });
    expect(types(rows)).toEqual(['WATCHING_UPDATE']);
    await notifications.onIssueDescriptionMentions({
      issue: withDesc,
      actorId: 'a1',
      changedFields: ['description'],
    });
    expect(types(rows)).toEqual(['MENTIONED']);
  });

  it('@nhắc trong mô tả, người đó đang theo dõi — trực tiếp TRƯỚC, theo dõi sau', async () => {
    const { rows, notifications, watchers } = setup({ watchers: ['w1'] });
    await notifications.onIssueDescriptionMentions({
      issue: withDesc,
      actorId: 'a1',
      changedFields: ['description'],
    });
    await watchers.onIssueUpdated({
      issue: withDesc,
      actorId: 'a1',
      changedFields: ['description'],
    });
    expect(types(rows)).toEqual(['MENTIONED']);
  });

  it('assignee là watcher, theo dõi chạy TRƯỚC rồi bình luận trực tiếp → chỉ còn COMMENT_ADDED', async () => {
    const { rows, notifications, watchers } = setup({ watchers: ['u2'], assignee: 'u2' });
    const ev = { comment: { id: 'c1', authorId: 'a1', body: 'hi' }, issueId: 'i1', actorId: 'a1' };
    await watchers.onCommentAdded(ev);
    await notifications.onCommentAdded(ev);
    expect(types(rows)).toEqual(['COMMENT_ADDED']);
  });

  it('đua: theo dõi kiểm "trực tiếp" khi chưa thấy, dòng trực tiếp commit giữa chừng → kiểm lại sau khi ghi rút dòng theo dõi', async () => {
    const { rows, notifications, watchers } = setup({ watchers: ['u2'], assignee: 'u2' });
    const ev = { comment: { id: 'c1', authorId: 'a1', body: 'hi' }, issueId: 'i1', actorId: 'a1' };
    const store = (
      notifications as unknown as {
        prisma: {
          notification: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
        };
      }
    ).prisma.notification;
    // Lần kiểm "trực tiếp" ĐẦU của watcher không thấy gì; ngay sau đó dòng trực tiếp xuất hiện.
    const real = store.findFirst.getMockImplementation()! as (a: unknown) => Promise<unknown>;
    let first = true;
    store.findFirst.mockImplementation(
      async (a: { where: { type?: unknown } }): Promise<unknown> => {
        if (first && typeof a.where.type === 'object') {
          first = false;
          await notifications.onCommentAdded(ev); // trực tiếp commit + hấp thụ (chưa có dòng theo dõi để xoá)
          return null;
        }
        return await real(a);
      },
    );
    await watchers.onCommentAdded(ev);
    expect(types(rows)).toEqual(['COMMENT_ADDED']);
  });
});

describe('gộp thông báo — kịch bản thực tế', () => {
  it('10 cú tick checklist trong 60 s (10 ISSUE_UPDATED) → mỗi watcher đúng 1 thông báo, count=10, đẩy realtime mỗi lần', async () => {
    const { rows, watchers, events } = setup({ watchers: ['w1', 'w2', 'a1'] });
    for (let i = 0; i < 10; i++) {
      await watchers.onIssueUpdated({ issue, actorId: 'a1', changedFields: ['description'] });
    }
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.type).toBe('WATCHING_UPDATE');
      expect(r.payload).toMatchObject({ count: 10, actorName: 'Trang' });
    }
    expect(events.emit).toHaveBeenCalledTimes(20);
  });

  it('đã đọc rồi tick tiếp → dòng mới (không gộp vào dòng đã đọc)', async () => {
    const { rows, watchers } = setup({ watchers: ['w1'] });
    await watchers.onIssueUpdated({ issue, actorId: 'a1' });
    rows[0]!.readAt = new Date();
    await watchers.onIssueUpdated({ issue, actorId: 'a1' });
    expect(rows).toHaveLength(2);
  });

  it('quá 60 s → dòng mới', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-16T10:00:00Z'));
      const { rows, watchers } = setup({ watchers: ['w1'] });
      await watchers.onIssueUpdated({ issue, actorId: 'a1' });
      vi.setSystemTime(new Date('2026-10-16T10:01:01Z'));
      await watchers.onIssueUpdated({ issue, actorId: 'a1' });
      expect(rows).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('assignee cũng là watcher: bình luận → một COMMENT_ADDED, KHÔNG thêm WATCHING_UPDATE', async () => {
    const { rows, notifications, watchers } = setup({ watchers: ['u2'], assignee: 'u2' });
    const ev = { comment: { id: 'c1', authorId: 'a1', body: 'hi' }, issueId: 'i1', actorId: 'a1' };
    // thứ tự listener: thông báo trực tiếp trước, theo dõi sau
    await notifications.onCommentAdded(ev);
    await watchers.onCommentAdded(ev);
    expect(rows.map((r) => r.type)).toEqual(['COMMENT_ADDED']);
  });

  it('3 bình luận liên tiếp của một người → 1 dòng COMMENT_ADDED count=3, excerpt mới nhất', async () => {
    const { rows, notifications } = setup({ watchers: [], assignee: 'u2' });
    for (const body of ['một', 'hai', 'ba'])
      await notifications.onCommentAdded({
        comment: { id: `c-${body}`, authorId: 'a1', body },
        issueId: 'i1',
        actorId: 'a1',
      });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({ count: 3, excerpt: 'ba' });
    expect(rows[0]!.commentId).toBe('c-ba');
  });

  it('nhiều người bình luận → gộp, actors khử trùng', async () => {
    const { rows, notifications } = setup({ watchers: [], assignee: 'u2' });
    for (const actorId of ['a1', 'a2', 'a1'])
      await notifications.onCommentAdded({
        comment: { id: 'c', authorId: actorId, body: 'x' },
        issueId: 'i1',
        actorId,
      });
    expect(rows).toHaveLength(1);
    expect((rows[0]!.payload.actors as unknown[]).length).toBe(2);
    expect(rows[0]!.payload.count).toBe(3);
  });
});

describe('ISSUE_UPDATED giao việc hàng loạt (L28 fix)', () => {
  it('bulk: true → không tạo thông báo "được giao" cho từng việc (producer gửi một thông báo gộp)', async () => {
    const { rows, notifications } = setup({ watchers: [] });
    const assigned = { ...issue, assigneeId: 'u2', description: null };
    await notifications.onIssueUpdated({
      issue: assigned,
      actorId: 'a1',
      changedFields: ['assigneeId'],
      bulk: true,
    });
    expect(rows).toHaveLength(0);
    // không có cờ: vẫn báo như cũ
    await notifications.onIssueUpdated({
      issue: assigned,
      actorId: 'a1',
      changedFields: ['assigneeId'],
    });
    expect(rows.map((r) => r.type)).toEqual(['ISSUE_ASSIGNED']);
  });

  it('publish giữ `count` do producer gộp sẵn (thông báo "Bạn được giao N việc từ nhập Jira")', async () => {
    const { rows, notifications } = setup({ watchers: [] });
    await notifications.publish({
      recipientId: 'u2',
      workspaceId: 'w1',
      type: 'ISSUE_ASSIGNED',
      issueId: 'i1',
      actorId: 'a1',
      payload: { key: 'TP-1', count: 5, bulk: 'jira-import' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({ count: 5, bulk: 'jira-import' });
    // phát thường (không count) vẫn là 1
    await notifications.publish({
      recipientId: 'u3',
      workspaceId: 'w1',
      type: 'ISSUE_ASSIGNED',
      issueId: 'i2',
      actorId: 'a1',
      payload: { key: 'TP-2' },
    });
    expect(rows[1]!.payload).toMatchObject({ count: 1 });
  });
});

describe('WatchersService.onIssueUpdated — cập nhật hàng loạt (L28 fix)', () => {
  it('bulk: true → không báo người theo dõi từng việc; không có cờ vẫn báo', async () => {
    const { rows, watchers } = setup({ watchers: ['w1'] });
    await watchers.onIssueUpdated({
      issue,
      actorId: 'a1',
      changedFields: ['assigneeId'],
      bulk: true,
    });
    expect(rows).toHaveLength(0);
    await watchers.onIssueUpdated({ issue, actorId: 'a1', changedFields: ['assigneeId'] });
    expect(rows.map((r) => r.type)).toEqual(['WATCHING_UPDATE']);
  });
});

describe('Việc chưa duyệt (Triage) chưa báo "được giao" (S-I1)', () => {
  const pending = { ...issue, assigneeId: 'u2', triageState: 'PENDING' };

  it('ISSUE_CREATED của việc PENDING có assignee mặc định → không báo; việc thường/đã Nhận vẫn báo', async () => {
    const { rows, notifications } = setup({ watchers: [] });
    await notifications.onIssueCreated({ issue: pending, actorId: 'a1' });
    expect(rows).toHaveLength(0);
    await notifications.onIssueCreated({ issue: { ...pending, triageState: null }, actorId: 'a1' });
    await notifications.onIssueCreated({
      issue: { ...pending, triageState: 'ACCEPTED' },
      actorId: 'a1',
    });
    expect(rows.map((r) => r.type)).toEqual(['ISSUE_ASSIGNED', 'ISSUE_ASSIGNED']);
  });

  it('ISSUE_UPDATED khi đang PENDING không báo; khi Nhận (ACCEPTED + changedFields có assigneeId) báo ISSUE_ASSIGNED cho người được giao', async () => {
    const { rows, notifications } = setup({ watchers: [] });
    await notifications.onIssueUpdated({
      issue: pending,
      actorId: 'a1',
      changedFields: ['assigneeId'],
    });
    expect(rows).toHaveLength(0);
    await notifications.onIssueUpdated({
      issue: { ...pending, triageState: 'ACCEPTED' },
      actorId: 'a1',
      changedFields: ['triageState', 'assigneeId'],
    });
    expect(rows.map((r) => r.type)).toEqual(['ISSUE_ASSIGNED']);
    expect(rows[0]!.recipientId).toBe('u2');
  });

  it('người báo (watcher) nhận thông báo khi triage phát IssueDto đầy đủ (có workspaceId)', async () => {
    const { rows, watchers } = setup({ watchers: ['w1'] });
    await watchers.onIssueUpdated({
      issue: { ...issue, triageState: 'ACCEPTED' },
      actorId: 'a1',
      changedFields: ['triageState'],
    });
    expect(rows.map((r) => r.type)).toEqual(['WATCHING_UPDATE']);
    expect(rows[0]!.recipientId).toBe('w1');
  });
});
