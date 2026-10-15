import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { z } from 'zod';
import { DOMAIN_EVENTS, NotificationType as NotificationTypeEnum, type NotificationEmailPrefs } from '@tirapro/types';
import { Prisma, type Notification, type NotificationType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { cursorPage, type PageResult } from '../../common/dto/page-result';
import { MailService } from '../mail/mail.service';

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

/** Mặc định gửi email: chỉ bật loại trực tiếp (nhắc tên, được giao việc); bình luận / đổi trạng thái tắt. */
export const DEFAULT_EMAIL_PREFS: NotificationEmailPrefs = {
  mention: true,
  assigned: true,
  comment: false,
  transition: false,
};

/** Mỗi khoá sai kiểu / thiếu → rơi về mặc định (`catch`), nên settings hỏng không làm vỡ luồng thông báo. */
const emailPrefsSchema = z.object({
  mention: z.boolean().catch(DEFAULT_EMAIL_PREFS.mention),
  assigned: z.boolean().catch(DEFAULT_EMAIL_PREFS.assigned),
  comment: z.boolean().catch(DEFAULT_EMAIL_PREFS.comment),
  transition: z.boolean().catch(DEFAULT_EMAIL_PREFS.transition),
});

/** Đọc `settings.notifications.email` an toàn, luôn trả map đầy đủ. */
export function effectiveEmailPrefs(userSettings: Prisma.JsonValue | null | undefined): NotificationEmailPrefs {
  const raw = readNotificationsSettings(userSettings).email;
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return emailPrefsSchema.parse(obj);
}

/** Loại thông báo in-app → khoá tuỳ chọn email tương ứng (loại không có trong bảng thì không gửi email). */
const EMAIL_KEY_BY_TYPE: Partial<Record<NotificationType, keyof NotificationEmailPrefs>> = {
  MENTIONED: 'mention',
  ISSUE_ASSIGNED: 'assigned',
  COMMENT_ADDED: 'comment',
  STATUS_CHANGED: 'transition',
};

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
  /** Các trường vừa đổi (có từ E3); thiếu → coi như không rõ, không suy ra việc giao lại. */
  changedFields?: string[];
}

interface IssueCreatedPayload {
  issue: IssueEventShape;
  actorId: string;
}

interface CommentAddedPayload {
  comment: { id: string; authorId: string };
  issueId: string;
  projectId?: string;
  actorId?: string;
  mentionIds?: string[];
}


@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

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
  async getPreferences(userId: string): Promise<{
    preferences: NotificationPrefs;
    defaults: NotificationPrefs;
    email: NotificationEmailPrefs;
    emailDefaults: NotificationEmailPrefs;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });
    if (!user) throw new NotFoundAppException('Người dùng');
    return {
      preferences: effectivePrefs(user.settings),
      defaults: DEFAULT_NOTIFICATION_PREFS,
      email: effectiveEmailPrefs(user.settings),
      emailDefaults: DEFAULT_EMAIL_PREFS,
    };
  }

  /**
   * Gộp tùy chọn mới vào `settings.notifications`, giữ nguyên các khóa settings khác,
   * rồi ghi toàn bộ `settings` json trở lại. Trả về map hiệu lực sau cập nhật.
   */
  async updatePreferences(
    userId: string,
    patch: Partial<NotificationPrefs>,
    emailPatch: Partial<NotificationEmailPrefs> = {},
  ): Promise<{ preferences: NotificationPrefs; email: NotificationEmailPrefs }> {
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

    // Tuỳ chọn email nằm ở nhánh con `email`; luôn ghi map đầy đủ đã chuẩn hoá.
    const nextEmail: NotificationEmailPrefs = { ...effectiveEmailPrefs(user.settings) };
    for (const key of Object.keys(DEFAULT_EMAIL_PREFS) as (keyof NotificationEmailPrefs)[]) {
      const value = emailPatch[key];
      if (typeof value === 'boolean') nextEmail[key] = value;
    }
    mergedNotifications.email = nextEmail;

    const nextSettings = { ...currentSettings, notifications: mergedNotifications };
    await this.prisma.user.update({
      where: { id: userId },
      data: { settings: nextSettings as unknown as Prisma.InputJsonValue },
    });
    return { preferences: effectivePrefs(nextSettings as Prisma.JsonValue), email: nextEmail };
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

  /** Issue mới tạo đã có người nhận việc (≠ người tạo) → ISSUE_ASSIGNED. */
  @OnEvent(DOMAIN_EVENTS.ISSUE_CREATED)
  async onIssueCreated(payload: unknown): Promise<void> {
    try {
      const { issue, actorId } = payload as IssueCreatedPayload;
      if (!issue?.assigneeId || issue.assigneeId === actorId) return;
      await this.notifyAssigned(issue, actorId);
    } catch (err) {
      this.logger.warn(`onIssueCreated thất bại: ${this.errMsg(err)}`);
    }
  }

  @OnEvent(DOMAIN_EVENTS.ISSUE_UPDATED)
  async onIssueUpdated(payload: unknown): Promise<void> {
    try {
      const { issue, actorId, changedFields } = payload as IssueUpdatedPayload;
      if (!issue?.assigneeId || issue.assigneeId === actorId) return;
      // Người phụ trách vừa được đổi sang người này → "được giao việc" (thay cho "việc được cập nhật" để khỏi báo trùng).
      if (changedFields?.includes('assigneeId')) {
        await this.notifyAssigned(issue, actorId);
        return;
      }
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
      const { comment, issueId, actorId, mentionIds } = payload as CommentAddedPayload;
      const author = actorId ?? comment?.authorId;
      if (!issueId || !author) return;
      const issue = await this.prisma.issue.findFirst({
        where: { id: issueId, deletedAt: null },
        select: { id: true, workspaceId: true, assigneeId: true, key: true, summary: true },
      });
      if (!issue) return;
      const issuePayload = { key: issue.key, summary: issue.summary };

      // @nhắc tên: chỉ thành viên không gian làm việc, không tự nhắc chính mình.
      const wanted = [...new Set(mentionIds ?? [])].filter((id) => id !== author);
      const mentioned = new Set<string>();
      if (wanted.length) {
        const members = await this.prisma.workspaceMembership.findMany({
          where: { workspaceId: issue.workspaceId, userId: { in: wanted } },
          select: { userId: true },
        });
        for (const m of members) mentioned.add(m.userId);
        for (const recipientId of mentioned) {
          await this.create({
            recipientId,
            workspaceId: issue.workspaceId,
            type: 'MENTIONED',
            issueId: issue.id,
            commentId: comment?.id ?? null,
            actorId: author,
            payload: issuePayload,
          });
        }
      }

      // Người được nhắc tên đã nhận thông báo trực tiếp, không báo thêm "có bình luận mới".
      if (!issue.assigneeId || issue.assigneeId === author || mentioned.has(issue.assigneeId)) return;
      await this.create({
        recipientId: issue.assigneeId,
        workspaceId: issue.workspaceId,
        type: 'COMMENT_ADDED',
        issueId: issue.id,
        commentId: comment?.id ?? null,
        actorId: author,
        payload: issuePayload,
      });
    } catch (err) {
      this.logger.warn(`onCommentAdded thất bại: ${this.errMsg(err)}`);
    }
  }

  // ---------- helpers ----------

  private notifyAssigned(issue: IssueEventShape, actorId: string): Promise<void> {
    return this.create({
      recipientId: issue.assigneeId as string,
      workspaceId: issue.workspaceId,
      type: 'ISSUE_ASSIGNED',
      issueId: issue.id,
      actorId,
      payload: { key: issue.key, summary: issue.summary },
    });
  }

  private async create(input: {
    recipientId: string;
    workspaceId: string;
    type: NotificationType;
    issueId?: string | null;
    commentId?: string | null;
    actorId?: string | null;
    payload: Record<string, unknown>;
  }): Promise<void> {
    // Quiet-by-default: tôn trọng tùy chọn của người nhận. In-app và email là hai tuỳ chọn độc lập.
    const recipient = await this.prisma.user.findUnique({
      where: { id: input.recipientId },
      select: { settings: true, email: true, status: true },
    });
    if (!recipient) return;
    const prefs = effectivePrefs(recipient.settings);
    const emailKey = EMAIL_KEY_BY_TYPE[input.type];
    const emailOn = !!emailKey && recipient.status !== 'DEACTIVATED' && effectiveEmailPrefs(recipient.settings)[emailKey];
    if (!prefs[input.type] && !emailOn) return;

    if (prefs[input.type]) {
      const created = await this.prisma.notification.create({
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
      // Báo cho gateway đẩy `notification:new` tới đúng người nhận (room user:<id>).
      this.events.emit(DOMAIN_EVENTS.NOTIFICATION_CREATED, {
        recipientId: input.recipientId,
        notification: this.toDto(created),
      });
    }

    if (emailOn) await this.enqueueEmail(recipient.email, input);
  }

  /** Xếp thư thông báo vào outbox (gộp digest 5 phút). Lỗi chỉ log — không được làm hỏng thông báo in-app. */
  private async enqueueEmail(
    to: string,
    input: { type: NotificationType; actorId?: string | null; payload: Record<string, unknown> },
  ): Promise<void> {
    try {
      const actor = input.actorId
        ? await this.prisma.user.findUnique({ where: { id: input.actorId }, select: { displayName: true } })
        : null;
      const key = typeof input.payload.key === 'string' ? input.payload.key : '';
      const summary = typeof input.payload.summary === 'string' ? input.payload.summary : '';
      const statusName = typeof input.payload.statusName === 'string' ? input.payload.statusName : '';
      const who = actor?.displayName ?? 'Ai đó';
      const title: Record<string, string> = {
        MENTIONED: `${who} đã nhắc đến bạn${key ? ` trong ${key}` : ''}`,
        ISSUE_ASSIGNED: `${who} đã giao cho bạn${key ? ` ${key}` : ' một công việc'}`,
        COMMENT_ADDED: `${who} đã bình luận${key ? ` trong ${key}` : ''}`,
        STATUS_CHANGED: `${key ? `${key} ` : 'Công việc '}đã chuyển sang ${statusName || 'trạng thái mới'}`,
      };
      const base = this.config.get<string>('mail.appWebUrl') ?? '';
      await this.mail.enqueue({
        to,
        template: 'notification',
        payload: { title: title[input.type] ?? 'Thông báo mới', body: summary, url: key ? `${base}/issue/${key}` : base },
      });
    } catch (err) {
      this.logger.warn(`Xếp thư thông báo thất bại: ${this.errMsg(err)}`);
    }
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
