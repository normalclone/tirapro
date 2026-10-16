import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DOMAIN_EVENTS,
  type IssueEnvironment,
  type TriageItemDto,
  type TriageKind,
} from '@tirapro/types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { toUserDto } from '../../common/mappers/user.mapper';
import {
  NotFoundAppException,
  VersionConflictException,
} from '../../common/exceptions/app.exception';
import { cursorPage, PageResult } from '../../common/dto/page-result';
import { assertIssueWritable } from '../../common/project-writable';
import { IssuesService } from '../issues/issues.service';
import { CommentsService } from '../comments/comments.service';

/**
 * Include gọn cho hàng đợi triage — đủ render thẻ inbox (type/status/priority/severity/assignee)
 * mà không kéo toàn bộ quan hệ nặng của issue.
 */
const triageInclude = {
  type: true,
  status: true,
  priority: true,
  severity: true,
  assignee: true,
  reporter: true,
} satisfies Prisma.IssueInclude;

type TriageRow = Prisma.IssueGetPayload<{ include: typeof triageInclude }>;

export interface AcceptTriageInput {
  version: number;
  assigneeId?: string;
  /** Đổi loại (Story/Task/Bug…) khi nhận. */
  typeId?: string;
  /** `null` = bỏ ưu tiên. */
  priorityId?: string | null;
  /** `null` = đưa về Việc chờ (không vào sprint nào). */
  sprintId?: string | null;
}
export interface DeclineTriageInput {
  version: number;
  reason?: string;
}
export interface SnoozeTriageInput {
  version: number;
  until: string;
}

const TRIAGE_KINDS: readonly string[] = ['BUG', 'FEATURE', 'QUESTION'];

@Injectable()
export class TriageService {
  private readonly logger = new Logger(TriageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly issues: IssuesService,
    private readonly comments: CommentsService,
  ) {}

  /**
   * Bộ lọc inbox: chưa xóa, đang chờ (PENDING) hoặc snooze đã tới hạn (SNOOZED && until <= now),
   * trong workspace hiện tại, tùy chọn lọc theo project.
   */
  private inboxWhere(
    workspaceId: string,
    projectId: string | undefined,
    now: Date,
  ): Prisma.IssueWhereInput {
    return {
      workspaceId,
      deletedAt: null,
      ...(projectId ? { projectId } : {}),
      OR: [{ triageState: 'PENDING' }, { triageState: 'SNOOZED', triageSnoozeUntil: { lte: now } }],
    };
  }

  /** Hàng đợi triage của workspace, sắp xếp theo lần lặp nhiều nhất / cũ nhất trước. */
  async inbox(
    workspaceId: string,
    projectId: string | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<PageResult<TriageItemDto>> {
    const rows = await this.prisma.issue.findMany({
      where: this.inboxWhere(workspaceId, projectId, new Date()),
      include: triageInclude,
      orderBy: [{ occurrenceCount: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return cursorPage(
      rows.map((r) => this.toDto(r)),
      limit,
      (i) => i.id,
    );
  }

  /** Số lượng issue đang chờ triage (cùng bộ lọc với inbox). */
  async count(workspaceId: string, projectId: string | undefined): Promise<{ count: number }> {
    const count = await this.prisma.issue.count({
      where: this.inboxWhere(workspaceId, projectId, new Date()),
    });
    return { count };
  }

  /**
   * Chấp nhận issue vào backlog: ACCEPTED, xóa snooze. Tùy chọn đổi loại/ưu tiên/sprint/người phụ trách:
   * các trường đó đi qua MỘT lần `IssuesService.update` (cùng kiểm tra workspace/dự án, sprint đã đóng, lịch sử, OCC)
   * rồi mới đặt ACCEPTED. Không có trường nào ngoài triage thì giữ đường nhận một chạm.
   */
  async accept(
    workspaceId: string,
    userId: string,
    issueId: string,
    input: AcceptTriageInput,
    ownOnly = false,
  ): Promise<TriageItemDto> {
    const current = await this.requireIssue(workspaceId, issueId);
    await assertIssueWritable(this.prisma, issueId);
    this.assertVersion(current.version, input.version);

    const { typeId, priorityId, sprintId, assigneeId } = input;
    const hasIssueFields =
      typeId !== undefined || priorityId !== undefined || sprintId !== undefined;
    if (hasIssueFields) {
      await this.issues.update(
        workspaceId,
        userId,
        issueId,
        {
          version: input.version,
          ...(typeId ? { typeId } : {}),
          ...(priorityId !== undefined ? { priorityId } : {}),
          ...(sprintId !== undefined ? { sprintId } : {}),
          ...(assigneeId !== undefined ? { assigneeId: assigneeId || null } : {}),
        },
        undefined,
        ownOnly,
      );
    }

    const data: Prisma.IssueUpdateInput = {
      triageState: 'ACCEPTED',
      triageSnoozeUntil: null,
      version: { increment: 1 },
      updatedById: userId,
    };
    if (!hasIssueFields && assigneeId !== undefined) {
      data.assignee = assigneeId ? { connect: { id: assigneeId } } : { disconnect: true };
    }
    return this.applyAndEmit(issueId, data, userId);
  }

  /**
   * Từ chối issue: DECLINED (không vào backlog). Có `reason` thì người gửi thành watcher và lý do được ghi thành
   * bình luận (đường watcher báo cho họ) — ghi SAU khi từ chối nên lỗi bình luận không huỷ quyết định.
   */
  async decline(
    workspaceId: string,
    userId: string,
    issueId: string,
    input: DeclineTriageInput,
  ): Promise<TriageItemDto> {
    const current = await this.requireIssue(workspaceId, issueId);
    await assertIssueWritable(this.prisma, issueId);
    this.assertVersion(current.version, input.version);

    const dto = await this.applyAndEmit(
      issueId,
      {
        triageState: 'DECLINED',
        version: { increment: 1 },
        updatedById: userId,
      },
      userId,
    );
    const reason = input.reason?.trim();
    if (reason) await this.recordDeclineReason(workspaceId, userId, current, reason);
    return dto;
  }

  /** Tạm hoãn issue tới mốc thời gian: SNOOZED + triageSnoozeUntil. */
  async snooze(
    workspaceId: string,
    userId: string,
    issueId: string,
    input: SnoozeTriageInput,
  ): Promise<TriageItemDto> {
    const current = await this.requireIssue(workspaceId, issueId);
    await assertIssueWritable(this.prisma, issueId);
    this.assertVersion(current.version, input.version);

    return this.applyAndEmit(
      issueId,
      {
        triageState: 'SNOOZED',
        triageSnoozeUntil: new Date(input.until),
        version: { increment: 1 },
        updatedById: userId,
      },
      userId,
    );
  }

  // ---------- helpers ----------
  private async recordDeclineReason(
    workspaceId: string,
    userId: string,
    issue: TriageRow,
    reason: string,
  ): Promise<void> {
    try {
      const reporterId = issue.reporterId;
      if (reporterId && reporterId !== userId) {
        await this.prisma.issueWatcher.createMany({
          data: [{ issueId: issue.id, userId: reporterId }],
          skipDuplicates: true,
        });
      }
      const actor = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { displayName: true },
      });
      await this.comments.create(workspaceId, userId, issue.id, {
        body: `*${actor?.displayName ?? 'Người duyệt'} từ chối yêu cầu này*\n\n${reason}`,
        bodyFormat: 'MARKDOWN',
      });
    } catch (err) {
      this.logger.warn(
        `Đã từ chối ${issue.key} nhưng không ghi được lý do: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async applyAndEmit(
    issueId: string,
    data: Prisma.IssueUpdateInput,
    userId: string,
  ): Promise<TriageItemDto> {
    const updated = await this.prisma.issue.update({
      where: { id: issueId },
      data,
      include: triageInclude,
    });
    const dto = this.toDto(updated);
    this.events.emit(DOMAIN_EVENTS.ISSUE_UPDATED, { issue: dto, actorId: userId });
    return dto;
  }

  private async requireIssue(workspaceId: string, issueId: string): Promise<TriageRow> {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, workspaceId, deletedAt: null },
      include: triageInclude,
    });
    if (!issue) throw new NotFoundAppException('Công việc');
    return issue;
  }

  private assertVersion(currentVersion: number, inputVersion: number): void {
    if (currentVersion !== inputVersion) {
      throw new VersionConflictException(
        'Người khác vừa sửa công việc này — hãy tải lại để xem bản mới nhất rồi thao tác lại',
        { version: currentVersion },
      );
    }
  }

  private toDto(i: TriageRow): TriageItemDto {
    return {
      id: i.id,
      key: i.key,
      summary: i.summary,
      projectId: i.projectId,
      description: i.description,
      reporter: i.reporter ? toUserDto(i.reporter) : null,
      kind: TRIAGE_KINDS.includes(i.triageSource ?? '') ? (i.triageSource as TriageKind) : null,
      environment: (i.environment as IssueEnvironment | null) ?? null,
      type: {
        id: i.type.id,
        name: i.type.name,
        key: i.type.key,
        iconUrl: i.type.iconUrl,
        color: i.type.color,
        hierarchyLevel: i.type.hierarchyLevel,
        isSubtask: i.type.isSubtask,
      },
      status: {
        id: i.status.id,
        workflowId: i.status.workflowId,
        name: i.status.name,
        category: i.status.category,
        color: i.status.color,
        order: i.status.order,
        isInitial: i.status.isInitial,
      },
      priority: i.priority
        ? {
            id: i.priority.id,
            name: i.priority.name,
            iconKey: i.priority.iconKey,
            color: i.priority.color,
            rank: i.priority.rank,
            isDefault: i.priority.isDefault,
          }
        : null,
      severity: i.severity
        ? {
            id: i.severity.id,
            name: i.severity.name,
            description: i.severity.description,
            color: i.severity.color,
            rank: i.severity.rank,
            isDefault: i.severity.isDefault,
          }
        : null,
      assignee: i.assignee ? toUserDto(i.assignee) : null,
      sprintId: i.sprintId,
      occurrenceCount: i.occurrenceCount,
      lastOccurredAt: i.lastOccurredAt?.toISOString() ?? null,
      triageState: i.triageState,
      triageSnoozeUntil: i.triageSnoozeUntil?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
      version: i.version,
    };
  }
}
