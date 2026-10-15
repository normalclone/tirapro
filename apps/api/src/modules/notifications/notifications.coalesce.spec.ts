import { describe, expect, it, vi } from 'vitest';
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
      update: vi.fn((a: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((r) => r.id === a.where.id)!;
        Object.assign(row, a.data);
        return Promise.resolve(row);
      }),
    },
    issueWatcher: {
      findMany: vi.fn(() => Promise.resolve(opts.watchers.map((userId) => ({ userId })))),
    },
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
  );
  const watchers = new WatchersService(prisma as never, notifications);
  return { rows, notifications, watchers, events };
}

const issue = { id: 'i1', workspaceId: 'w1', key: 'TP-1', summary: 'Sửa lỗi' };

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
