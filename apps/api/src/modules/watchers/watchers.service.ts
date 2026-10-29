import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS } from '@tirapro/types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { assertIssueWritable } from '../../common/project-writable';
import { NotificationsService } from '../notifications/notifications.service';

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
 * Tạo thông báo qua `NotificationsService.publish` (gộp 60 s, realtime); module này lắng nghe sự kiện, không phát.
 */
@Injectable()
export class WatchersService {
  private readonly logger = new Logger(WatchersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- COMMANDS / QUERIES (luôn scope theo workspace của user) ----------

  /** Theo dõi issue trên danh nghĩa của chính user. Idempotent (nuốt P2002). */
  async watch(workspaceId: string, userId: string, issueId: string): Promise<{ watching: true }> {
    await this.requireIssue(workspaceId, issueId);
    await assertIssueWritable(this.prisma, issueId);
    try {
      await this.prisma.issueWatcher.create({ data: { issueId, userId } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      // Đã theo dõi rồi — coi như thành công.
    }
    return { watching: true };
  }

  /** Bỏ theo dõi issue. Idempotent (xóa không có cũng coi như thành công). */
  async unwatch(
    workspaceId: string,
    userId: string,
    issueId: string,
  ): Promise<{ watching: false }> {
    await this.requireIssue(workspaceId, issueId);
    await assertIssueWritable(this.prisma, issueId);
    await this.prisma.issueWatcher.deleteMany({ where: { issueId, userId } });
    return { watching: false };
  }

  /**
   * Danh sách người theo dõi issue + cờ isWatching cho user hiện tại.
   * Chỉ trả người CÒN nhận được thông báo — cùng luật với cổng trung tâm của `NotificationsService` (`filterCanSee`):
   * xem được dự án của issue và tài khoản chưa bị vô hiệu hoá. Dòng `IssueWatcher` không bị xoá khi người đó mất quyền
   * (người báo ngoài nhóm do intake/triage tự thêm, người rời dự án riêng tư, tài khoản bị khoá), nên không lọc thì
   * danh sách vừa lộ tên người đã rời vừa hứa thông báo sẽ không bao giờ tới.
   */
  async list(
    workspaceId: string,
    userId: string,
    issueId: string,
  ): Promise<{ watchers: WatcherUser[]; isWatching: boolean }> {
    const issue = await this.requireIssue(workspaceId, issueId);
    const rows = await this.prisma.issueWatcher.findMany({
      where: { issueId, user: { status: { not: 'DEACTIVATED' } } },
      select: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
      orderBy: { user: { displayName: 'asc' } },
    });
    const visible = new Set(
      await this.notifications.filterCanSee(
        rows.map((r) => r.user.id),
        workspaceId,
        issue.projectId,
      ),
    );
    const watchers = rows
      .filter((r) => visible.has(r.user.id))
      .map((r) => ({
        id: r.user.id,
        displayName: r.user.displayName,
        avatarUrl: r.user.avatarUrl,
      }));
    return { watchers, isWatching: watchers.some((w) => w.id === userId) };
  }

  /** User hiện tại có đang theo dõi issue không. */
  async isWatching(
    workspaceId: string,
    userId: string,
    issueId: string,
  ): Promise<{ watching: boolean }> {
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
      const { issue, actorId, bulk } = payload as IssueEventPayload & { bulk?: boolean };
      // Cập nhật hàng loạt (vd tự gán việc Jira): producer tự báo gộp, không báo từng việc cho người theo dõi.
      if (bulk) return;
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
    const recipients = watchers.map((w) => w.userId).filter((userId) => userId !== actorId);
    if (recipients.length === 0) return;

    // Qua cùng đường với thông báo trực tiếp: gộp theo công việc trong 60 giây, không trùng khi vừa được báo
    // trực tiếp, và có đẩy realtime. `force`: theo dõi là hành động chủ động nên bỏ qua cài đặt in-app.
    // Lỗi của một người không chặn người sau.
    for (const recipientId of recipients) {
      try {
        await this.notifications.publish(
          {
            recipientId,
            workspaceId: issue.workspaceId,
            type: 'WATCHING_UPDATE',
            issueId: issue.id,
            actorId: actorId ?? null,
            payload: { key: issue.key, summary: issue.summary },
          },
          { force: true },
        );
      } catch (err) {
        this.logger.warn(`Báo người theo dõi ${recipientId} thất bại: ${this.errMsg(err)}`);
      }
    }
  }

  /** Issue phải thuộc workspace của user và chưa xóa mềm. */
  private async requireIssue(
    workspaceId: string,
    issueId: string,
  ): Promise<{ id: string; projectId: string }> {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, workspaceId, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (!issue) throw new NotFoundAppException('Công việc');
    return issue;
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
