import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { DOMAIN_EVENTS, PERMISSIONS, type WorklogDto, type WorklogListDto } from '@tirapro/types';
import {
  formatDuration,
  parseDuration,
  type AdjustRemainingInput,
  type CreateWorklogInput,
  type UpdateWorklogInput,
} from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';
import { assertIssueWritable } from '../../common/project-writable';
import { RbacService } from '../rbac/rbac.service';
import { IssuesService } from '../issues/issues.service';

const AUTHOR_SELECT = { select: { id: true, displayName: true, avatarUrl: true } } as const;
const worklogInclude = { author: AUTHOR_SELECT } satisfies Prisma.WorkLogInclude;
type WorklogRow = Prisma.WorkLogGetPayload<{ include: typeof worklogInclude }>;

/** Cột `timeSpent` là Int32 — vượt ngưỡng này thì từ chối thay vì để DB báo lỗi 500. */
const MAX_ISSUE_TIME_SEC = 2_147_483_647;

/** Giới hạn số dòng trả về một lần (issue bình thường có vài chục worklog). */
const LIST_LIMIT = 500;

interface IssueTimeState {
  key: string;
  projectId: string;
  sprintId: string | null;
  originalEstimate: number | null;
  remainingEstimate: number | null;
  timeSpent: number | null;
}

/**
 * Worklog (ghi nhận thời gian) trên issue. Mọi thao tác ghi chạy trong MỘT transaction:
 * khoá hàng issue → ghi worklog → cộng lại `timeSpent` → chỉnh `remainingEstimate` → IssueHistory.
 * `issue.version` tăng đúng 1 (chính bước khoá hàng) để client đang giữ bản cũ phải tải lại.
 */
@Injectable()
export class WorklogsService {
  private readonly logger = new Logger(WorklogsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly rbac: RbacService,
    private readonly issues: IssuesService,
  ) {}

  async list(workspaceId: string, issueId: string): Promise<WorklogListDto> {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, workspaceId, deletedAt: null },
      select: { originalEstimate: true, remainingEstimate: true, timeSpent: true },
    });
    if (!issue) throw new NotFoundAppException('Công việc');
    const rows = await this.prisma.workLog.findMany({
      where: { issueId },
      include: worklogInclude,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: LIST_LIMIT,
    });
    return {
      items: rows.map((r) => this.toDto(r)),
      totalSec: issue.timeSpent ?? 0,
      originalEstimate: issue.originalEstimate,
      remainingEstimate: issue.remainingEstimate,
    };
  }

  async create(
    workspaceId: string,
    userId: string,
    issueId: string,
    input: CreateWorklogInput,
  ): Promise<WorklogDto> {
    const sec = this.requireDuration(input.timeSpent);
    const startedAt = input.startedAt ? new Date(input.startedAt) : new Date();
    const { row, issue } = await this.prisma.$transaction(async (tx) => {
      const state = await this.lockIssue(tx, workspaceId, issueId, userId);
      const created = await tx.workLog.create({
        data: {
          issueId,
          authorId: userId,
          timeSpent: sec,
          startedAt,
          comment: input.comment ?? null,
        },
        include: worklogInclude,
      });
      await this.recompute(tx, issueId, userId, state, input.adjustRemaining);
      return { row: created, issue: state };
    });
    await this.publish(workspaceId, userId, issue, DOMAIN_EVENTS.WORKLOG_CREATED, issueId, row.id);
    return this.toDto(row);
  }

  async update(
    workspaceId: string,
    userId: string,
    id: string,
    input: UpdateWorklogInput,
  ): Promise<WorklogDto> {
    const current = await this.requireWorklog(workspaceId, id);
    await this.assertCanModify(userId, workspaceId, current);
    const sec = input.timeSpent !== undefined ? this.requireDuration(input.timeSpent) : undefined;
    const { row, issue } = await this.prisma.$transaction(async (tx) => {
      const state = await this.lockIssue(tx, workspaceId, current.issueId, userId);
      const updated = await tx.workLog.update({
        where: { id },
        data: {
          ...(sec !== undefined ? { timeSpent: sec } : {}),
          ...(input.startedAt !== undefined ? { startedAt: new Date(input.startedAt) } : {}),
          ...(input.comment !== undefined ? { comment: input.comment } : {}),
        },
        include: worklogInclude,
      });
      await this.recompute(tx, current.issueId, userId, state, input.adjustRemaining);
      return { row: updated, issue: state };
    });
    await this.publish(
      workspaceId,
      userId,
      issue,
      DOMAIN_EVENTS.WORKLOG_UPDATED,
      current.issueId,
      id,
    );
    return this.toDto(row);
  }

  async remove(
    workspaceId: string,
    userId: string,
    id: string,
    adjustRemaining?: AdjustRemainingInput,
  ): Promise<{ success: true }> {
    const current = await this.requireWorklog(workspaceId, id);
    await this.assertCanModify(userId, workspaceId, current);
    const issue = await this.prisma.$transaction(async (tx) => {
      const state = await this.lockIssue(tx, workspaceId, current.issueId, userId);
      await tx.workLog.delete({ where: { id } });
      await this.recompute(tx, current.issueId, userId, state, adjustRemaining);
      return state;
    });
    await this.publish(
      workspaceId,
      userId,
      issue,
      DOMAIN_EVENTS.WORKLOG_DELETED,
      current.issueId,
      id,
    );
    return { success: true };
  }

  // ---------- helpers ----------

  private requireDuration(text: string): number {
    const sec = parseDuration(text);
    if (sec === null || sec <= 0) {
      throw new BusinessRuleException(
        'Thời gian không hợp lệ — hãy nhập dạng 2h 30m, 90m hoặc 1d (1d = 8 giờ)',
      );
    }
    return sec;
  }

  /**
   * Khoá hàng issue bằng một UPDATE (tăng version) — hai worklog ghi đồng thời trên cùng issue
   * sẽ xếp hàng ở đây nên tổng `timeSpent` luôn tính trên dữ liệu đã commit của nhau.
   */
  private async lockIssue(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    issueId: string,
    userId: string,
  ): Promise<IssueTimeState> {
    // Dự án đã lưu trữ là chỉ đọc (BUG-5) — kiểm TRƯỚC khi bump version; ném trong $transaction thì rollback sạch.
    await assertIssueWritable(tx, issueId);
    const { count } = await tx.issue.updateMany({
      where: { id: issueId, workspaceId, deletedAt: null },
      data: { version: { increment: 1 }, updatedById: userId },
    });
    if (count === 0) throw new NotFoundAppException('Công việc');
    const state = await tx.issue.findFirst({
      where: { id: issueId, workspaceId, deletedAt: null },
      select: {
        key: true,
        projectId: true,
        sprintId: true,
        originalEstimate: true,
        remainingEstimate: true,
        timeSpent: true,
      },
    });
    if (!state) throw new NotFoundAppException('Công việc');
    return state;
  }

  /** Cộng lại tổng thời gian đã làm, chỉnh ước lượng còn lại theo `adjust`, ghi history. Sửa `state` tại chỗ. */
  private async recompute(
    tx: Prisma.TransactionClient,
    issueId: string,
    userId: string,
    state: IssueTimeState,
    adjust: AdjustRemainingInput | undefined,
  ): Promise<void> {
    const agg = await tx.workLog.aggregate({ where: { issueId }, _sum: { timeSpent: true } });
    const total = agg._sum.timeSpent ?? 0;
    if (total > MAX_ISSUE_TIME_SEC)
      throw new BusinessRuleException(
        'Tổng thời gian ghi nhận của công việc vượt giới hạn cho phép — hãy kiểm tra lại các bản ghi',
      );
    const remaining = this.nextRemaining(adjust ?? 'auto', state, total);
    const before = state.timeSpent ?? 0;
    await tx.issue.update({
      where: { id: issueId },
      data: { timeSpent: total, remainingEstimate: remaining },
    });
    if (before !== total) {
      await tx.issueHistory.create({
        data: {
          issueId,
          projectId: state.projectId,
          sprintId: state.sprintId,
          field: 'TIME_SPENT',
          oldValue: formatDuration(before),
          newValue: formatDuration(total),
          actorId: userId,
          occurredAt: new Date(),
        },
      });
    }
    state.timeSpent = total;
    state.remainingEstimate = remaining;
  }

  private nextRemaining(
    adjust: AdjustRemainingInput,
    state: IssueTimeState,
    total: number,
  ): number | null {
    if (adjust === 'leave') return state.remainingEstimate;
    if (typeof adjust === 'object') {
      const sec = parseDuration(adjust.set);
      if (sec === null)
        throw new BusinessRuleException('Thời gian còn lại không hợp lệ — hãy nhập dạng 2h 30m');
      return sec;
    }
    // auto: không có ước lượng gốc thì không có gì để trừ
    if (state.originalEstimate === null) return state.remainingEstimate;
    return Math.max(0, state.originalEstimate - total);
  }

  private async requireWorklog(workspaceId: string, id: string) {
    const row = await this.prisma.workLog.findFirst({
      where: { id, issue: { workspaceId, deletedAt: null } },
      select: { id: true, authorId: true, issueId: true, issue: { select: { projectId: true } } },
    });
    if (!row) throw new NotFoundAppException('Worklog');
    return row;
  }

  /** Chỉ tác giả hoặc quản trị (project admin / workspace admin / system admin) được sửa-xoá. */
  private async assertCanModify(
    userId: string,
    workspaceId: string,
    worklog: { authorId: string; issue: { projectId: string } },
  ): Promise<void> {
    if (worklog.authorId === userId) return;
    const perms = await this.rbac.getEffectivePermissions(
      userId,
      workspaceId,
      worklog.issue.projectId,
    );
    if (perms.has(PERMISSIONS.PROJECT_ADMIN) || perms.has(PERMISSIONS.WORKSPACE_ADMIN)) return;
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSystemAdmin: true },
    });
    if (u?.isSystemAdmin) return;
    throw new ForbiddenAppException(
      'Chỉ người ghi worklog hoặc quản trị dự án mới sửa/xoá được — hãy nhờ họ chỉnh giúp',
    );
  }

  /** Sau commit: báo realtime/automation rằng issue đổi (version, timeSpent) và worklog đổi. Lỗi ở đây không làm hỏng yêu cầu. */
  private async publish(
    workspaceId: string,
    actorId: string,
    state: IssueTimeState,
    event: string,
    issueId: string,
    worklogId: string,
  ): Promise<void> {
    try {
      const dto = await this.issues.getByKey(workspaceId, state.key, null);
      this.events.emit(DOMAIN_EVENTS.ISSUE_UPDATED, {
        issue: dto,
        actorId,
        changedFields: ['timeSpent', 'remainingEstimate'],
      });
      this.events.emit(event, { worklogId, issueId, projectId: state.projectId, actorId });
    } catch (err) {
      this.logger.warn(`Không phát được sự kiện worklog ${worklogId}: ${(err as Error).message}`);
    }
  }

  private toDto(r: WorklogRow): WorklogDto {
    return {
      id: r.id,
      issueId: r.issueId,
      author: { id: r.author.id, displayName: r.author.displayName, avatarUrl: r.author.avatarUrl },
      timeSpentSec: r.timeSpent,
      startedAt: r.startedAt.toISOString(),
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
