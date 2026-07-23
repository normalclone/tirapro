import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS } from '@tirapro/types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotFoundAppException } from '../../common/exceptions/app.exception';

/** User tối thiểu trả về cho client trong danh sách watcher. */
export interface WatcherUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Issue tối thiểu kèm trong payload của các domain event issue.*. */
interface IssueEventShape {
  id: string;
  workspaceId: string;
  key: string;
  summary: string;
}

interface IssueEventPayload {
  issue: IssueEventShape;
  actorId: string;
}

interface CommentAddedPayload {
  comment: { id: string; authorId: string };
  issueId: string;
  actorId?: string;
}

/**
 * Watchers: theo dõi / bỏ theo dõi issue, liệt kê người theo dõi.
 * Đồng thời là PRODUCER: lắng nghe các domain event của issue và tạo
 * Notification loại WATCHING_UPDATE cho mọi watcher (trừ chính người thực hiện).
 *
 * Chỉ inject PrismaService — module này lắng nghe sự kiện, không phát.
 */
@Injectable()
export class WatchersService {
  private readonly logger = new Logger(WatchersService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------- COMMANDS / QUERIES (luôn scope theo workspace của user) ----------

  /** Theo dõi issue trên danh nghĩa của chính user. Idempotent (nuốt P2002). */
  async watch(workspaceId: string, userId: string, issueId: string): Promise<{ watching: true }> {
    await this.requireIssue(workspaceId, issueId);
    try {
      await this.prisma.issueWatcher.create({ data: { issueId, userId } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      // Đã theo dõi rồi — coi như thành công.
    }
    return { watching: true };
  }

  /** Bỏ theo dõi issue. Idempotent (xóa không có cũng coi như thành công). */
  async unwatch(workspaceId: string, userId: string, issueId: string): Promise<{ watching: false }> {
    await this.requireIssue(workspaceId, issueId);
    await this.prisma.issueWatcher.deleteMany({ where: { issueId, userId } });
    return { watching: false };
  }

  /** Danh sách người theo dõi issue + cờ isWatching cho user hiện tại. */
  async list(
    workspaceId: string,
    userId: string,
    issueId: string,
  ): Promise<{ watchers: WatcherUser[]; isWatching: boolean }> {
    await this.requireIssue(workspaceId, issueId);
    const rows = await this.prisma.issueWatcher.findMany({
      where: { issueId },
      select: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
      orderBy: { user: { displayName: 'asc' } },
    });
    const watchers = rows.map((r) => ({
      id: r.user.id,
      displayName: r.user.displayName,
      avatarUrl: r.user.avatarUrl,
    }));
    return { watchers, isWatching: watchers.some((w) => w.id === userId) };
  }

  /** User hiện tại có đang theo dõi issue không. */
  async isWatching(workspaceId: string, userId: string, issueId: string): Promise<{ watching: boolean }> {
    await this.requireIssue(workspaceId, issueId);
    const found = await this.prisma.issueWatcher.findUnique({
      where: { issueId_userId: { issueId, userId } },
      select: { userId: true },
    });
    return { watching: found !== null };
  }

  // ---------- PRODUCER: domain event -> Notification(WATCHING_UPDATE) ----------
  // Watcher là tín hiệu riêng, song song với ASSIGNED/STATUS_CHANGED của notifications module.
  // KHÔNG thông báo cho chính người thực hiện (actor). Mỗi handler bọc try/catch,
  // tuyệt đối không làm vỡ luồng phát sự kiện.

  @OnEvent(DOMAIN_EVENTS.ISSUE_UPDATED)
  async onIssueUpdated(payload: unknown): Promise<void> {
    try {
      const { issue, actorId } = payload as IssueEventPayload;
      if (!issue?.id) return;
      await this.notifyWatchers(issue, actorId);
    } catch (err) {
      this.logger.warn(`onIssueUpdated thất bại: ${this.errMsg(err)}`);
    }
  }

  @OnEvent(DOMAIN_EVENTS.ISSUE_TRANSITIONED)
  async onIssueTransitioned(payload: unknown): Promise<void> {
    try {
      const { issue, actorId } = payload as IssueEventPayload;
      if (!issue?.id) return;
      await this.notifyWatchers(issue, actorId);
    } catch (err) {
      this.logger.warn(`onIssueTransitioned thất bại: ${this.errMsg(err)}`);
    }
  }

  @OnEvent(DOMAIN_EVENTS.COMMENT_ADDED)
  async onCommentAdded(payload: unknown): Promise<void> {
    try {
      const { comment, issueId, actorId } = payload as CommentAddedPayload;
      const author = actorId ?? comment?.authorId;
      if (!issueId) return;
      const issue = await this.prisma.issue.findFirst({
        where: { id: issueId, deletedAt: null },
        select: { id: true, workspaceId: true, key: true, summary: true },
      });
      if (!issue) return;
      await this.notifyWatchers(issue, author);
    } catch (err) {
      this.logger.warn(`onCommentAdded thất bại: ${this.errMsg(err)}`);
    }
  }

  // ---------- helpers ----------

  /**
   * Lấy watcher của issue, tạo Notification cho mỗi người (trừ actor).
   * Bỏ qua nếu không có watcher nào.
   */
  private async notifyWatchers(issue: IssueEventShape, actorId: string | undefined): Promise<void> {
    const watchers = await this.prisma.issueWatcher.findMany({
      where: { issueId: issue.id },
      select: { userId: true },
    });
    const recipients = watchers
      .map((w) => w.userId)
      .filter((userId) => userId !== actorId);
    if (recipients.length === 0) return;

    const payload: Prisma.InputJsonValue = { key: issue.key, summary: issue.summary };
    await this.prisma.notification.createMany({
      data: recipients.map((recipientId) => ({
        recipientId,
        workspaceId: issue.workspaceId,
        type: 'WATCHING_UPDATE' as const,
        issueId: issue.id,
        actorId: actorId ?? null,
        payload,
      })),
    });
  }

  /** Issue phải thuộc workspace của user và chưa xóa mềm. */
  private async requireIssue(workspaceId: string, issueId: string): Promise<{ id: string }> {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!issue) throw new NotFoundAppException('Issue');
    return issue;
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
