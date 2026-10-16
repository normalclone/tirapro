import { Injectable } from '@nestjs/common';
import type { QaReportDto } from '@tirapro/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import {
  bucketByRelease,
  bucketOpenBySeverity,
  closeTimeStats,
  reopenRate,
  type ReleaseBugRow,
} from './qa-report';

/** "Bug" = loại công việc có key BUG hoặc tên "Bug" (không phân biệt hoa thường) — cùng quy ước `isBugType` ở FE. */
const BUG_TYPE: Prisma.IssueTypeWhereInput = {
  OR: [{ key: 'BUG' }, { name: { equals: 'Bug', mode: 'insensitive' } }],
};

const DAY = 86_400_000;
const MAX_RANGE_DAYS = 366;
const CLOSE_TIME_LIMIT = 5000;
const HISTORY_LIMIT = 20_000;
const RELEASE_LIMIT = 10_000;

/** Đầu ngày UTC / cuối ngày UTC để kỳ lọc bao trọn ngày cuối (client gửi `YYYY-MM-DD`). */
const startOfDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const endOfDay = (d: Date) => new Date(startOfDay(d).getTime() + DAY - 1);

function parseRange(fromStr?: string, toStr?: string): { from: Date; to: Date } {
  const toRaw = toStr ? new Date(toStr) : new Date();
  const fromRaw = fromStr ? new Date(fromStr) : new Date(toRaw.getTime() - 29 * DAY);
  if (Number.isNaN(toRaw.getTime()) || Number.isNaN(fromRaw.getTime())) {
    throw new BusinessRuleException('Khoảng thời gian không hợp lệ');
  }
  const from = startOfDay(fromRaw);
  const to = endOfDay(toRaw);
  if (from > to) throw new BusinessRuleException('Ngày bắt đầu phải trước ngày kết thúc');
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY) {
    throw new BusinessRuleException(`Khoảng thời gian tối đa ${MAX_RANGE_DAYS} ngày`);
  }
  return { from, to };
}

/**
 * Báo cáo QA của một dự án (chỉ đọc). Quyền xem (`report:view` + dự án riêng tư → 404) do PermissionsGuard
 * kiểm qua `@ProjectRef('query','projectId')` trước khi vào đây; service chỉ khoá phạm vi theo dự án.
 * Dự án rất lớn (> ~50k bug) sẽ cần bảng tổng hợp — ngoài phạm vi.
 */
@Injectable()
export class QaReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(
    workspaceId: string,
    projectId: string,
    fromStr?: string,
    toStr?: string,
  ): Promise<QaReportDto> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundAppException('Dự án');
    const { from, to } = parseRange(fromStr, toStr);

    const bugs: Prisma.IssueWhereInput = { projectId, deletedAt: null, type: BUG_TYPE };
    const inRange = { gte: from, lte: to };
    const statusEvents = (extra: Prisma.IssueHistoryWhereInput) =>
      this.prisma.issueHistory.findMany({
        where: {
          projectId,
          field: 'STATUS',
          occurredAt: inRange,
          issue: { deletedAt: null, type: BUG_TYPE },
          ...extra,
        },
        select: { issueId: true },
        distinct: ['issueId'],
        take: HISTORY_LIMIT,
      });

    const [openGroups, created, closedEvents, reopenedEvents, closedRows, severities, versions] =
      await Promise.all([
        this.prisma.issue.groupBy({
          by: ['severityId'],
          where: { ...bugs, status: { category: { not: 'DONE' } } },
          _count: { _all: true },
        }),
        this.prisma.issue.count({ where: { ...bugs, createdAt: inRange } }),
        statusEvents({ newCategory: 'DONE' }),
        statusEvents({ oldCategory: 'DONE', newCategory: { not: 'DONE' } }),
        this.prisma.issue.findMany({
          where: { ...bugs, status: { category: 'DONE' }, resolvedAt: inRange },
          select: { createdAt: true, resolvedAt: true },
          orderBy: { resolvedAt: 'desc' },
          take: CLOSE_TIME_LIMIT,
        }),
        this.prisma.severity.findMany({
          where: { workspaceId },
          select: { id: true, name: true, color: true, rank: true },
        }),
        this.prisma.version.findMany({
          where: { projectId },
          select: { id: true, name: true, status: true, releaseDate: true },
        }),
      ]);

    const closedIds = new Set(closedEvents.map((e) => e.issueId));
    const reopenedIds = new Set(reopenedEvents.map((e) => e.issueId));
    const openBySeverity = bucketOpenBySeverity(
      openGroups.map((g) => ({ severityId: g.severityId, count: g._count._all })),
      severities,
    );

    // Ưu tiên "phiên bản bị ảnh hưởng" (phát hiện trên bản nào); dự án chưa có dòng nào thì dùng "phiên bản sửa".
    const loadRelease = async (type: 'AFFECTS' | 'FIX'): Promise<ReleaseBugRow[]> => {
      const links = await this.prisma.issueFixVersion.findMany({
        where: { type, version: { projectId }, issue: { deletedAt: null, type: BUG_TYPE } },
        select: {
          versionId: true,
          issue: { select: { createdAt: true, status: { select: { category: true } } } },
        },
        take: RELEASE_LIMIT,
      });
      return links.map((l) => ({
        versionId: l.versionId,
        createdAt: l.issue.createdAt,
        category: l.issue.status.category,
      }));
    };
    let basis: 'AFFECTS' | 'FIX' = 'AFFECTS';
    let releaseRows = await loadRelease('AFFECTS');
    if (releaseRows.length === 0) {
      const fixRows = await loadRelease('FIX');
      if (fixRows.length > 0) {
        basis = 'FIX';
        releaseRows = fixRows;
      }
    }

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      totals: {
        open: openBySeverity.reduce((n, s) => n + s.open, 0),
        created,
        closed: closedIds.size,
        reopened: reopenedIds.size,
      },
      openBySeverity,
      reopenRate: reopenRate(closedIds, reopenedIds),
      closeTime: closeTimeStats(closedRows),
      byRelease: { basis, rows: bucketByRelease(releaseRows, versions) },
    };
  }
}
