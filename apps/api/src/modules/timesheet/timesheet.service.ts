import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PERMISSIONS } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { RbacService } from '../rbac/rbac.service';
import { addDays, eachDay, isoDay, parseDayParam, startOfWeek, toUtcDay } from '../resources/date.util';
import type { IssueSearchQuery, LogTimeInput, SetCellInput, TimesheetQuery } from './timesheet.schemas';

/** Trần số ngày một lần xem bảng chấm công (mặc định 1 tuần). */
const MAX_DAYS = 62;
/** Trần số dòng gợi ý (issue được giao nhưng chưa ghi công). */
const MAX_SUGGESTED_ROWS = 40;

const ROW_ISSUE_SELECT = {
  id: true, key: true, summary: true, projectId: true,
  project: { select: { key: true, name: true } },
  type: { select: { name: true, color: true } },
} satisfies Prisma.IssueSelect;

export interface TimesheetEntry {
  id: string;
  date: string;
  timeSpent: number;
  comment: string | null;
}

export interface TimesheetRow {
  issueId: string;
  issueKey: string;
  summary: string;
  projectId: string;
  projectKey: string;
  typeName: string | null;
  typeColor: string | null;
  /** { 'YYYY-MM-DD': số giây } — chỉ chứa ngày có giờ. */
  perDay: Record<string, number>;
  total: number;
  entries: TimesheetEntry[];
  /** true = issue đang được giao cho người này nhưng chưa ghi công trong kỳ (dòng gợi ý). */
  suggested: boolean;
}

export interface TimesheetReport {
  from: string;
  to: string;
  userId: string;
  canViewOthers: boolean;
  days: string[];
  rows: TimesheetRow[];
  totalsByDay: Record<string, number>;
  total: number;
}

/**
 * Chấm công (timesheet) — ghi giờ theo NGÀY, KHÔNG có bước duyệt.
 *
 * - Mặc định thao tác trên chính người gọi. Xem/ghi hộ người khác cần `resource:manage`.
 * - `startedAt` được chuẩn hoá về nửa đêm UTC → mỗi ô lưới = (issue × ngày).
 * - Xoá một bản ghi: tác giả, hoặc người có `project:admin` ở dự án của issue
 *   (hoặc `resource:manage` ở workspace).
 */
@Injectable()
export class TimesheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  /* ─────────────────────────── Đọc ─────────────────────────── */

  async getTimesheet(workspaceId: string, caller: AuthUser, q: TimesheetQuery): Promise<TimesheetReport> {
    const today = new Date();
    const from = parseDayParam(q.from, startOfWeek(today));
    let to = parseDayParam(q.to, addDays(from, 6));
    if (to < from) to = from;
    if ((to.getTime() - from.getTime()) / (24 * 3600 * 1000) > MAX_DAYS - 1) to = addDays(from, MAX_DAYS - 1);

    const canViewOthers = await this.canManage(caller);
    const userId = await this.resolveTargetUser(workspaceId, caller, q.userId, canViewOthers);
    const days = eachDay(from, to).map(isoDay);
    const projectFilter = q.projectId ? { projectId: q.projectId } : {};

    const logs = await this.prisma.workLog.findMany({
      where: {
        authorId: userId,
        startedAt: { gte: from, lt: addDays(to, 1) },
        issue: { workspaceId, deletedAt: null, ...projectFilter },
      },
      orderBy: [{ startedAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, issueId: true, timeSpent: true, startedAt: true, comment: true,
        issue: { select: ROW_ISSUE_SELECT },
      },
    });

    const byIssue = new Map<string, TimesheetRow>();
    const totalsByDay: Record<string, number> = {};
    for (const d of days) totalsByDay[d] = 0;
    let total = 0;

    for (const log of logs) {
      const row = byIssue.get(log.issueId) ?? this.emptyRow(log.issue, false);
      byIssue.set(log.issueId, row);
      const day = isoDay(log.startedAt);
      row.perDay[day] = (row.perDay[day] ?? 0) + log.timeSpent;
      row.total += log.timeSpent;
      row.entries.push({ id: log.id, date: day, timeSpent: log.timeSpent, comment: log.comment });
      totalsByDay[day] = (totalsByDay[day] ?? 0) + log.timeSpent;
      total += log.timeSpent;
    }

    // Dòng gợi ý: issue đang được giao & chưa xong → nhập giờ ngay, không phải đi tìm.
    const suggested = await this.prisma.issue.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        assigneeId: userId,
        ...projectFilter,
        status: { category: { not: 'DONE' } },
        ...(byIssue.size > 0 ? { id: { notIn: [...byIssue.keys()] } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: MAX_SUGGESTED_ROWS,
      select: ROW_ISSUE_SELECT,
    });

    const rows = [...byIssue.values()].sort(
      (a, b) => a.projectKey.localeCompare(b.projectKey) || a.issueKey.localeCompare(b.issueKey, undefined, { numeric: true }),
    );
    rows.push(...suggested.map((i) => this.emptyRow(i, true)));

    return { from: isoDay(from), to: isoDay(to), userId, canViewOthers, days, rows, totalsByDay, total };
  }

  /** Tìm issue để thêm dòng vào lưới chấm công. */
  async searchIssues(workspaceId: string, q: IssueSearchQuery) {
    const term = q.q?.trim() ?? '';
    const rows = await this.prisma.issue.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...(term
          ? { OR: [{ key: { contains: term, mode: 'insensitive' } }, { summary: { contains: term, mode: 'insensitive' } }] }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: ROW_ISSUE_SELECT,
    });
    return rows.map((i) => ({
      issueId: i.id,
      issueKey: i.key,
      summary: i.summary,
      projectId: i.projectId,
      projectKey: i.project.key,
    }));
  }

  /* ─────────────────────────── Ghi ─────────────────────────── */

  /** Ghi nhanh một bản ghi công (cộng dồn vào ngày đó, không thay thế). */
  async logTime(workspaceId: string, caller: AuthUser, dto: LogTimeInput) {
    const canManage = await this.canManage(caller);
    const authorId = await this.resolveTargetUser(workspaceId, caller, dto.userId ?? undefined, canManage);
    await this.requireIssue(workspaceId, dto.issueId);

    const created = await this.prisma.workLog.create({
      data: {
        issueId: dto.issueId,
        authorId,
        timeSpent: dto.timeSpent,
        startedAt: toUtcDay(dto.startedAt),
        comment: dto.comment ?? null,
      },
      select: { id: true, issueId: true, authorId: true, timeSpent: true, startedAt: true, comment: true },
    });
    return { ...created, startedAt: isoDay(created.startedAt) };
  }

  /**
   * Đặt TỔNG giờ của một ô (issue × ngày) — ngữ nghĩa của lưới nhập.
   * Giữ lại bản ghi sớm nhất (giữ ghi chú), gộp phần còn lại; `timeSpent = 0` → xoá cả ngày.
   */
  async setCell(workspaceId: string, caller: AuthUser, dto: SetCellInput) {
    const canManage = await this.canManage(caller);
    const authorId = await this.resolveTargetUser(workspaceId, caller, dto.userId ?? undefined, canManage);
    await this.requireIssue(workspaceId, dto.issueId);

    const day = toUtcDay(dto.date);
    const existing = await this.prisma.workLog.findMany({
      where: { issueId: dto.issueId, authorId, startedAt: { gte: day, lt: addDays(day, 1) } },
      orderBy: [{ startedAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, comment: true },
    });

    if (dto.timeSpent === 0) {
      if (existing.length > 0) {
        await this.prisma.workLog.deleteMany({ where: { id: { in: existing.map((e) => e.id) } } });
      }
      return { issueId: dto.issueId, date: isoDay(day), timeSpent: 0 };
    }

    if (existing.length === 0) {
      await this.prisma.workLog.create({
        data: { issueId: dto.issueId, authorId, timeSpent: dto.timeSpent, startedAt: day, comment: dto.comment ?? null },
      });
    } else {
      const [keep, ...rest] = existing;
      const ops: Prisma.PrismaPromise<unknown>[] = [
        this.prisma.workLog.update({
          where: { id: keep.id },
          data: { timeSpent: dto.timeSpent, ...(dto.comment !== undefined ? { comment: dto.comment } : {}) },
        }),
      ];
      if (rest.length > 0) ops.push(this.prisma.workLog.deleteMany({ where: { id: { in: rest.map((r) => r.id) } } }));
      await this.prisma.$transaction(ops);
    }
    return { issueId: dto.issueId, date: isoDay(day), timeSpent: dto.timeSpent };
  }

  /** Xoá một bản ghi công — chỉ tác giả, hoặc quản trị dự án của issue. */
  async deleteLog(workspaceId: string, caller: AuthUser, id: string) {
    const log = await this.prisma.workLog.findFirst({
      where: { id, issue: { workspaceId } },
      select: { id: true, authorId: true, issue: { select: { projectId: true } } },
    });
    if (!log) throw new NotFoundAppException('Bản ghi công');

    if (log.authorId !== caller.id) {
      const allowed = await this.hasAny(caller, [PERMISSIONS.RESOURCE_MANAGE, PERMISSIONS.PROJECT_ADMIN], log.issue.projectId);
      if (!allowed) throw new ForbiddenAppException('Chỉ tác giả hoặc quản trị dự án mới xoá được bản ghi công này');
    }

    await this.prisma.workLog.delete({ where: { id } });
    return { success: true };
  }

  /* ─────────────────────────── helpers ─────────────────────────── */

  private emptyRow(
    issue: { id: string; key: string; summary: string; projectId: string; project: { key: string }; type: { name: string; color: string | null } | null },
    suggested: boolean,
  ): TimesheetRow {
    return {
      issueId: issue.id,
      issueKey: issue.key,
      summary: issue.summary,
      projectId: issue.projectId,
      projectKey: issue.project.key,
      typeName: issue.type?.name ?? null,
      typeColor: issue.type?.color ?? null,
      perDay: {},
      total: 0,
      entries: [],
      suggested,
    };
  }

  /** Người được thao tác: mặc định là người gọi; khác người gọi thì phải có quyền. */
  private async resolveTargetUser(
    workspaceId: string,
    caller: AuthUser,
    requested: string | undefined,
    canManage: boolean,
  ): Promise<string> {
    if (!requested || requested === caller.id) return caller.id;
    if (!canManage) throw new ForbiddenAppException('Bạn không có quyền xem hoặc ghi công của người khác');
    const member = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: requested } },
      select: { id: true },
    });
    if (!member) throw new BusinessRuleException('Người dùng không thuộc workspace này');
    return requested;
  }

  private async requireIssue(workspaceId: string, issueId: string) {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, workspaceId, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (!issue) throw new NotFoundAppException('Công việc');
    return issue;
  }

  private canManage(caller: AuthUser): Promise<boolean> {
    return this.hasAny(caller, [PERMISSIONS.RESOURCE_MANAGE], null);
  }

  private async hasAny(caller: AuthUser, perms: string[], projectId: string | null): Promise<boolean> {
    if (caller.isSystemAdmin) return true;
    if (!caller.workspaceId) return false;
    const effective = await this.rbac.getEffectivePermissions(caller.id, caller.workspaceId, projectId);
    return perms.some((p) => effective.has(p));
  }
}
