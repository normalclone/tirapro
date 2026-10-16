import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import { DOMAIN_EVENTS } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WRITABLE_PROJECT_FILTER } from '../../common/project-writable';
import { IssuesService } from '../issues/issues.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectAccessService } from '../rbac/project-access.service';

/** Payload của `DOMAIN_EVENTS.MEMBER_ADDED`. */
export interface MemberAddedPayload {
  workspaceId: string;
  userIds: string[];
  /** Người thêm (ghi vào lịch sử gán); vắng thì lấy người đã nhập việc. */
  actorId?: string;
}

/** Payload của `DOMAIN_EVENTS.PROJECT_ACCESS_CHANGED`: người được thêm vào dự án, hoặc `userIds: null` = dự án vừa mở công khai. */
export interface ProjectAccessChangedPayload {
  workspaceId: string;
  projectId: string;
  userIds?: string[] | null;
  actorId?: string;
}

interface Claim {
  rowId: string;
  issueId: string;
  projectId: string;
  userId: string;
}

/**
 * Tự gán các việc nhập từ Jira cho người phụ trách chưa có tài khoản/chưa là thành viên khi họ được thêm vào
 * workspace (L28) — và thử lại khi họ được cấp quyền xem dự án riêng tư (thêm vào dự án / dự án mở công khai).
 * Khớp CHỈ theo email (chữ thường) — không đoán theo tên. Hàng chờ do Jira import ghi (`ImportPendingAssignee`),
 * xoá khi xử lý xong.
 */
@Injectable()
export class PendingAssigneeService {
  private readonly logger = new Logger(PendingAssigneeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly issues: IssuesService,
    private readonly events: EventEmitter2,
    private readonly notifications: NotificationsService,
  ) {}

  /** Listener: lỗi gán KHÔNG được làm hỏng thao tác thêm thành viên (chỉ log). Không dùng cron. */
  @OnEvent(DOMAIN_EVENTS.MEMBER_ADDED)
  async onMemberAdded(payload: MemberAddedPayload): Promise<void> {
    await this.safely(() =>
      this.claimFor(payload.workspaceId, payload.userIds, { actorId: payload.actorId }),
    );
  }

  /** Được thêm vào dự án / dự án mở công khai: việc ở dự án riêng tư từng bị giữ lại nay có thể được gán. */
  @OnEvent(DOMAIN_EVENTS.PROJECT_ACCESS_CHANGED)
  async onProjectAccessChanged(payload: ProjectAccessChangedPayload): Promise<void> {
    await this.safely(() =>
      this.claimFor(payload.workspaceId, payload.userIds ?? null, {
        actorId: payload.actorId,
        projectId: payload.projectId,
      }),
    );
  }

  private async safely(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(
        `Không tự gán được việc Jira đang chờ: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Gán các việc đang chờ; trả số việc ĐÃ gán. `userIds: null` + `projectId` = mọi người có hàng chờ ở dự án đó
   * (dự án vừa mở công khai); `projectId` còn lọc hàng chờ theo dự án khi được thêm vào một dự án.
   * - Việc đã có người / đã xoá / dự án đã lưu trữ → không gán, nhưng dọn hàng chờ.
   * - Dự án riêng tư mà người đó chưa thấy → không gán, GIỮ hàng chờ (không làm lộ dự án qua việc được giao).
   * - Gán theo LÔ cho mỗi người (một updateMany + một createMany lịch sử), sự kiện realtime lấy DTO bằng MỘT truy vấn
   *   và MỘT thông báo gộp cho mỗi người ("Bạn được giao N việc từ nhập Jira").
   */
  async claimFor(
    workspaceId: string,
    userIds: string[] | null,
    opts: { actorId?: string; projectId?: string } = {},
  ): Promise<number> {
    if (userIds && userIds.length === 0) return 0;
    if (!userIds && !opts.projectId) return 0;
    const byEmail = new Map<string, string>();
    let pending: Array<{ id: string; issueId: string; projectId: string; email: string }>;
    const select = { id: true, issueId: true, projectId: true, email: true };
    if (userIds) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: [...new Set(userIds)] } },
        select: { id: true, email: true, status: true },
      });
      for (const u of users)
        if (u.status !== 'DEACTIVATED') byEmail.set(u.email.toLowerCase(), u.id);
      if (byEmail.size === 0) return 0;
      pending = await this.prisma.importPendingAssignee.findMany({
        where: {
          workspaceId,
          email: { in: [...byEmail.keys()] },
          ...(opts.projectId ? { projectId: opts.projectId } : {}),
        },
        select,
      });
    } else {
      pending = await this.prisma.importPendingAssignee.findMany({
        where: { workspaceId, projectId: opts.projectId! },
        select,
      });
      if (pending.length === 0) return 0;
      const users = await this.prisma.user.findMany({
        where: {
          email: { in: [...new Set(pending.map((p) => p.email))] },
          // chỉ thành viên workspace mới nhận việc
          workspaceMemberships: { some: { workspaceId } },
        },
        select: { id: true, email: true, status: true },
      });
      for (const u of users)
        if (u.status !== 'DEACTIVATED') byEmail.set(u.email.toLowerCase(), u.id);
    }
    if (pending.length === 0) return 0;

    // Quyền xem dự án — một lần cho mỗi cặp (người, dự án).
    const seen = new Map<string, boolean>();
    const claims: Claim[] = [];
    for (const p of pending) {
      const userId = byEmail.get(p.email);
      if (!userId) continue;
      const k = `${userId}:${p.projectId}`;
      if (!seen.has(k)) seen.set(k, await this.access.canSee(userId, workspaceId, p.projectId));
      if (seen.get(k))
        claims.push({ rowId: p.id, issueId: p.issueId, projectId: p.projectId, userId });
    }
    if (claims.length === 0) return 0;

    const assigned = await this.assignInBatches(claims, opts.actorId);
    await this.announce(workspaceId, assigned, opts.actorId);
    return assigned.length;
  }

  /** Một transaction: gán theo lô cho từng người, ghi lịch sử một lượt, dọn mọi hàng chờ đã xử lý. */
  private async assignInBatches(
    claims: Claim[],
    actorId: string | undefined,
  ): Promise<Array<{ issueId: string; userId: string; key: string; summary?: string }>> {
    return this.prisma.$transaction(async (tx) => {
      const done: Array<{ issueId: string; userId: string; key: string; summary?: string }> = [];
      const history: Prisma.IssueHistoryCreateManyInput[] = [];
      const byUser = new Map<string, string[]>();
      for (const c of claims) byUser.set(c.userId, [...(byUser.get(c.userId) ?? []), c.issueId]);
      for (const [userId, ids] of byUser) {
        // Chỉ việc còn đủ điều kiện (chưa có người, chưa xoá, dự án chưa lưu trữ — chỉ đọc).
        const eligible = await tx.issue.findMany({
          where: {
            id: { in: ids },
            assigneeId: null,
            deletedAt: null,
            // dự án đã lưu trữ là chỉ đọc: bỏ qua im lặng (không có người dùng để báo lỗi)
            project: WRITABLE_PROJECT_FILTER,
          },
          select: {
            id: true,
            key: true,
            summary: true,
            projectId: true,
            sprintId: true,
            reporterId: true,
          },
        });
        if (eligible.length === 0) continue;
        await tx.issue.updateMany({
          where: { id: { in: eligible.map((i) => i.id) }, assigneeId: null, deletedAt: null },
          data: { assigneeId: userId, version: { increment: 1 } },
        });
        const now = new Date();
        for (const i of eligible) {
          done.push({ issueId: i.id, userId, key: i.key, summary: i.summary });
          history.push({
            issueId: i.id,
            projectId: i.projectId,
            sprintId: i.sprintId ?? null,
            field: 'ASSIGNEE',
            oldValue: null,
            newValue: userId,
            actorId: actorId ?? i.reporterId ?? userId,
            occurredAt: now,
          });
        }
      }
      if (history.length) await tx.issueHistory.createMany({ data: history });
      // Dọn mọi hàng đã xử lý (kể cả việc đã có người) — chỉ giữ hàng của dự án riêng tư chưa thấy.
      await tx.importPendingAssignee.deleteMany({
        where: { id: { in: claims.map((c) => c.rowId) } },
      });
      return done;
    });
  }

  /**
   * Sau commit: realtime/tích hợp cho từng việc (DTO lấy bằng MỘT truy vấn, cờ `bulk` để thông báo "được giao" từng việc bị
   * bỏ qua) + MỘT thông báo gộp cho mỗi người. Lỗi ở đây chỉ log — việc đã gán rồi.
   */
  private async announce(
    workspaceId: string,
    assigned: Array<{ issueId: string; userId: string; key: string; summary?: string }>,
    actorId: string | undefined,
  ): Promise<void> {
    if (assigned.length === 0) return;
    try {
      // null/ngữ cảnh hệ thống có chủ đích: quyền xem đã kiểm bằng canSee ở trên.
      const dtos = await this.issues.getDtosByIdsForSystem(
        workspaceId,
        assigned.map((a) => a.issueId),
      );
      for (const dto of dtos) {
        this.events.emit(DOMAIN_EVENTS.ISSUE_UPDATED, {
          issue: dto,
          actorId: actorId ?? dto.reporterId ?? undefined,
          changedFields: ['assigneeId'],
          bulk: true,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Đã gán ${assigned.length} việc nhưng không phát được sự kiện: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const perUser = new Map<string, typeof assigned>();
    for (const a of assigned) perUser.set(a.userId, [...(perUser.get(a.userId) ?? []), a]);
    for (const [userId, list] of perUser) {
      try {
        const first = list[0]!;
        await this.notifications.publish({
          recipientId: userId,
          workspaceId,
          type: 'ISSUE_ASSIGNED',
          issueId: first.issueId,
          actorId: actorId ?? null,
          payload: {
            key: first.key,
            summary: first.summary,
            count: list.length,
            bulk: 'jira-import',
          },
        });
      } catch (err) {
        this.logger.warn(
          `Không gửi được thông báo gộp cho ${userId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
