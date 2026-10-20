/* eslint-disable max-lines-per-function -- spec tích hợp: một describe lớn dùng chung dữ liệu nạp một lần */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { COMMENT_REACTION_EMOJIS } from '@tirapro/shared';
import { assertParityDatabase } from '../../common/testing/parity-db-guard';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { CommentsService } from './comments.service';

/**
 * Reaction bình luận (077) TRÊN POSTGRES THẬT — OPT-IN, không chạy trong `pnpm test`. Spec thường mock Prisma nên không chứng
 * minh được: chỉ mục duy nhất (commentId,userId,emoji) chặn trùng và `createMany(skipDuplicates)` an toàn khi bấm đồng thời,
 * xoá bình luận / xoá người dùng kéo theo reaction (ON DELETE CASCADE), `list` gom reaction bằng ĐÚNG MỘT truy vấn.
 *
 * Chạy: `PARITY_DATABASE_URL=postgresql://…/projira_w2c?schema=public pnpm --filter @tirapro/api test:parity`.
 * Mọi hàng mang TAG và được dọn ở afterAll.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

describe.skipIf(!DB_URL)('CommentReaction ↔ Postgres thật', () => {
  const TAG = `rxn${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const id = (n: string) => `${TAG}-${n}`;
  const WS = id('ws');
  const U = { owner: id('owner'), a: id('ua'), b: id('ub') };
  const PROJECT = id('proj');
  const ISSUE = id('issue');
  const C = { main: id('c-main'), second: id('c-second'), gone: id('c-gone') };

  let prisma: PrismaClient;
  let svc: CommentsService;
  const emit = vi.fn();
  const queries: string[] = [];

  const countOf = (commentId: string, emoji?: string) =>
    prisma.commentReaction.count({ where: { commentId, ...(emoji ? { emoji } : {}) } });

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: DB_URL! } },
      log: [{ emit: 'event', level: 'query' }],
    });
    (prisma as unknown as { $on: (e: string, cb: (q: { query: string }) => void) => void }).$on(
      'query',
      (q) => queries.push(q.query),
    );
    for (const uid of Object.values(U)) {
      await prisma.user.create({
        data: { id: uid, email: `${uid}@reaction.test`, displayName: `Tên ${uid.slice(-2)}` },
      });
    }
    await prisma.workspace.create({ data: { id: WS, name: TAG, slug: TAG, ownerId: U.owner } });
    await prisma.project.create({
      data: { id: PROJECT, workspaceId: WS, key: 'RXN', name: TAG, createdById: U.owner },
    });
    const wf = await prisma.workflow.create({ data: { id: id('wf'), workspaceId: WS, name: TAG } });
    const status = await prisma.status.create({
      data: { id: id('st'), workflowId: wf.id, name: 'Mới', category: 'TODO', isInitial: true },
    });
    const type = await prisma.issueType.create({
      data: { id: id('type'), workspaceId: WS, name: TAG },
    });
    await prisma.issue.create({
      data: {
        id: ISSUE,
        workspaceId: WS,
        projectId: PROJECT,
        number: 1,
        key: 'RXN-1',
        typeId: type.id,
        statusId: status.id,
        summary: 'Việc thử reaction',
        rank: '0|aaaaaa:',
      },
    });
    for (const cid of Object.values(C)) {
      await prisma.comment.create({
        data: {
          id: cid,
          issueId: ISSUE,
          authorId: U.owner,
          body: 'bình luận',
          bodyFormat: 'MARKDOWN',
        },
      });
    }
    svc = new CommentsService(
      prisma as unknown as PrismaService,
      { emit } as never,
      { canSee: vi.fn().mockResolvedValue(true) } as never,
    );
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    const like = { startsWith: TAG };
    await prisma.commentReaction.deleteMany({ where: { commentId: like } });
    await prisma.comment.deleteMany({ where: { id: like } });
    await prisma.issue.deleteMany({ where: { id: like } });
    await prisma.status.deleteMany({ where: { id: like } });
    await prisma.workflow.deleteMany({ where: { id: like } });
    await prisma.issueType.deleteMany({ where: { id: like } });
    await prisma.project.deleteMany({ where: { id: like } });
    await prisma.workspace.deleteMany({ where: { id: like } });
    await prisma.user.deleteMany({ where: { id: like } });
    await prisma.$disconnect();
  }, 60_000);

  it('chỉ mục duy nhất (commentId,userId,emoji): chèn trùng bị Postgres từ chối (P2002), emoji khác thì được', async () => {
    await prisma.commentReaction.create({
      data: { commentId: C.second, userId: U.a, emoji: '👍' },
    });
    await expect(
      prisma.commentReaction.create({ data: { commentId: C.second, userId: U.a, emoji: '👍' } }),
    ).rejects.toMatchObject({
      code: 'P2002',
    } satisfies Partial<Prisma.PrismaClientKnownRequestError>);
    await prisma.commentReaction.create({
      data: { commentId: C.second, userId: U.a, emoji: '🎉' },
    });
    expect(await countOf(C.second)).toBe(2);
    await prisma.commentReaction.deleteMany({ where: { commentId: C.second } });
  });

  it('cả 6 emoji của bảng cố định vừa cột VarChar(16) (kể cả ❤️ có FE0F)', async () => {
    for (const e of COMMENT_REACTION_EMOJIS)
      await prisma.commentReaction.create({ data: { commentId: C.second, userId: U.b, emoji: e } });
    expect(await countOf(C.second)).toBe(6);
    await prisma.commentReaction.deleteMany({ where: { commentId: C.second } });
  });

  it('PUT đồng thời (5 request cùng lúc) → không lỗi, đúng MỘT hàng; lặp lại vẫn một hàng', async () => {
    await Promise.all(
      Array.from({ length: 5 }, () => svc.setReaction(WS, U.a, C.main, '👍', true)),
    );
    expect(await countOf(C.main, '👍')).toBe(1);
    const again = await svc.setReaction(WS, U.a, C.main, '👍', true);
    expect(again).toEqual([
      {
        emoji: '👍',
        count: 1,
        mine: true,
        users: [{ id: U.a, displayName: expect.any(String) as string }],
      },
    ]);
  });

  it('DELETE chỉ xoá hàng của chính mình; DELETE lặp lại không lỗi', async () => {
    await svc.setReaction(WS, U.b, C.main, '👍', true);
    const out = await svc.setReaction(WS, U.a, C.main, '👍', false);
    expect(out[0]).toMatchObject({ emoji: '👍', count: 1, mine: false });
    await expect(svc.setReaction(WS, U.a, C.main, '👍', false)).resolves.toBeDefined();
    expect(await countOf(C.main, '👍')).toBe(1);
  });

  it('list gom reaction bằng ĐÚNG MỘT truy vấn CommentReaction cho cả trang (không N+1)', async () => {
    await svc.setReaction(WS, U.a, C.second, '🎉', true);
    queries.length = 0;
    const out = await svc.list(WS, ISSUE, U.a);
    const reactionSelects = queries.filter((q) => /FROM "public"."CommentReaction"/.test(q));
    expect(reactionSelects).toHaveLength(1);
    const byId = new Map(out.map((c) => [c.id, c.reactions]));
    expect(byId.get(C.main)).toEqual([
      {
        emoji: '👍',
        count: 1,
        mine: false,
        users: [{ id: U.b, displayName: expect.any(String) as string }],
      },
    ]);
    expect(byId.get(C.second)).toMatchObject([{ emoji: '🎉', count: 1, mine: true }]);
    expect(byId.get(C.gone)).toEqual([]);
  });

  it('xoá mềm bình luận → thả cảm xúc 404 và không ghi gì', async () => {
    await prisma.comment.update({ where: { id: C.gone }, data: { deletedAt: new Date() } });
    await expect(svc.setReaction(WS, U.a, C.gone, '👍', true)).rejects.toMatchObject({
      status: 404,
    });
    expect(await countOf(C.gone)).toBe(0);
    // list không trả bình luận đã xoá mềm
    expect((await svc.list(WS, ISSUE, U.a)).map((c) => c.id)).not.toContain(C.gone);
  });

  it('bình luận của không gian làm việc khác → 404 (không thả chéo)', async () => {
    await expect(svc.setReaction(id('ws-khac'), U.a, C.main, '👍', true)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('dự án lưu trữ → 422 và không ghi (cả thả lẫn bỏ)', async () => {
    await prisma.project.update({ where: { id: PROJECT }, data: { archivedAt: new Date() } });
    try {
      const before = await countOf(C.main);
      await expect(svc.setReaction(WS, U.a, C.main, '🎉', true)).rejects.toMatchObject({
        status: 422,
      });
      await expect(svc.setReaction(WS, U.b, C.main, '👍', false)).rejects.toMatchObject({
        status: 422,
      });
      expect(await countOf(C.main)).toBe(before);
    } finally {
      await prisma.project.update({ where: { id: PROJECT }, data: { archivedAt: null } });
    }
  });

  it('xoá người dùng → reaction của người đó biến mất, của người khác còn (ON DELETE CASCADE)', async () => {
    const tmp = id('tmp-user');
    await prisma.user.create({
      data: { id: tmp, email: `${tmp}@reaction.test`, displayName: 'Tạm' },
    });
    await prisma.commentReaction.create({ data: { commentId: C.main, userId: tmp, emoji: '👀' } });
    const before = await countOf(C.main);
    await prisma.user.delete({ where: { id: tmp } });
    expect(await countOf(C.main)).toBe(before - 1);
    expect(await countOf(C.main, '👍')).toBe(1);
  });

  it('xoá cứng bình luận → toàn bộ reaction của nó biến mất (ON DELETE CASCADE), bình luận khác còn nguyên', async () => {
    expect(await countOf(C.main)).toBeGreaterThan(0);
    const other = await countOf(C.second);
    await prisma.comment.delete({ where: { id: C.main } });
    expect(await countOf(C.main)).toBe(0);
    expect(await countOf(C.second)).toBe(other);
  });
});
