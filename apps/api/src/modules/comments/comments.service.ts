import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DOMAIN_EVENTS,
  type AutomationEventMeta,
  type CommentDto,
  type CommentReactionDto,
} from '@tirapro/types';
import {
  extractMentionIds,
  MENTION_LIMIT,
  type CommentReactionEmoji,
  type CreateCommentInput,
} from '@tirapro/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { toUserRefDto } from '../../common/mappers/user.mapper';
import {
  ForbiddenAppException,
  NotFoundAppException,
  VersionConflictException,
} from '../../common/exceptions/app.exception';
import { assertIssueWritable } from '../../common/project-writable';
import { resolveMentionedMembers } from '../../common/mentions';
import { ProjectAccessService } from '../rbac/project-access.service';
import { summarizeReactions } from './comment-reactions';

const commentInclude = { author: true } satisfies Prisma.CommentInclude;
type CommentRow = Prisma.CommentGetPayload<{ include: typeof commentInclude }>;

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly access: ProjectAccessService,
  ) {}

  /**
   * Người được @nhắc phải XEM ĐƯỢC dự án của việc (dự án riêng tư). Lọc TRƯỚC khi ghi sổ `Mention`: người chưa thấy dự án
   * mà vẫn bị ghi sổ thì khi được thêm vào dự án sau đó, lần sửa bình luận kế tiếp sẽ không coi họ là "mới" nên không báo.
   */
  private async mentionableIn(
    workspaceId: string,
    projectId: string,
    userIds: string[],
  ): Promise<string[]> {
    const ok = await Promise.all(
      userIds.map((id) => this.access.canSee(id, workspaceId, projectId)),
    );
    return userIds.filter((_, i) => ok[i]);
  }

  /** `viewerId` để tính `reactions[].mine` (trường theo người xem — vì vậy KHÔNG nằm trong DTO phát qua WS). */
  async list(workspaceId: string, issueId: string, viewerId: string): Promise<CommentDto[]> {
    await this.requireIssue(workspaceId, issueId);
    const rows = await this.prisma.comment.findMany({
      where: { issueId, deletedAt: null },
      include: commentInclude,
      orderBy: { createdAt: 'asc' },
    });
    const reactions = await this.reactionsFor(
      rows.map((r) => r.id),
      viewerId,
    );
    return rows.map((r) => ({ ...this.toDto(r), reactions: reactions.get(r.id) ?? [] }));
  }

  /** MỘT truy vấn cho cả trang bình luận (không N+1); rỗng thì khỏi truy vấn. Chỉ gọi với id đã thuộc một issue đã qua guard. */
  private async reactionsFor(
    commentIds: string[],
    viewerId: string,
  ): Promise<Map<string, CommentReactionDto[]>> {
    if (commentIds.length === 0) return new Map();
    const rows = await this.prisma.commentReaction.findMany({
      where: { commentId: { in: commentIds } },
      select: {
        commentId: true,
        emoji: true,
        userId: true,
        createdAt: true,
        user: { select: { id: true, displayName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return summarizeReactions(rows, viewerId);
  }

  /**
   * Bật (`on`) / tắt cảm xúc của CHÍNH người gọi trên một bình luận — idempotent: bật = INSERT … ON CONFLICT DO NOTHING
   * (`createMany` + `skipDuplicates`, an toàn khi hai tab bấm cùng lúc), tắt = `deleteMany` của đúng (comment, user, emoji).
   * Lặp lại không lỗi và không phát sự kiện thừa. Trả danh sách tóm tắt MỚI của bình luận (bản máy chủ xác nhận để FE rollback).
   * Quyền: ai XEM được việc (route `PROJECT_VIEW` + `@ProjectRef('comment')`, người ngoài dự án riêng tư → 404); dự án lưu
   * trữ là chỉ đọc (422). KHÔNG tạo thông báo (tránh spam — quyết định sản phẩm: reaction chỉ hiện trên bình luận + realtime).
   */
  async setReaction(
    workspaceId: string,
    userId: string,
    commentId: string,
    emoji: CommentReactionEmoji,
    on: boolean,
  ): Promise<CommentReactionDto[]> {
    const current = await this.requireComment(workspaceId, commentId);
    await assertIssueWritable(this.prisma, current.issueId);
    const { count } = on
      ? await this.prisma.commentReaction.createMany({
          data: [{ commentId, userId, emoji }],
          skipDuplicates: true,
        })
      : await this.prisma.commentReaction.deleteMany({ where: { commentId, userId, emoji } });
    if (count > 0)
      this.events.emit(DOMAIN_EVENTS.COMMENT_REACTED, {
        commentId,
        issueId: current.issueId,
        projectId: current.issue.projectId,
        actorId: userId,
      });
    return (await this.reactionsFor([commentId], userId)).get(commentId) ?? [];
  }

  async create(
    workspaceId: string,
    userId: string,
    issueId: string,
    input: CreateCommentInput,
    meta?: AutomationEventMeta,
  ): Promise<CommentDto> {
    const issue = await this.requireIssue(workspaceId, issueId);
    await assertIssueWritable(this.prisma, issueId);
    // Người được nhắc = token trong body ∪ mentionUserIds (client cũ / API key), lọc theo thành viên workspace và quyền xem
    // dự án. Tính TRƯỚC khi mở transaction: không giữ một connection của pool trong lúc truy vấn bằng `this.prisma`.
    const mentionIds = (
      await this.mentionableIn(
        workspaceId,
        issue.projectId,
        await resolveMentionedMembers(
          this.prisma,
          workspaceId,
          [...extractMentionIds(input.body), ...(input.mentionUserIds ?? [])],
          userId,
        ),
      )
    ).slice(0, MENTION_LIMIT); // hợp hai nguồn có thể tới 40 → cắt về 20
    const comment = await this.prisma.$transaction(async (tx) => {
      const c = await tx.comment.create({
        data: {
          issueId,
          authorId: userId,
          body: input.body,
          bodyFormat: input.bodyFormat,
          parentId: input.parentId ?? null,
        },
        include: commentInclude,
      });
      if (mentionIds.length) {
        await tx.mention.createMany({
          data: mentionIds.map((mentionedUserId) => ({
            mentionedUserId,
            commentId: c.id,
            issueId,
          })),
          skipDuplicates: true,
        });
      }
      return { c, mentionIds };
    });
    const dto = this.toDto(comment.c);
    this.events.emit(DOMAIN_EVENTS.COMMENT_ADDED, {
      comment: dto,
      issueId,
      projectId: issue.projectId,
      actorId: userId,
      mentionIds: comment.mentionIds,
      ...(meta ? { meta } : {}),
    });
    return dto;
  }

  async update(
    workspaceId: string,
    userId: string,
    commentId: string,
    body: string,
    version: number,
  ): Promise<CommentDto> {
    const current = await this.requireComment(workspaceId, commentId);
    await assertIssueWritable(this.prisma, current.issueId);
    if (current.authorId !== userId)
      throw new ForbiddenAppException('Chỉ tác giả mới sửa được bình luận');
    if (current.version !== version)
      throw new VersionConflictException(
        'Người khác vừa sửa bình luận này — hãy tải lại để xem bản mới nhất',
      );
    // Ứng viên @nhắc tính TRƯỚC khi mở transaction (không gọi `this.prisma` bên trong tx đang giữ connection).
    const candidates = (
      await this.mentionableIn(
        workspaceId,
        current.issue.projectId,
        await resolveMentionedMembers(this.prisma, workspaceId, extractMentionIds(body), userId),
      )
    ).slice(0, MENTION_LIMIT);
    const { updated, fresh } = await this.prisma.$transaction(async (tx) => {
      // OCC nguyên tử: điều kiện `version` nằm TRONG câu UPDATE — hai lần ghi đồng thời (hai tab, hai cú tick)
      // thì chỉ một bên khớp, bên kia count=0 → 409 (kiểm ở ngoài transaction chỉ là fast-fail).
      const w = await tx.comment.updateMany({
        where: { id: commentId, version },
        data: { body, isEdited: true, version: { increment: 1 } },
      });
      if (w.count === 0)
        throw new VersionConflictException(
          'Người khác vừa sửa bình luận này — hãy tải lại để xem bản mới nhất',
        );
      const u = await tx.comment.findUniqueOrThrow({
        where: { id: commentId },
        include: commentInclude,
      });
      // Sổ "đã báo ai": chèn tất cả ứng viên với ON CONFLICT DO NOTHING (chỉ mục duy nhất commentId+người);
      // chỉ những dòng THỰC SỰ được chèn mới là người mới → không báo đôi kể cả khi hai lần sửa chạy song song.
      const inserted = candidates.length
        ? await tx.mention.createManyAndReturn({
            data: candidates.map((mentionedUserId) => ({
              mentionedUserId,
              commentId,
              issueId: u.issueId,
            })),
            skipDuplicates: true,
            select: { mentionedUserId: true },
          })
        : [];
      return { updated: u, fresh: inserted.map((m) => m.mentionedUserId) };
    });
    const dto = this.toDto(updated);
    this.events.emit(DOMAIN_EVENTS.COMMENT_UPDATED, {
      comment: dto,
      issueId: updated.issueId,
      projectId: current.issue.projectId,
      actorId: userId,
      newMentionIds: fresh,
    });
    return dto;
  }

  async softDelete(
    workspaceId: string,
    userId: string,
    commentId: string,
    canDeleteAny = false,
  ): Promise<{ success: true }> {
    const current = await this.requireComment(workspaceId, commentId);
    await assertIssueWritable(this.prisma, current.issueId);
    if (current.authorId !== userId && !canDeleteAny) {
      throw new ForbiddenAppException(
        'Chỉ tác giả hoặc người có quyền xoá bình luận mới xoá được bình luận này',
      );
    }
    await this.prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
    this.events.emit(DOMAIN_EVENTS.COMMENT_DELETED, {
      commentId,
      issueId: current.issueId,
      projectId: current.issue.projectId,
      actorId: userId,
    });
    return { success: true };
  }

  private async requireIssue(workspaceId: string, issueId: string) {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, workspaceId, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (!issue) throw new NotFoundAppException('Công việc');
    return issue;
  }

  private async requireComment(workspaceId: string, commentId: string) {
    const c = await this.prisma.comment.findFirst({
      where: { id: commentId, deletedAt: null, issue: { workspaceId } },
      include: { issue: { select: { projectId: true } } },
    });
    if (!c) throw new NotFoundAppException('Bình luận');
    return c;
  }

  private toDto(c: CommentRow): CommentDto {
    return {
      id: c.id,
      issueId: c.issueId,
      authorId: c.authorId,
      author: c.author ? toUserRefDto(c.author) : null,
      body: c.body,
      bodyFormat: c.bodyFormat,
      parentId: c.parentId,
      isEdited: c.isEdited,
      version: c.version,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }
}
