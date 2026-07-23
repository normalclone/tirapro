import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS } from '@tirapro/types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotFoundAppException, VersionConflictException } from '../../common/exceptions/app.exception';
import { cursorPage, PageResult } from '../../common/dto/page-result';

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
} satisfies Prisma.IssueInclude;

type TriageRow = Prisma.IssueGetPayload<{ include: typeof triageInclude }>;

/** DTO thẻ triage — gọn, phục vụ inbox + phản hồi mutation. */
export interface TriageItemDto {
  id: string;
  key: string;
  summary: string;
  projectId: string;
  type: { id: string; name: string; key: string | null; iconUrl: string | null; color: string | null; hierarchyLevel: number; isSubtask: boolean };
  status: { id: string; workflowId: string; name: string; category: string; color: string | null; order: number; isInitial: boolean };
  priority: { id: string; name: string; iconKey: string | null; color: string | null; rank: number; isDefault: boolean } | null;
  severity: { id: string; name: string; description: string | null; color: string | null; rank: number; isDefault: boolean } | null;
  assignee:
    | { id: string; email: string; displayName: string; avatarUrl: string | null; timezone: string; locale: string; status: string; isSystemAdmin: boolean; lastSeenAt: string | null; createdAt: string }
    | null;
  occurrenceCount: number;
  triageState: TriageRow['triageState'];
  triageSnoozeUntil: string | null;
  createdAt: string;
  version: number;
}

export interface AcceptTriageInput {
  version: number;
  assigneeId?: string;
}
export interface DeclineTriageInput {
  version: number;
  reason?: string;
}
export interface SnoozeTriageInput {
  version: number;
  until: string;
}

@Injectable()
export class TriageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Bộ lọc inbox: chưa xóa, đang chờ (PENDING) hoặc snooze đã tới hạn (SNOOZED && until <= now),
   * trong workspace hiện tại, tùy chọn lọc theo project.
   */
  private inboxWhere(workspaceId: string, projectId: string | undefined, now: Date): Prisma.IssueWhereInput {
    return {
      workspaceId,
      deletedAt: null,
      ...(projectId ? { projectId } : {}),
      OR: [
        { triageState: 'PENDING' },
        { triageState: 'SNOOZED', triageSnoozeUntil: { lte: now } },
      ],
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
    return cursorPage(rows.map((r) => this.toDto(r)), limit, (i) => i.id);
  }

  /** Số lượng issue đang chờ triage (cùng bộ lọc với inbox). */
  async count(workspaceId: string, projectId: string | undefined): Promise<{ count: number }> {
    const count = await this.prisma.issue.count({
      where: this.inboxWhere(workspaceId, projectId, new Date()),
    });
    return { count };
  }

  /** Chấp nhận issue vào backlog: ACCEPTED, xóa snooze, tùy chọn gán người thực hiện. */
  async accept(workspaceId: string, userId: string, issueId: string, input: AcceptTriageInput): Promise<TriageItemDto> {
    const current = await this.requireIssue(workspaceId, issueId);
    this.assertVersion(current.version, input.version);

    const data: Prisma.IssueUpdateInput = {
      triageState: 'ACCEPTED',
      triageSnoozeUntil: null,
      version: { increment: 1 },
      updatedById: userId,
    };
    if (input.assigneeId !== undefined) {
      data.assignee = input.assigneeId ? { connect: { id: input.assigneeId } } : { disconnect: true };
    }
    return this.applyAndEmit(issueId, data, userId);
  }

  /** Từ chối issue: DECLINED (không vào backlog). */
  async decline(workspaceId: string, userId: string, issueId: string, input: DeclineTriageInput): Promise<TriageItemDto> {
    const current = await this.requireIssue(workspaceId, issueId);
    this.assertVersion(current.version, input.version);

    return this.applyAndEmit(
      issueId,
      {
        triageState: 'DECLINED',
        version: { increment: 1 },
        updatedById: userId,
      },
      userId,
    );
  }

  /** Tạm hoãn issue tới mốc thời gian: SNOOZED + triageSnoozeUntil. */
  async snooze(workspaceId: string, userId: string, issueId: string, input: SnoozeTriageInput): Promise<TriageItemDto> {
    const current = await this.requireIssue(workspaceId, issueId);
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
  private async applyAndEmit(issueId: string, data: Prisma.IssueUpdateInput, userId: string): Promise<TriageItemDto> {
    const updated = await this.prisma.issue.update({ where: { id: issueId }, data, include: triageInclude });
    const dto = this.toDto(updated);
    this.events.emit(DOMAIN_EVENTS.ISSUE_UPDATED, { issue: dto, actorId: userId });
    return dto;
  }

  private async requireIssue(workspaceId: string, issueId: string): Promise<TriageRow> {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, workspaceId, deletedAt: null },
      include: triageInclude,
    });
    if (!issue) throw new NotFoundAppException('Issue');
    return issue;
  }

  private assertVersion(currentVersion: number, inputVersion: number): void {
    if (currentVersion !== inputVersion) {
      throw new VersionConflictException('Issue đã được người khác cập nhật, hãy tải lại', { version: currentVersion });
    }
  }

  private toDto(i: TriageRow): TriageItemDto {
    return {
      id: i.id,
      key: i.key,
      summary: i.summary,
      projectId: i.projectId,
      type: { id: i.type.id, name: i.type.name, key: i.type.key, iconUrl: i.type.iconUrl, color: i.type.color, hierarchyLevel: i.type.hierarchyLevel, isSubtask: i.type.isSubtask },
      status: { id: i.status.id, workflowId: i.status.workflowId, name: i.status.name, category: i.status.category, color: i.status.color, order: i.status.order, isInitial: i.status.isInitial },
      priority: i.priority ? { id: i.priority.id, name: i.priority.name, iconKey: i.priority.iconKey, color: i.priority.color, rank: i.priority.rank, isDefault: i.priority.isDefault } : null,
      severity: i.severity ? { id: i.severity.id, name: i.severity.name, description: i.severity.description, color: i.severity.color, rank: i.severity.rank, isDefault: i.severity.isDefault } : null,
      assignee: i.assignee ? this.userDto(i.assignee) : null,
      occurrenceCount: i.occurrenceCount,
      triageState: i.triageState,
      triageSnoozeUntil: i.triageSnoozeUntil?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
      version: i.version,
    };
  }

  private userDto(u: { id: string; email: string; displayName: string; avatarUrl: string | null; timezone: string; locale: string; status: string; isSystemAdmin: boolean; lastSeenAt: Date | null; createdAt: Date }) {
    return { id: u.id, email: u.email, displayName: u.displayName, avatarUrl: u.avatarUrl, timezone: u.timezone, locale: u.locale, status: u.status, isSystemAdmin: u.isSystemAdmin, lastSeenAt: u.lastSeenAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString() };
  }
}
