import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import { DOMAIN_EVENTS } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WRITABLE_PROJECT_FILTER } from '../../common/project-writable';
import { IssuesService } from '../issues/issues.service';
import { ProjectAccessService } from '../rbac/project-access.service';

/** Payload của `DOMAIN_EVENTS.MEMBER_ADDED`. */
export interface MemberAddedPayload {
  workspaceId: string;
  userIds: string[];
  /** Người thêm (ghi vào lịch sử gán); vắng thì lấy người đã nhập việc. */
  actorId?: string;
}

/**
 * Tự gán các việc nhập từ Jira cho người phụ trách chưa có tài khoản/chưa là thành viên khi họ được thêm vào
 * workspace (L28). Khớp CHỈ theo email (chữ thường) — không đoán theo tên. Hàng chờ do Jira import ghi
 * (`ImportPendingAssignee`), xoá khi xử lý xong.
 */
@Injectable()
export class PendingAssigneeService {
  private readonly logger = new Logger(PendingAssigneeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly issues: IssuesService,
    private readonly events: EventEmitter2,
  ) {}

  /** Listener: lỗi gán KHÔNG được làm hỏng thao tác thêm thành viên (chỉ log). Không dùng cron. */
  @OnEvent(DOMAIN_EVENTS.MEMBER_ADDED)
  async onMemberAdded(payload: MemberAddedPayload): Promise<void> {
    try {
      await this.claimFor(payload.workspaceId, payload.userIds, payload.actorId);
    } catch (err) {
      this.logger.warn(
        `Không tự gán được việc Jira cho thành viên mới: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Gán các việc đang chờ cho những người vừa được thêm; trả số việc ĐÃ gán.
   * - Việc đã có người / đã xoá / dự án đã lưu trữ → không gán, nhưng dọn hàng chờ.
   * - Dự án riêng tư mà người đó chưa thấy → không gán, GIỮ hàng chờ (không làm lộ dự án qua việc được giao).
   */
  async claimFor(workspaceId: string, userIds: string[], actorId?: string): Promise<number> {
    if (userIds.length === 0) return 0;
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, email: true, status: true },
    });
    const byEmail = new Map<string, string>();
    for (const u of users) if (u.status !== 'DEACTIVATED') byEmail.set(u.email.toLowerCase(), u.id);
    if (byEmail.size === 0) return 0;

    const pending = await this.prisma.importPendingAssignee.findMany({
      where: { workspaceId, email: { in: [...byEmail.keys()] } },
      select: { id: true, issueId: true, projectId: true, email: true },
    });
    if (pending.length === 0) return 0;

    // Quyền xem dự án — một lần cho mỗi cặp (người, dự án).
    const seen = new Map<string, boolean>();
    const claims: Array<{ rowId: string; issueId: string; projectId: string; userId: string }> = [];
    for (const p of pending) {
      const userId = byEmail.get(p.email)!;
      const k = `${userId}:${p.projectId}`;
      if (!seen.has(k)) seen.set(k, await this.access.canSee(userId, workspaceId, p.projectId));
      if (seen.get(k))
        claims.push({ rowId: p.id, issueId: p.issueId, projectId: p.projectId, userId });
    }
    if (claims.length === 0) return 0;

    const info = new Map(
      (
        await this.prisma.issue.findMany({
          where: { id: { in: claims.map((c) => c.issueId) }, deletedAt: null },
          select: { id: true, key: true, reporterId: true, sprintId: true },
        })
      ).map((i) => [i.id, i]),
    );

    const assigned = await this.prisma.$transaction(async (tx) => {
      const done: Array<{ issueId: string; key: string | undefined }> = [];
      const history: Prisma.IssueHistoryCreateManyInput[] = [];
      for (const c of claims) {
        const { count } = await tx.issue.updateMany({
          where: {
            id: c.issueId,
            assigneeId: null,
            deletedAt: null,
            // dự án đã lưu trữ là chỉ đọc: bỏ qua im lặng (không có người dùng để báo lỗi)
            project: WRITABLE_PROJECT_FILTER,
          },
          data: { assigneeId: c.userId, version: { increment: 1 } },
        });
        if (count === 0) continue;
        const i = info.get(c.issueId);
        done.push({ issueId: c.issueId, key: i?.key });
        history.push({
          issueId: c.issueId,
          projectId: c.projectId,
          sprintId: i?.sprintId ?? null,
          field: 'ASSIGNEE',
          oldValue: null,
          newValue: c.userId,
          actorId: actorId ?? i?.reporterId ?? c.userId,
          occurredAt: new Date(),
        });
      }
      if (history.length) await tx.issueHistory.createMany({ data: history });
      // Dọn mọi hàng đã xử lý (kể cả việc đã có người) — chỉ giữ hàng của dự án riêng tư chưa thấy.
      await tx.importPendingAssignee.deleteMany({
        where: { id: { in: claims.map((c) => c.rowId) } },
      });
      return done;
    });

    // Sự kiện phát SAU commit: realtime + thông báo "được giao" chạy như một lần giao việc bình thường.
    for (const a of assigned) {
      if (!a.key) continue;
      try {
        // null = ngữ cảnh hệ thống có chủ đích: quyền xem đã kiểm ở trên bằng canSee.
        const dto = await this.issues.getByKey(workspaceId, a.key, null);
        this.events.emit(DOMAIN_EVENTS.ISSUE_UPDATED, {
          issue: dto,
          actorId: actorId ?? dto.reporterId ?? undefined,
          changedFields: ['assigneeId'],
        });
      } catch (err) {
        this.logger.warn(
          `Đã gán ${a.key} nhưng không phát được sự kiện: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return assigned.length;
  }
}
