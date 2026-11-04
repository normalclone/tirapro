import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { overdueCutoff, vnTodayUtc } from '@tirapro/shared';
import type { MeIssueItemDto, MeOverviewDto } from '@tirapro/types';
import { countsTowardPoints, LEAF_POINTS_ONLY, LIVE_CHILD_COUNT } from '../../common/points-scope';
import { TRIAGE_VISIBLE } from '../../common/triage-visibility';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ProjectAccessService } from '../rbac/project-access.service';
import { addDays } from '../resources/date.util';
import {
  bucketDonePoints,
  classifyStatuses,
  sortMyIssueKeys,
  vnWeekStarts,
} from './me-overview.logic';

const MY_ISSUES_LIMIT = 50;
const BUG_LIST_LIMIT = 50;
/** Trần số việc mở của MỘT người nạp để sắp xếp trong bộ nhớ (một người hiếm khi có hàng nghìn việc mở). */
const MAX_OPEN_SCAN = 2000;
/** Trần số việc đã xong nạp để cộng điểm 8 tuần. */
const MAX_DONE_SCAN = 5000;
/** "Sắp đến hạn" = 7 ngày kể cả hôm nay: hôm nay … hôm nay + 6 (ngày lịch VN). */
const DUE_SOON_DAYS = 7;

const ITEM_SELECT = {
  id: true,
  key: true,
  summary: true,
  projectId: true,
  storyPoints: true,
  dueDate: true,
  project: { select: { key: true } },
  type: { select: { id: true, name: true, key: true } },
  status: { select: { id: true, name: true, category: true } },
  priority: { select: { id: true, name: true, rank: true } },
} satisfies Prisma.IssueSelect;

type ItemRow = Prisma.IssueGetPayload<{ select: typeof ITEM_SELECT }>;

const toItem = (r: ItemRow): MeIssueItemDto => ({
  id: r.id,
  key: r.key,
  summary: r.summary,
  projectId: r.projectId,
  projectKey: r.project.key,
  type: r.type,
  status: r.status,
  priority: r.priority,
  points: r.storyPoints,
  dueDate: r.dueDate ? r.dueDate.toISOString() : null,
});

/**
 * Tổng quan cá nhân (`GET /me/overview`) trong tổ chức hiện tại. Phạm vi việc = đúng luật hiển thị của tìm kiếm/Tổng quan:
 * `ProjectAccessService.visibleWhere` (dự án riêng tư chỉ cho thành viên), dự án chưa xoá, việc chưa xoá, việc đã duyệt
 * (`TRIAGE_VISIBLE`). Không có đường tắt bỏ qua RBAC.
 */
@Injectable()
export class MeOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async overview(
    organizationId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<MeOverviewDto> {
    const visible = await this.access.visibleWhere(userId, organizationId);
    const base: Prisma.IssueWhereInput = {
      organizationId,
      deletedAt: null,
      project: { deletedAt: null, ...visible },
      // Trong `AND` (không spread `OR` của TRIAGE_VISIBLE) để không đè `OR` ở các where dẫn xuất.
      AND: [TRIAGE_VISIBLE],
    };
    const openMine: Prisma.IssueWhereInput = {
      ...base,
      assigneeId: userId,
      status: { category: { not: 'DONE' } },
    };
    const today = vnTodayUtc(now);
    const weeks = vnWeekStarts(now);

    const statuses = await this.prisma.status.findMany({
      where: { workflow: { organizationId } },
      select: { id: true, name: true, category: true },
    });
    const { awaitingRetest, reopened } = classifyStatuses(statuses);
    const bugOf = (extra: Prisma.IssueWhereInput): Prisma.IssueWhereInput => ({
      ...base,
      type: { key: 'BUG' },
      ...extra,
    });

    const [open, overdue, dueSoon, openKeys, doneRows, retest, reopen, assigned] =
      await Promise.all([
        this.prisma.issue.count({ where: openMine }),
        this.prisma.issue.count({
          where: { ...openMine, dueDate: { lt: overdueCutoff(now) } },
        }),
        this.prisma.issue.count({
          where: { ...openMine, dueDate: { gte: today, lte: addDays(today, DUE_SOON_DAYS - 1) } },
        }),
        this.prisma.issue.findMany({
          where: openMine,
          select: { id: true, dueDate: true, priority: { select: { rank: true } } },
          orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
          take: MAX_OPEN_SCAN,
        }),
        this.prisma.issue.findMany({
          where: {
            ...base,
            ...LEAF_POINTS_ONLY, // điểm Epic/việc cha = tổng việc con: chỉ cộng việc lá
            assigneeId: userId,
            status: { category: 'DONE' },
            resolvedAt: { gte: weeks[0]!.from },
            storyPoints: { not: null },
          },
          select: {
            storyPoints: true,
            resolvedAt: true,
            project: { select: { key: true } },
            type: { select: { key: true } },
            ...LIVE_CHILD_COUNT,
          },
          orderBy: { resolvedAt: 'desc' },
          take: MAX_DONE_SCAN,
        }),
        this.bugList(bugOf({ reporterId: userId, statusId: { in: awaitingRetest } })),
        this.bugList(bugOf({ reporterId: userId, statusId: { in: reopened } })),
        this.bugList(bugOf({ assigneeId: userId, status: { category: { not: 'DONE' } } })),
      ]);

    const top = sortMyIssueKeys(
      openKeys.map((r) => ({
        id: r.id,
        dueDate: r.dueDate,
        priorityRank: r.priority?.rank ?? null,
      })),
    ).slice(0, MY_ISSUES_LIMIT);
    const topRows = top.length
      ? await this.prisma.issue.findMany({
          where: { ...openMine, id: { in: top.map((t) => t.id) } },
          select: ITEM_SELECT,
        })
      : [];
    const byId = new Map(topRows.map((r) => [r.id, r]));
    const myIssues = top.flatMap((t) => (byId.has(t.id) ? [toItem(byId.get(t.id)!)] : []));

    const done = doneRows
      .filter((r) => countsTowardPoints(r))
      .map((r) => ({
        resolvedAt: r.resolvedAt!,
        projectKey: r.project.key,
        points: r.storyPoints!,
      }));
    const weeklyDonePoints = bucketDonePoints(weeks, done);
    const thisWeek = weeklyDonePoints[weeklyDonePoints.length - 1]!;
    const donePointsThisWeek =
      Math.round(thisWeek.byProject.reduce((s, p) => s + p.points, 0) * 100) / 100;

    return {
      counts: { open, overdue, dueSoon, donePointsThisWeek },
      myIssues,
      bugs: { awaitingRetest: retest, reopened: reopen, assignedToMe: assigned },
      weeklyDonePoints,
    };
  }

  private async bugList(where: Prisma.IssueWhereInput): Promise<MeIssueItemDto[]> {
    // `where` luôn dựng từ `base` (organizationId, deletedAt: null, dự án xem được, đã duyệt).
    const rows = await this.prisma.issue.findMany({
      where,
      select: ITEM_SELECT,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: BUG_LIST_LIMIT,
    });
    return rows.map(toItem);
  }
}
