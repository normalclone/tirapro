import { describe, expect, it, vi } from 'vitest';
import { DOMAIN_EVENTS } from '@tirapro/types';
import { CommentsService } from './comments.service';

type Row = {
  commentId: string;
  emoji: string;
  userId: string;
  createdAt: Date;
  user: { id: string; displayName: string } | null;
};

function make(opts: { archivedAt?: Date | null; commentExists?: boolean; rows?: Row[] } = {}) {
  const rows: Row[] = [...(opts.rows ?? [])];
  // Mô phỏng chỉ mục duy nhất (commentId, userId, emoji): `skipDuplicates` bỏ hàng đã có.
  const createMany = vi.fn(
    (a: { data: Array<Omit<Row, 'createdAt' | 'user'>>; skipDuplicates?: boolean }) => {
      let count = 0;
      for (const d of a.data) {
        const dup = rows.some(
          (r) => r.commentId === d.commentId && r.userId === d.userId && r.emoji === d.emoji,
        );
        if (dup) continue;
        rows.push({
          ...d,
          createdAt: new Date(2026, 9, 19, 10, 0, rows.length),
          user: { id: d.userId, displayName: `Tên ${d.userId}` },
        });
        count++;
      }
      return Promise.resolve({ count });
    },
  );
  const deleteMany = vi.fn((a: { where: { commentId: string; userId: string; emoji: string } }) => {
    const before = rows.length;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i]!;
      if (
        r.commentId === a.where.commentId &&
        r.userId === a.where.userId &&
        r.emoji === a.where.emoji
      )
        rows.splice(i, 1);
    }
    return Promise.resolve({ count: before - rows.length });
  });
  const findMany = vi.fn((a: { where: { commentId: { in: string[] } } }) =>
    Promise.resolve(rows.filter((r) => a.where.commentId.in.includes(r.commentId))),
  );
  const commentFindMany = vi.fn().mockResolvedValue([
    {
      id: 'c1',
      issueId: 'i1',
      authorId: 'a',
      author: null,
      body: 'x',
      bodyFormat: 'MARKDOWN',
      parentId: null,
      isEdited: false,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'c2',
      issueId: 'i1',
      authorId: 'a',
      author: null,
      body: 'y',
      bodyFormat: 'MARKDOWN',
      parentId: null,
      isEdited: false,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
  const commentFindFirst = vi
    .fn()
    .mockResolvedValue(
      opts.commentExists === false
        ? null
        : { id: 'c1', issueId: 'i1', authorId: 'a', version: 1, issue: { projectId: 'p1' } },
    );
  const prisma = {
    comment: { findFirst: commentFindFirst, findMany: commentFindMany },
    commentReaction: { createMany, deleteMany, findMany },
    issue: {
      findFirst: vi.fn().mockResolvedValue({ id: 'i1', projectId: 'p1' }),
      findUnique: vi.fn().mockResolvedValue({ project: { archivedAt: opts.archivedAt ?? null } }),
    },
  };
  const events = { emit: vi.fn() };
  const service = new CommentsService(prisma as never, events as never, {} as never);
  return {
    service,
    prisma,
    events,
    rows,
    createMany,
    deleteMany,
    findMany,
    commentFindFirst,
    commentFindMany,
  };
}

describe('CommentsService.setReaction — thả/bỏ cảm xúc (idempotent)', () => {
  it('PUT: tạo một hàng, trả danh sách tóm tắt với `mine`, phát COMMENT_REACTED đúng 4 trường', async () => {
    const { service, events, createMany } = make();
    const out = await service.setReaction('w1', 'u1', 'c1', '👍', true);
    expect(createMany).toHaveBeenCalledWith({
      data: [{ commentId: 'c1', userId: 'u1', emoji: '👍' }],
      skipDuplicates: true,
    });
    expect(out).toEqual([
      { emoji: '👍', count: 1, mine: true, users: [{ id: 'u1', displayName: 'Tên u1' }] },
    ]);
    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith(DOMAIN_EVENTS.COMMENT_REACTED, {
      commentId: 'c1',
      issueId: 'i1',
      projectId: 'p1',
      actorId: 'u1',
    });
  });

  it('PUT hai lần liên tiếp (thử lại / bấm đôi): vẫn một hàng, count 1, chỉ phát sự kiện MỘT lần', async () => {
    const { service, events, rows } = make();
    await service.setReaction('w1', 'u1', 'c1', '👍', true);
    const again = await service.setReaction('w1', 'u1', 'c1', '👍', true);
    expect(rows).toHaveLength(1);
    expect(again[0]).toMatchObject({ emoji: '👍', count: 1, mine: true });
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('DELETE: bỏ hàng của CHÍNH MÌNH, người khác giữ nguyên; DELETE lặp lại không lỗi, không phát sự kiện thừa', async () => {
    const { service, events, rows } = make();
    await service.setReaction('w1', 'u2', 'c1', '👍', true);
    await service.setReaction('w1', 'u1', 'c1', '👍', true);
    events.emit.mockClear();
    const out = await service.setReaction('w1', 'u1', 'c1', '👍', false);
    expect(rows.map((r) => r.userId)).toEqual(['u2']);
    expect(out).toEqual([
      { emoji: '👍', count: 1, mine: false, users: [{ id: 'u2', displayName: 'Tên u2' }] },
    ]);
    expect(events.emit).toHaveBeenCalledTimes(1);
    events.emit.mockClear();
    await expect(service.setReaction('w1', 'u1', 'c1', '👍', false)).resolves.toBeDefined();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('một người thả được NHIỀU emoji khác nhau trên một bình luận', async () => {
    const { service, rows } = make();
    await service.setReaction('w1', 'u1', 'c1', '👍', true);
    const out = await service.setReaction('w1', 'u1', 'c1', '🎉', true);
    expect(rows).toHaveLength(2);
    expect(out.map((r) => r.emoji)).toEqual(['👍', '🎉']);
  });

  it('dự án lưu trữ => 422, KHÔNG ghi, KHÔNG phát sự kiện (cả thả lẫn bỏ)', async () => {
    const { service, createMany, deleteMany, events } = make({
      archivedAt: new Date('2026-10-01'),
    });
    await expect(service.setReaction('w1', 'u1', 'c1', '👍', true)).rejects.toMatchObject({
      status: 422,
    });
    await expect(service.setReaction('w1', 'u1', 'c1', '👍', false)).rejects.toMatchObject({
      status: 422,
    });
    expect(createMany).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('bình luận không có / đã xoá mềm / ngoài workspace => 404, không ghi', async () => {
    const { service, createMany, deleteMany, commentFindFirst } = make({ commentExists: false });
    await expect(service.setReaction('w1', 'u1', 'c1', '👍', true)).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.setReaction('w1', 'u1', 'c1', '👍', false)).rejects.toMatchObject({
      status: 404,
    });
    // requireComment phải lọc đúng: chưa xoá mềm + trong workspace
    expect(commentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1', deletedAt: null, issue: { workspaceId: 'w1' } },
      }),
    );
    expect(createMany).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('không phát thông báo (Notification) — sự kiện duy nhất là COMMENT_REACTED', async () => {
    const { service, events } = make();
    await service.setReaction('w1', 'u1', 'c1', '👍', true);
    expect(events.emit.mock.calls.map((c) => c[0] as string)).toEqual([
      DOMAIN_EVENTS.COMMENT_REACTED,
    ]);
  });
});

describe('CommentsService.list — reactions gộp một truy vấn cho cả trang', () => {
  it('đúng MỘT lần commentReaction.findMany cho mọi bình luận (không N+1), lọc theo id của trang', async () => {
    const { service, findMany } = make({
      rows: [
        {
          commentId: 'c1',
          emoji: '👍',
          userId: 'u1',
          createdAt: new Date(2026, 9, 19),
          user: { id: 'u1', displayName: 'A' },
        },
        {
          commentId: 'c2',
          emoji: '🎉',
          userId: 'u2',
          createdAt: new Date(2026, 9, 19),
          user: { id: 'u2', displayName: 'B' },
        },
      ],
    });
    const out = await service.list('w1', 'i1', 'u1');
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]![0]).toMatchObject({
      where: { commentId: { in: ['c1', 'c2'] } },
    });
    expect(out[0]!.reactions).toEqual([
      { emoji: '👍', count: 1, mine: true, users: [{ id: 'u1', displayName: 'A' }] },
    ]);
    expect(out[1]!.reactions).toEqual([
      { emoji: '🎉', count: 1, mine: false, users: [{ id: 'u2', displayName: 'B' }] },
    ]);
  });

  it('bình luận không ai thả → `reactions: []` (khoá luôn có trong danh sách)', async () => {
    const { service } = make();
    const out = await service.list('w1', 'i1', 'u1');
    expect(out.map((c) => c.reactions)).toEqual([[], []]);
  });

  it('danh sách rỗng → không truy vấn reaction', async () => {
    const { service, findMany, commentFindMany } = make();
    commentFindMany.mockResolvedValue([]);
    await expect(service.list('w1', 'i1', 'u1')).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
