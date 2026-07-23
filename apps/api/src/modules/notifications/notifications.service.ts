import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS, NotificationType as NotificationTypeEnum } from '@tirapro/types';
import { Prisma, type Notification, type NotificationType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { cursorPage, type PageResult } from '../../common/dto/page-result';

/** DTO trả về cho client — Date đã chuyển sang ISO string. */
export interface NotificationDto {
  id: string;
  type: NotificationType;
  issueId: string | null;
  commentId: string | null;
  actorId: string | null;
  payload: Prisma.JsonValue;
  readAt: string | null;
  createdAt: string;
}

/** Bản đồ bật/tắt theo từng loại thông báo. */
export type NotificationPrefs = Record<NotificationType, boolean>;

/** Danh sách loại thông báo hợp lệ (đồng bộ với enum @tirapro/types). */
const NOTIFICATION_TYPES = Object.values(NotificationTypeEnum) as NotificationType[];

/**
 * Mặc định "im lặng": chỉ bật các thông báo trực tiếp / tín hiệu cao,
 * tắt các loại ồn ào để không spam người dùng.
 */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  ISSUE_ASSIGNED: true,
  MENTIONED: true,
  COMMENT_ADDED: true,
  STATUS_CHANGED: true,
  ISSUE_UPDATED: false,
  SPRINT_STARTED: false,
  SPRINT_COMPLETED: false,
  WATCHING_UPDATE: false,
};

/**
 * Gộp tùy chọn đã lưu (trong `User.settings.notifications`) lên trên mặc định.
 * Bỏ qua mọi khóa lạ / giá trị không phải boolean để luôn trả về map đầy đủ & hợp lệ.
 */
export function effectivePrefs(userSettings: Prisma.JsonValue | null | undefined): NotificationPrefs {
  const result: NotificationPrefs = { ...DEFAULT_NOTIFICATION_PREFS };
  const stored = readNotificationsSettings(userSettings);
  for (const type of NOTIFICATION_TYPES) {
    const value = stored[type];
    if (typeof value === 'boolean') result[type] = value;
  }
  return result;
}

/** Đọc nhánh `settings.notifications` an toàn (settings là Json tùy ý). */
function readNotificationsSettings(userSettings: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!userSettings || typeof userSettings !== 'object' || Array.isArray(userSettings)) return {};
  const notifications = (userSettings as Record<string, unknown>).notifications;
  if (!notifications || typeof notifications !== 'object' || Array.isArray(notifications)) return {};
  return notifications as Record<string, unknown>;
}

/** Issue tối thiểu kèm trong payload của các domain event. */
interface IssueEventShape {
  id: string;
  key: string;
  summary: string;
  workspaceId: string;
  assigneeId: string | null;
  status?: { name?: string } | null;
}

interface IssueTransitionedPayload {
  issue: IssueEventShape;
  actorId: string;
  fromStatusId?: string | null;
}

interface IssueUpdatedPayload {
  issue: IssueEventShape;
  actorId: string;
}

interface CommentAddedPayload {
  comment: { id: string; authorId: string };
  issueId: string;
  projectId?: string;
  actorId?: string;
}


@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------- READ: luôn scope theo recipientId = user hiện tại ----------

  /** Thông báo của tôi, mới nhất trước, phân trang cursor. */
  async listMine(recipientId: string, cursor: string | undefined, limit: number): Promise<PageResult<NotificationDto>> {
    const rows = await this.prisma.notification.findMany({
      where: { recipientId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return cursorPage(
      rows.map((n) => this.toDto(n)),
      limit,
      (n) => n.id,
    );
  }

  /** Số thông báo chưa đọc của tôi. */
  async unreadCount(recipientId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: { recipientId, readAt: null },
    });
    return { count };
  }

  /** Đánh dấu một thông báo là đã đọc (chỉ chủ sở hữu). */
  async markRead(recipientId: string, id: string): Promise<{ ok: true }> {
    const result = await this.prisma.notification.updateMany({
      where: { id, recipientId },
      data: { readAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundAppException('Thông báo');
    return { ok: true };
  }

  /** Đánh dấu tất cả thông báo chưa đọc là đã đọc. */
  async markAllRead(recipientId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { recipientId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  // ---------- PREFERENCES: tùy chọn nhận thông báo (chỉ user hiện tại) ----------

  /** Trả về map hiệu lực (đã gộp mặc định) + bản mặc định để FE tham chiếu. */
  async getPreferences(userId: string): Promise<{ preferences: NotificationPrefs; defaults: NotificationPrefs }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });
    if (!user) throw new NotFoundAppException('Người dùng');
    return {
      preferences: effectivePrefs(user.settings),
      defaults: DEFAULT_NOTIFICATION_PREFS,
    };
  }

  /**
   * Gộp tùy chọn mới vào `settings.notifications`, giữ nguyên các khóa settings khác,
   * rồi ghi toàn bộ `settings` json trở lại. Trả về map hiệu lực sau cập nhật.
   */
  async updatePreferences(userId: string, patch: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });
    if (!user) throw new NotFoundAppException('Người dùng');

    const currentSettings =
      user.settings && typeof user.settings === 'object' && !Array.isArray(user.settings)
        ? (user.settings as Record<string, unknown>)
        : {};
    const currentNotifications = readNotificationsSettings(user.settings);

    const mergedNotifications: Record<string, unknown> = { ...currentNotifications };
    for (const type of NOTIFICATION_TYPES) {
      const value = patch[type];
      if (typeof value === 'boolean') mergedNotifications[type] = value;
    }

    const nextSettings = { ...currentSettings, notifications: mergedNotifications };
    await this.prisma.user.update({
      where: { id: userId },
      data: { settings: nextSettings as unknown as Prisma.InputJsonValue },
    });
    return effectivePrefs(nextSettings as Prisma.JsonValue);
  }

  // ---------- PRODUCER: domain event -> tạo Notification ----------
  // KHÔNG bao giờ thông báo cho chính người thực hiện (actor).
  // Mỗi handler bọc try/catch: log + nuốt lỗi, tuyệt đối không làm vỡ luồng phát sự kiện.

  @OnEvent(DOMAIN_EVENTS.ISSUE_TRANSITIONED)
  async onIssueTransitioned(payload: unknown): Promise<void> {
    try {
      const { issue, actorId } = payload as IssueTransitionedPayload;
      if (!issue?.assigneeId || issue.assigneeId === actorId) return;
      await this.create({
        recipientId: issue.assigneeId,
        workspaceId: issue.workspaceId,
        type: 'STATUS_CHANGED',
        issueId: issue.id,
        actorId,
        payload: { key: issue.key, summary: issue.summary, statusName: issue.status?.name ?? null },
      });
    } catch (err) {
      this.logger.warn(`onIssueTransitioned thất bại: ${this.errMsg(err)}`);
    }
  }

  @OnEvent(DOMAIN_EVENTS.ISSUE_UPDATED)
  async onIssueUpdated(payload: unknown): Promise<void> {
    try {
      const { issue, actorId } = payload as IssueUpdatedPayload;
      if (!issue?.assigneeId || issue.assigneeId === actorId) return;
      await this.create({
        recipientId: issue.assigneeId,
        workspaceId: issue.workspaceId,
        type: 'ISSUE_UPDATED',
        issueId: issue.id,
        actorId,
        payload: { key: issue.key, summary: issue.summary },
      });
    } catch (err) {
      this.logger.warn(`onIssueUpdated thất bại: ${this.errMsg(err)}`);
    }
  }

  @OnEvent(DOMAIN_EVENTS.COMMENT_ADDED)
  async onCommentAdded(payload: unknown): Promise<void> {
    try {
      const { comment, issueId, actorId } = payload as CommentAddedPayload;
      const author = actorId ?? comment?.authorId;
      if (!issueId || !author) return;
      const issue = await this.prisma.issue.findFirst({
        where: { id: issueId, deletedAt: null },
        select: { id: true, workspaceId: true, assigneeId: true, key: true, summary: true },
      });
      if (!issue?.assigneeId || issue.assigneeId === author) return;
      await this.create({
        recipientId: issue.assigneeId,
        workspaceId: issue.workspaceId,
        type: 'COMMENT_ADDED',
        issueId: issue.id,
        actorId: author,
        payload: { key: issue.key, summary: issue.summary },
      });
    } catch (err) {
      this.logger.warn(`onCommentAdded thất bại: ${this.errMsg(err)}`);
    }
  }

  // ---------- helpers ----------

  private async create(input: {
    recipientId: string;
    workspaceId: string;
    type: NotificationType;
    issueId?: string | null;
    commentId?: string | null;
    actorId?: string | null;
    payload: Record<string, unknown>;
  }): Promise<void> {
    // Quiet-by-default: tôn trọng tùy chọn của người nhận, bỏ qua loại đã tắt.
    const recipient = await this.prisma.user.findUnique({
      where: { id: input.recipientId },
      select: { settings: true },
    });
    if (!recipient) return;
    const prefs = effectivePrefs(recipient.settings);
    if (!prefs[input.type]) return;

    await this.prisma.notification.create({
      data: {
        recipientId: input.recipientId,
        workspaceId: input.workspaceId,
        type: input.type,
        issueId: input.issueId ?? null,
        commentId: input.commentId ?? null,
        actorId: input.actorId ?? null,
        payload: input.payload as Prisma.InputJsonValue,
      },
    });
  }

  private toDto(n: Notification): NotificationDto {
    return {
      id: n.id,
      type: n.type,
      issueId: n.issueId,
      commentId: n.commentId,
      actorId: n.actorId,
      payload: n.payload,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    };
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
