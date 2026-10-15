import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS, type AutomationEventMeta, type CommentDto } from '@tirapro/types';
import { extractMentionIds, type CreateCommentInput } from '@tirapro/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { toUserDto } from '../../common/mappers/user.mapper';
import {
  ForbiddenAppException,
  NotFoundAppException,
  VersionConflictException,
} from '../../common/exceptions/app.exception';
import { assertIssueWritable } from '../../common/project-writable';
import { resolveMentionedMembers } from '../../common/mentions';

const commentInclude = { author: true } satisfies Prisma.CommentInclude;
type CommentRow = Prisma.CommentGetPayload<{ include: typeof commentInclude }>;

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async list(workspaceId: string, issueId: string): Promise<CommentDto[]> {
    await this.requireIssue(workspaceId, issueId);
    const rows = await this.prisma.comment.findMany({
      where: { issueId, deletedAt: null },
      include: commentInclude,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toDto(r));
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
      // Người được nhắc = token trong body ∪ mentionUserIds (client cũ / API key), lọc theo thành viên workspace.
      const mentionIds = await resolveMentionedMembers(
        tx,
        workspaceId,
        [...extractMentionIds(input.body), ...(input.mentionUserIds ?? [])],
        userId,
      );
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
    const { updated, fresh } = await this.prisma.$transaction(async (tx) => {
      const u = await tx.comment.update({
        where: { id: commentId },
        data: { body, isEdited: true, version: { increment: 1 } },
        include: commentInclude,
      });
      // Chỉ người CHƯA có dòng Mention của bình luận này mới được báo (sửa chính tả không báo lại).
      const existing = new Set(
        (
          await tx.mention.findMany({ where: { commentId }, select: { mentionedUserId: true } })
        ).map((m) => m.mentionedUserId),
      );
      const fresh = (
        await resolveMentionedMembers(tx, workspaceId, extractMentionIds(body), userId)
      ).filter((id) => !existing.has(id));
      if (fresh.length) {
        await tx.mention.createMany({
          data: fresh.map((mentionedUserId) => ({
            mentionedUserId,
            commentId,
            issueId: u.issueId,
          })),
          skipDuplicates: true,
        });
      }
      return { updated: u, fresh };
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
      author: c.author ? toUserDto(c.author) : null,
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
