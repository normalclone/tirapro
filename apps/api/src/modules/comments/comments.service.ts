import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS, type CommentDto } from '@tirapro/types';
import type { CreateCommentInput } from '@tirapro/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ForbiddenAppException, NotFoundAppException, VersionConflictException } from '../../common/exceptions/app.exception';

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

  async create(workspaceId: string, userId: string, issueId: string, input: CreateCommentInput): Promise<CommentDto> {
    const issue = await this.requireIssue(workspaceId, issueId);
    const comment = await this.prisma.$transaction(async (tx) => {
      const c = await tx.comment.create({
        data: { issueId, authorId: userId, body: input.body, bodyFormat: input.bodyFormat, parentId: input.parentId ?? null },
        include: commentInclude,
      });
      const mentionIds = [...new Set(input.mentionUserIds ?? [])];
      if (mentionIds.length) {
        await tx.mention.createMany({
          data: mentionIds.map((mentionedUserId) => ({ mentionedUserId, commentId: c.id, issueId })),
          skipDuplicates: true,
        });
      }
      return { c, mentionIds };
    });
    const dto = this.toDto(comment.c);
    this.events.emit(DOMAIN_EVENTS.COMMENT_ADDED, { comment: dto, issueId, projectId: issue.projectId, actorId: userId, mentionIds: comment.mentionIds });
    return dto;
  }

  async update(workspaceId: string, userId: string, commentId: string, body: string, version: number): Promise<CommentDto> {
    const current = await this.requireComment(workspaceId, commentId);
    if (current.authorId !== userId) throw new ForbiddenAppException('Chỉ tác giả mới sửa được bình luận');
    if (current.version !== version) throw new VersionConflictException('Bình luận đã thay đổi, hãy tải lại');
    const updated = await this.prisma.comment.update({
      where: { id: commentId },
      data: { body, isEdited: true, version: { increment: 1 } },
      include: commentInclude,
    });
    const dto = this.toDto(updated);
    this.events.emit(DOMAIN_EVENTS.COMMENT_UPDATED, { comment: dto, issueId: updated.issueId, actorId: userId });
    return dto;
  }

  async softDelete(workspaceId: string, userId: string, commentId: string): Promise<{ success: true }> {
    const current = await this.requireComment(workspaceId, commentId);
    await this.prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
    this.events.emit(DOMAIN_EVENTS.COMMENT_DELETED, { commentId, issueId: current.issueId, actorId: userId });
    return { success: true };
  }

  private async requireIssue(workspaceId: string, issueId: string) {
    const issue = await this.prisma.issue.findFirst({ where: { id: issueId, workspaceId, deletedAt: null }, select: { id: true, projectId: true } });
    if (!issue) throw new NotFoundAppException('Issue');
    return issue;
  }

  private async requireComment(workspaceId: string, commentId: string) {
    const c = await this.prisma.comment.findFirst({ where: { id: commentId, deletedAt: null, issue: { workspaceId } } });
    if (!c) throw new NotFoundAppException('Bình luận');
    return c;
  }

  private toDto(c: CommentRow): CommentDto {
    return {
      id: c.id,
      issueId: c.issueId,
      authorId: c.authorId,
      author: c.author
        ? { id: c.author.id, email: c.author.email, displayName: c.author.displayName, avatarUrl: c.author.avatarUrl, timezone: c.author.timezone, locale: c.author.locale, status: c.author.status, isSystemAdmin: c.author.isSystemAdmin, lastSeenAt: c.author.lastSeenAt?.toISOString() ?? null, createdAt: c.author.createdAt.toISOString() }
        : null,
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
