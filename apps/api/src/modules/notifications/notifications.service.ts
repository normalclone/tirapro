import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { z } from 'zod';
import {
  buildNotificationTitle,
  extractMentionIds,
  notificationBody,
  plainExcerpt,
  type NotificationFilter,
  type NotificationPayload,
} from '@tirapro/shared';
import {
  DOMAIN_EVENTS,
  NotificationType as NotificationTypeEnum,
  type NotificationEmailPrefs,
} from '@tirapro/types';
import { Prisma, type Notification, type NotificationType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { cursorPage, type PageResult } from '../../common/dto/page-result';
import { MailService } from '../mail/mail.service';
import { resolveMentionedMembers } from '../../common/mentions';
import { COALESCE_TYPES, COALESCE_WINDOW_MS, mergeNotificationPayload } from './notification-merge';

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
export function effectivePrefs(
  userSettings: Prisma.JsonValue | null | undefined,
): NotificationPrefs {
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
export function effectiveEmailPrefs(
  userSettings: Prisma.JsonValue | null | undefined,
): NotificationEmailPrefs {
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
function readNotificationsSettings(
  userSettings: Prisma.JsonValue | null | undefined,
): Record<string, unknown> {
  if (!userSettings || typeof userSettings !== 'object' || Array.isArray(userSettings)) return {};
  const notifications = (userSettings as Record<string, unknown>).notifications;
  if (!notifications || typeof notifications !== 'object' || Array.isArray(notifications))
    return {};
  return notifications as Record<string, unknown>;
}

/** Bộ lọc danh sách → điều kiện Prisma (đi theo chỉ mục [recipientId, createdAt] rồi lọc trên tập của MỘT người). */
const FILTER_WHERE = {
  all: {},
  unread: { readAt: null },
  mentioned: { type: 'MENTIONED' },
  assigned: { type: 'ISSUE_ASSIGNED' },
} as const satisfies Record<NotificationFilter, Prisma.NotificationWhereInput>;

/** Issue tối thiểu kèm trong payload của các domain event. */
interface IssueEventShape {
  id: string;
  key: string;
  summary: string;
  workspaceId: string;
  assigneeId: string | null;
  status?: { name?: string } | null;
  description?: string | null;
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
  comment: { id: string; authorId: string; body?: string };
  issueId: string;
  projectId?: string;
  actorId?: string;
  mentionIds?: string[];
  /** Chỉ có ở `comment.updated`: @ mới thêm khi sửa (chưa từng được báo). */
  newMentionIds?: string[];
}

/** Tuỳ chọn khi tạo thông báo. */
export interface PublishOptions {
  /** Bỏ qua cài đặt in-app của người nhận (dùng cho người theo dõi). */
  force?: boolean;
}

export interface NotificationInput {
  recipientId: string;
  workspaceId: string;
  type: NotificationType;
  issueId?: string | null;
  commentId?: string | null;
  actorId?: string | null;
  payload: Record<string, unknown>;
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
  async listMine(
    recipientId: string,
    cursor: string | undefined,
    limit: number,
    filter: NotificationFilter = 'all',
  ): Promise<PageResult<NotificationDto>> {
    const rows = await this.prisma.notification.findMany({
      // recipientId luôn có mặt: không thể xem thông báo người khác dù bộ lọc là gì.
      where: { recipientId, ...FILTER_WHERE[filter] },
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
      const { issue, actorId, fromStatusId } = payload as IssueTransitionedPayload;
      if (!issue?.assigneeId || issue.assigneeId === actorId) return;
      const fromStatus = fromStatusId
        ? await this.prisma.status.findUnique({
            where: { id: fromStatusId },
            select: { name: true },
          })
        : null;
      await this.publish({
        recipientId: issue.assigneeId,
        workspaceId: issue.workspaceId,
        type: 'STATUS_CHANGED',
        issueId: issue.id,
        actorId,
        payload: {
          key: issue.key,
          summary: issue.summary,
          statusName: issue.status?.name ?? null,
          ...(fromStatus ? { fromStatusName: fromStatus.name } : {}),
        },
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
      await this.publish({
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
      const issuePayload = {
        key: issue.key,
        summary: issue.summary,
        excerpt: plainExcerpt(comment?.body, 80),
      };

      // @nhắc tên: chỉ thành viên không gian làm việc, không tự nhắc chính mình.
      const mentioned = await this.notifyMentioned({
        issue,
        author,
        ids: mentionIds ?? [],
        commentId: comment?.id ?? null,
        body: comment?.body,
        where: 'comment',
      });

      // Người được nhắc tên đã nhận thông báo trực tiếp, không báo thêm "có bình luận mới".
      if (!issue.assigneeId || issue.assigneeId === author || mentioned.has(issue.assigneeId))
        return;
      await this.publish({
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

  /** Sửa bình luận có thêm @ mới → báo đúng những người mới (không phát lại COMMENT_ADDED). */
  @OnEvent(DOMAIN_EVENTS.COMMENT_UPDATED)
  async onCommentUpdated(payload: unknown): Promise<void> {
    try {
      const { comment, issueId, actorId, newMentionIds } = payload as CommentAddedPayload;
      const author = actorId ?? comment?.authorId;
      if (!issueId || !author || !newMentionIds?.length) return;
      const issue = await this.prisma.issue.findFirst({
        where: { id: issueId, deletedAt: null },
        select: { id: true, workspaceId: true, key: true, summary: true },
      });
      if (!issue) return;
      await this.notifyMentioned({
        issue,
        author,
        ids: newMentionIds,
        commentId: comment?.id ?? null,
        body: comment?.body,
        where: 'comment',
      });
    } catch (err) {
      this.logger.warn(`onCommentUpdated thất bại: ${this.errMsg(err)}`);
    }
  }

  /**
   * @ trong mô tả công việc (lúc tạo hoặc khi sửa mô tả). Dòng `Mention(issueId, commentId=null)` là sổ "đã báo ai":
   * chỉ người CHƯA có dòng mới được báo; gỡ @ rồi thêm lại không báo lần nữa (tránh spam khi sửa chính tả).
   */
  @OnEvent(DOMAIN_EVENTS.ISSUE_CREATED)
  @OnEvent(DOMAIN_EVENTS.ISSUE_UPDATED)
  async onIssueDescriptionMentions(payload: unknown): Promise<void> {
    try {
      const { issue, actorId, changedFields } = payload as IssueUpdatedPayload;
      if (!issue?.description || !actorId) return;
      if (changedFields && !changedFields.includes('description')) return;
      const ids = extractMentionIds(issue.description);
      if (!ids.length) return;
      const members = await resolveMentionedMembers(this.prisma, issue.workspaceId, ids, actorId);
      if (!members.length) return;
      // Sổ + thông báo trong CÙNG transaction. Chỉ mục duy nhất (issueId, người) WHERE commentId IS NULL làm
      // `ON CONFLICT DO NOTHING` quyết định ai thắng khi nhiều sự kiện chạy đồng thời → chỉ báo dòng thực sự chèn được.
      // Email/đẩy realtime chạy SAU commit; lỗi giữa chừng thì rollback cả sổ lẫn thông báo (lần sau còn được báo).
      const after: Array<() => Promise<void>> = [];
      await this.prisma.$transaction(async (tx) => {
        const inserted = await tx.mention.createManyAndReturn({
          data: members.map((mentionedUserId) => ({ mentionedUserId, issueId: issue.id })),
          skipDuplicates: true,
          select: { mentionedUserId: true },
        });
        for (const { mentionedUserId } of inserted) {
          after.push(
            await this.createDeferred(
              {
                recipientId: mentionedUserId,
                workspaceId: issue.workspaceId,
                type: 'MENTIONED',
                issueId: issue.id,
                actorId,
                payload: this.mentionPayload(issue, issue.description, 'description'),
              },
              tx,
            ),
          );
        }
      });
      for (const run of after) await run();
    } catch (err) {
      this.logger.warn(`onIssueDescriptionMentions thất bại: ${this.errMsg(err)}`);
    }
  }

  // ---------- helpers ----------

  private mentionPayload(
    issue: { key: string; summary: string },
    body: string | null | undefined,
    where: 'comment' | 'description',
  ): Record<string, unknown> {
    return { key: issue.key, summary: issue.summary, excerpt: plainExcerpt(body, 80), where };
  }

  /** Tạo MENTIONED cho các id còn là thành viên workspace (≠ người nhắc); trả về tập người đã được báo. */
  private async notifyMentioned(input: {
    issue: { id: string; workspaceId: string; key: string; summary: string };
    author: string;
    ids: readonly string[];
    commentId: string | null;
    body: string | null | undefined;
    where: 'comment' | 'description';
  }): Promise<Set<string>> {
    const { issue, author } = input;
    const mentioned = new Set<string>();
    const members = await resolveMentionedMembers(
      this.prisma,
      issue.workspaceId,
      input.ids,
      author,
    );
    for (const recipientId of members) {
      mentioned.add(recipientId);
      await this.publish({
        recipientId,
        workspaceId: issue.workspaceId,
        type: 'MENTIONED',
        issueId: issue.id,
        commentId: input.commentId,
        actorId: author,
        payload: this.mentionPayload(issue, input.body, input.where),
      });
    }
    return mentioned;
  }

  private notifyAssigned(issue: IssueEventShape, actorId: string): Promise<void> {
    return this.publish({
      recipientId: issue.assigneeId as string,
      workspaceId: issue.workspaceId,
      type: 'ISSUE_ASSIGNED',
      issueId: issue.id,
      actorId,
      payload: { key: issue.key, summary: issue.summary },
    });
  }

  /**
   * Điểm vào duy nhất để tạo thông báo in-app (+ email). Tôn trọng cài đặt người nhận, trừ khi `force`
   * (người theo dõi là hành động chủ động nên bỏ qua cài đặt in-app). Loại "ồn" được gộp theo công việc trong
   * 60 giây (xem `notification-merge.ts`).
   */
  async publish(input: NotificationInput, opts?: PublishOptions): Promise<void> {
    const after = await this.createDeferred(input, this.prisma, opts);
    await after();
  }

  /**
   * Ghi dòng Notification bằng `db` (có thể là transaction đang mở) và trả về phần "sau commit":
   * đẩy `notification:new` qua gateway + xếp email. Gọi `after()` CHỈ KHI transaction đã commit thành công.
   */
  private async createDeferred(
    input: NotificationInput,
    db: Pick<Prisma.TransactionClient, 'notification'> = this.prisma,
    opts?: PublishOptions,
  ): Promise<() => Promise<void>> {
    const noop = (): Promise<void> => Promise.resolve();
    // Quiet-by-default: tôn trọng tùy chọn của người nhận. In-app và email là hai tuỳ chọn độc lập.
    // Chốt chặn trung tâm: không bao giờ báo cho chính người thao tác (dù producer quên lọc).
    if (input.actorId && input.actorId === input.recipientId) return noop;
    const recipient = await this.prisma.user.findUnique({
      where: { id: input.recipientId },
      select: { settings: true, email: true, status: true },
    });
    if (!recipient) return noop;
    const prefs = effectivePrefs(recipient.settings);
    const emailKey = EMAIL_KEY_BY_TYPE[input.type];
    const emailOn =
      !!emailKey &&
      recipient.status !== 'DEACTIVATED' &&
      effectiveEmailPrefs(recipient.settings)[emailKey];
    // `force` chỉ thay MẶC ĐỊNH (loại tắt-mặc-định như WATCHING_UPDATE); người dùng đã TẮT tường minh thì luôn thắng.
    const explicitlyOff = readNotificationsSettings(recipient.settings)[input.type] === false;
    const inApp = prefs[input.type] || (!!opts?.force && !explicitlyOff);
    if (!inApp && !emailOn) return noop;
    const payload = await this.withActor(input);

    let saved: Notification | null = null;
    if (inApp) {
      const since = new Date(Date.now() - COALESCE_WINDOW_MS);
      // Theo dõi: đã được báo trực tiếp (loại khác) về cùng công việc trong cửa sổ → không báo thêm dòng "theo dõi".
      if (input.type === 'WATCHING_UPDATE' && input.issueId) {
        const direct = await db.notification.findFirst({
          where: {
            recipientId: input.recipientId,
            issueId: input.issueId,
            type: { not: 'WATCHING_UPDATE' },
            readAt: null,
            createdAt: { gte: since },
          },
          select: { id: true },
        });
        if (direct) return noop;
      }
      const prev =
        COALESCE_TYPES.has(input.type) && input.issueId
          ? await db.notification.findFirst({
              where: {
                recipientId: input.recipientId,
                issueId: input.issueId,
                type: input.type,
                readAt: null,
                createdAt: { gte: since },
              },
              orderBy: { createdAt: 'desc' },
            })
          : null;
      const merged = prev ? await this.mergeInto(db, prev, input, payload) : null;
      saved =
        merged ??
        (await db.notification.create({
          data: {
            recipientId: input.recipientId,
            workspaceId: input.workspaceId,
            type: input.type,
            issueId: input.issueId ?? null,
            commentId: input.commentId ?? null,
            actorId: input.actorId ?? null,
            payload: payload as Prisma.InputJsonValue,
          },
        }));
      // Kiểm lại SAU khi ghi (đối xứng với bước hấp thụ ở dưới): dòng trực tiếp có thể vừa commit giữa lúc kiểm
      // ở trên và lúc ghi này (vd MENTIONED trong transaction chưa commit lúc kiểm đầu) → rút dòng theo dõi vừa ghi.
      if (input.type === 'WATCHING_UPDATE' && input.issueId) {
        const direct = await db.notification.findFirst({
          where: {
            recipientId: input.recipientId,
            issueId: input.issueId,
            type: { not: 'WATCHING_UPDATE' },
            readAt: null,
            createdAt: { gte: since },
          },
          select: { id: true },
        });
        if (direct) {
          await db.notification.deleteMany({ where: { id: saved.id } });
          return noop;
        }
      }
    }

    return async () => {
      if (saved) {
        // Thông báo trực tiếp (loại khác WATCHING_UPDATE) hấp thụ dòng "theo dõi" chưa đọc cùng việc trong cửa sổ:
        // người nhận chỉ thấy một dòng. Chạy SAU commit (kể cả khi dòng trực tiếp ghi trong transaction).
        // Không cộng `count` vì dòng theo dõi thường đếm chính sự kiện này (sẽ thành "bình luận 2 lần" sai).
        if (input.type !== 'WATCHING_UPDATE' && input.issueId) {
          try {
            await this.prisma.notification.deleteMany({
              where: {
                recipientId: input.recipientId,
                issueId: input.issueId,
                type: 'WATCHING_UPDATE',
                readAt: null,
                createdAt: { gte: new Date(Date.now() - COALESCE_WINDOW_MS) },
              },
            });
          } catch (err) {
            this.logger.warn(`Hấp thụ dòng theo dõi thất bại: ${this.errMsg(err)}`);
          }
        }
        // Báo cho gateway đẩy `notification:new` tới đúng người nhận (room user:<id>). Dòng đã gộp cũng được đẩy lại
        // với DTO mới — FE chỉ cần làm mới danh sách.
        this.events.emit(DOMAIN_EVENTS.NOTIFICATION_CREATED, {
          recipientId: input.recipientId,
          notification: this.toDto(saved),
        });
      }
      if (emailOn) await this.enqueueEmail(recipient.email, input.type, payload);
    };
  }

  /**
   * Gộp sự kiện mới vào dòng `prev`. Điều kiện `readAt: null` ngay trong UPDATE: nếu người nhận vừa bấm đọc
   * giữa lúc tìm và lúc ghi thì KHÔNG nhập vào dòng đã đọc (P2025 → trả null để tạo dòng mới).
   */
  private async mergeInto(
    db: Pick<Prisma.TransactionClient, 'notification'>,
    prev: Notification,
    input: NotificationInput,
    payload: NotificationPayload,
  ): Promise<Notification | null> {
    try {
      return await db.notification.update({
        where: { id: prev.id, readAt: null },
        data: {
          payload: mergeNotificationPayload(
            prev.payload as NotificationPayload,
            payload,
          ) as Prisma.InputJsonValue,
          commentId: input.commentId ?? prev.commentId,
          actorId: input.actorId ?? prev.actorId,
          createdAt: new Date(),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') return null;
      throw err;
    }
  }

  /** Bổ sung người thực hiện (ảnh chụp tên lúc xảy ra) + `count`/`actors` — nền cho việc gộp ở `publish`. */
  private async withActor(input: NotificationInput): Promise<NotificationPayload> {
    const base = { ...input.payload } as NotificationPayload;
    const actor = input.actorId
      ? await this.prisma.user.findUnique({
          where: { id: input.actorId },
          select: { displayName: true },
        })
      : null;
    return {
      ...base,
      count: 1,
      ...(actor?.displayName && input.actorId
        ? {
            actorName: actor.displayName,
            actors: [{ id: input.actorId, name: actor.displayName }],
          }
        : {}),
    };
  }

  /** Xếp thư thông báo vào outbox (gộp digest 5 phút). Lỗi chỉ log — không được làm hỏng thông báo in-app. */
  private async enqueueEmail(
    to: string,
    type: NotificationType,
    payload: NotificationPayload,
  ): Promise<void> {
    try {
      const base = this.config.get<string>('mail.appWebUrl') ?? '';
      await this.mail.enqueue({
        to,
        template: 'notification',
        payload: {
          title: buildNotificationTitle(type, payload),
          body: notificationBody(type, payload),
          url: payload.key ? `${base}/issue/${payload.key}` : base,
        },
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
