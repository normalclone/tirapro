import { Injectable } from '@nestjs/common';
import type { QaReportDto } from '@tirapro/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ProjectAccessService } from '../rbac/project-access.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { BUG_TYPE_WHERE, bugTypeSql } from '../../common/bug-type';
import { TRIAGE_VISIBLE } from '../../common/triage-visibility';
import {
  bucketOpenBySeverity,
  closeTimeFromRow,
  mapReleaseRows,
  parseQaRange,
  reopenRate,
  type ReleaseAggRow,
} from './qa-report';

/**
 * Mảnh SQL dùng chung (alias: i = Issue, t = IssueType). Cùng định nghĩa với `BUG_TYPE_WHERE` + `TRIAGE_VISIBLE`:
 * bug còn sống, và đã qua duyệt (không ở hàng "Việc mới vào" chờ/tạm hoãn/từ chối).
 * So sánh CỘT enum với literal (không `::text` trên cột) để Postgres vẫn dùng được chỉ mục.
 */
const IS_LIVE_VISIBLE_BUG = Prisma.sql`i."deletedAt" IS NULL
  AND ${bugTypeSql('t')}
  AND (i."triageState" IS NULL OR i."triageState" = 'ACCEPTED')`;

/**
 * Tham số Date trong $queryRaw được Prisma gửi dưới dạng timestamptz, còn cột là timestamp(3) không múi giờ (UTC):
 * đổi tường minh về "timestamp UTC" để kết quả không phụ thuộc múi giờ session Postgres.
 */
const utc = (d: Date) => Prisma.sql`(${d}::timestamptz AT TIME ZONE 'UTC')`;

/** `<cột> = id` (một dự án — giữ nguyên dạng so sánh để dùng chỉ mục) hoặc `<cột> = ANY(ids)` (nhiều dự án). */
const inProjects = (column: string, ids: readonly string[]) =>
  ids.length === 1
    ? Prisma.sql`${Prisma.raw(column)} = ${ids[0]!}`
    : Prisma.sql`${Prisma.raw(column)} = ANY(${[...ids]}::text[])`;

interface EventRow {
  closed: bigint | number;
  reopened: bigint | number;
  both: bigint | number;
}
interface CloseRow {
  n: bigint | number;
  avgHours: number | null;
  medianHours: number | null;
}

/**
 * Báo cáo QA của một dự án (chỉ đọc). Quyền xem (`report:view` + dự án riêng tư → 404) do PermissionsGuard
 * kiểm qua `@ProjectRef('query','projectId')` trước khi vào đây; service khoá phạm vi theo dự án.
 * Mọi số đếm / trung bình / trung vị do Postgres tính (aggregate), không đọc dòng về bộ nhớ nên không có trần cắt.
 *
 * Định nghĩa:
 * - Bug mở / mới trong kỳ: chỉ bug đã qua duyệt (TRIAGE_VISIBLE).
 * - Đóng = sự kiện STATUS chuyển từ KHÔNG-DONE (hoặc chưa có trạng thái trước) sang DONE; mở lại = từ DONE sang không-DONE.
 * - Thời gian đóng: bug HIỆN đang ở DONE có `resolvedAt` trong kỳ (khác tập "đóng" ở trên: bug bị mở lại không tính).
 */
@Injectable()
export class QaReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async report(
    organizationId: string,
    projectId: string,
    fromStr?: string,
    toStr?: string,
  ): Promise<QaReportDto> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundAppException('Dự án');
    return this.build(organizationId, [projectId], fromStr, toStr);
  }

  /**
   * Báo cáo gộp nhiều dự án (phạm vi nhóm dự án của dashboard). `requested` do client gửi nên LUÔN giao với dự án người xem
   * thấy (`visibleAmong`); dự án không thấy bị bỏ âm thầm. Rỗng → báo cáo rỗng (không phải "mọi dự án").
   */
  async reportForProjects(
    organizationId: string,
    viewerId: string,
    requested: readonly string[],
    fromStr?: string,
    toStr?: string,
  ): Promise<QaReportDto> {
    const ids = await this.access.visibleAmong(viewerId, organizationId, requested);
    return this.build(organizationId, ids, fromStr, toStr);
  }

  private async build(
    organizationId: string,
    ids: string[],
    fromStr?: string,
    toStr?: string,
  ): Promise<QaReportDto> {
    const range = parseQaRange(fromStr, toStr, new Date());
    if ('error' in range) throw new BusinessRuleException(range.error);
    const { from, to } = range;

    const bugs: Prisma.IssueWhereInput = {
      projectId: ids.length === 1 ? ids[0]! : { in: ids },
      deletedAt: null,
      type: BUG_TYPE_WHERE,
      ...TRIAGE_VISIBLE,
    };
    const [openGroups, created, events, closeRow, severities, versions, affects] =
      await Promise.all([
        this.prisma.issue.groupBy({
          by: ['severityId'],
          where: { ...bugs, status: { category: { not: 'DONE' } } },
          _count: { _all: true },
        }),
        this.prisma.issue.count({ where: { ...bugs, createdAt: { gte: from, lte: to } } }),
        this.statusEvents(ids, from, to),
        this.closeTime(ids, from, to),
        this.prisma.severity.findMany({
          where: { organizationId },
          select: { id: true, name: true, color: true, rank: true },
        }),
        this.prisma.version.findMany({
          where: { projectId: ids.length === 1 ? ids[0]! : { in: ids } },
          select: { id: true, name: true, status: true, releaseDate: true },
        }),
        this.releaseRows(ids, 'AFFECTS'),
      ]);

    // Ưu tiên "phiên bản bị ảnh hưởng" (phát hiện trên bản nào); dự án chưa có dòng nào thì dùng "phiên bản sửa".
    let basis: 'AFFECTS' | 'FIX' = 'AFFECTS';
    let releaseRows = affects;
    if (affects.length === 0) {
      const fix = await this.releaseRows(ids, 'FIX');
      if (fix.length > 0) {
        basis = 'FIX';
        releaseRows = fix;
      }
    }

    const openBySeverity = bucketOpenBySeverity(
      openGroups.map((g) => ({ severityId: g.severityId, count: g._count._all })),
      severities,
    );
    const closed = Number(events.closed);
    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      totals: {
        open: openBySeverity.reduce((n, s) => n + s.open, 0),
        created,
        closed,
        reopened: Number(events.reopened),
      },
      openBySeverity,
      reopenRate: reopenRate(closed, Number(events.both)),
      closeTime: closeTimeFromRow(closeRow),
      byRelease: { basis, rows: mapReleaseRows(releaseRows, versions) },
    };
  }

  /** Số bug (distinct) có sự kiện đóng / mở lại / cả hai trong kỳ — gom theo bug rồi đếm, không phụ thuộc số sự kiện. */
  private async statusEvents(ids: string[], from: Date, to: Date): Promise<EventRow> {
    const rows = await this.prisma.$queryRaw<EventRow[]>(Prisma.sql`
      WITH ev AS (
        SELECT h."issueId",
          bool_or(h."newCategory" = 'DONE'
                  AND (h."oldCategory" IS NULL OR h."oldCategory" <> 'DONE')) AS closed,
          bool_or(h."oldCategory" = 'DONE'
                  AND h."newCategory" IS NOT NULL AND h."newCategory" <> 'DONE') AS reopened
        FROM "IssueHistory" h
        JOIN "Issue" i ON i."id" = h."issueId"
        JOIN "IssueType" t ON t."id" = i."typeId"
        WHERE ${inProjects('h."projectId"', ids)} AND h."field" = 'STATUS'
          AND h."occurredAt" >= ${utc(from)} AND h."occurredAt" <= ${utc(to)}
          AND ${IS_LIVE_VISIBLE_BUG}
        GROUP BY h."issueId"
      )
      SELECT count(*) FILTER (WHERE closed) AS closed,
             count(*) FILTER (WHERE reopened) AS reopened,
             count(*) FILTER (WHERE closed AND reopened) AS both
      FROM ev`);
    return rows[0] ?? { closed: 0, reopened: 0, both: 0 };
  }

  /** Trung bình + trung vị (percentile_cont) của resolvedAt − createdAt, tính trong Postgres trên mọi bug thoả điều kiện. */
  private async closeTime(ids: string[], from: Date, to: Date): Promise<CloseRow | undefined> {
    const rows = await this.prisma.$queryRaw<CloseRow[]>(Prisma.sql`
      SELECT count(*) AS "n",
             avg(x."hours")::float8 AS "avgHours",
             (percentile_cont(0.5) WITHIN GROUP (ORDER BY x."hours"))::float8 AS "medianHours"
      FROM (
        SELECT extract(epoch FROM (i."resolvedAt" - i."createdAt")) / 3600.0 AS "hours"
        FROM "Issue" i
        JOIN "IssueType" t ON t."id" = i."typeId"
        JOIN "Status" s ON s."id" = i."statusId"
        WHERE ${inProjects('i."projectId"', ids)} AND s."category" = 'DONE'
          AND i."resolvedAt" >= ${utc(from)} AND i."resolvedAt" <= ${utc(to)}
          AND i."resolvedAt" >= i."createdAt"
          AND ${IS_LIVE_VISIBLE_BUG}
      ) x`);
    return rows[0];
  }

  /**
   * Bug theo phiên bản (mọi thời điểm, không theo kỳ). `leaked` = bug của phiên bản RELEASED được báo SAU hết ngày
   * phát hành (`releaseDate` thường nằm 00:00 nên bug báo ngay trong ngày phát hành không bị tính là rò rỉ).
   */
  private async releaseRows(ids: string[], type: 'AFFECTS' | 'FIX'): Promise<ReleaseAggRow[]> {
    return this.prisma.$queryRaw<ReleaseAggRow[]>(Prisma.sql`
      SELECT l."versionId" AS "versionId",
             count(*) AS "total",
             count(*) FILTER (WHERE s."category" <> 'DONE') AS "open",
             count(*) FILTER (WHERE s."category" = 'DONE') AS "closed",
             count(*) FILTER (WHERE v."status" = 'RELEASED' AND v."releaseDate" IS NOT NULL
               AND i."createdAt" >= date_trunc('day', v."releaseDate") + interval '1 day') AS "leaked"
      FROM "IssueFixVersion" l
      JOIN "Version" v ON v."id" = l."versionId"
      JOIN "Issue" i ON i."id" = l."issueId"
      JOIN "IssueType" t ON t."id" = i."typeId"
      JOIN "Status" s ON s."id" = i."statusId"
      WHERE ${inProjects('v."projectId"', ids)} AND l."type"::text = ${type}
        AND ${IS_LIVE_VISIBLE_BUG}
      GROUP BY l."versionId"`);
  }
}
