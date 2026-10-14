import { Injectable } from '@nestjs/common';
import type {
  BurndownReport,
  CfdPoint,
  CfdReport,
  CreatedResolvedReport,
  VelocityReport,
} from '@tirapro/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotFoundAppException } from '../../common/exceptions/app.exception';

type Category = 'TODO' | 'IN_PROGRESS' | 'DONE';

/** Dòng kết quả $queryRaw — count(*) của Postgres trả về bigint, nên `n` phải qua Number(). */
interface StatusDeltaRow { day?: string; oldCategory: Category | null; newCategory: Category | null; n: bigint | number }
interface DayCountRow { day: string; n: bigint | number }
interface WeekRow { idx: number; n: bigint | number }

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Tổng quan workspace (mọi dự án — cho admin) ----------
  async workspaceOverview(workspaceId: string) {
    const now = new Date();
    const DAY = 24 * 3600 * 1000;
    const WEEK = 7 * DAY;
    const HIGH_RANK = 4; // High/Highest

    const projects = await this.prisma.project.findMany({
      where: { workspaceId, deletedAt: null, isArchived: false },
      select: { id: true, key: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    const keyByProject = new Map(projects.map((p) => [p.id, p.key]));

    // Sprint đang chạy của mỗi dự án (chọn sequence cao nhất nếu lỡ có >1).
    const activeSprints = await this.prisma.sprint.findMany({
      where: { projectId: { in: projects.map((p) => p.id) }, state: 'ACTIVE', deletedAt: null },
      select: { projectId: true, name: true, endDate: true, sequence: true },
      orderBy: { sequence: 'desc' },
    });
    const sprintByProject = new Map<string, { name: string; daysLeft: number | null }>();
    for (const s of activeSprints) {
      if (sprintByProject.has(s.projectId)) continue;
      const daysLeft = s.endDate ? Math.ceil((s.endDate.getTime() - now.getTime()) / DAY) : null;
      sprintByProject.set(s.projectId, { name: s.name, daysLeft });
    }

    // Mọi số liệu tính bằng aggregate SQL (groupBy/count/$queryRaw) — không kéo từng issue về app.
    const baseWhere: Prisma.IssueWhereInput = { workspaceId, deletedAt: null };
    const openStatus: Prisma.IssueWhereInput = { status: { category: { not: 'DONE' } } };
    const overdueWhere: Prisma.IssueWhereInput = { ...baseWhere, ...openStatus, dueDate: { lt: now } };
    const unassignedOpenWhere: Prisma.IssueWhereInput = { ...baseWhere, ...openStatus, assigneeId: null };
    const highPriWhere: Prisma.IssueWhereInput = { priority: { rank: { gte: HIGH_RANK } } };
    const dueSoonWhere: Prisma.IssueWhereInput = {
      ...baseWhere,
      ...openStatus,
      dueDate: { gte: now, lte: new Date(now.getTime() + 3 * DAY) },
    };
    const attentionSelect = { key: true, summary: true, projectId: true, dueDate: true } as const;

    const [
      statusGroups, typeGroups, prioGroups, overdueGroups,
      createdWeeks, resolvedWeeks, resolvedLast14,
      unassignedNotDone, highPriUnassigned, dueSoon,
      overdueTop, highPriTop, dueSoonTop,
    ] = await Promise.all([
      this.prisma.issue.groupBy({ by: ['projectId', 'statusId'], where: baseWhere, _count: { _all: true } }),
      this.prisma.issue.groupBy({ by: ['projectId', 'typeId'], where: baseWhere, _count: { _all: true } }),
      this.prisma.issue.groupBy({ by: ['priorityId'], where: baseWhere, _count: { _all: true } }),
      this.prisma.issue.groupBy({ by: ['projectId'], where: overdueWhere, _count: { _all: true } }),
      this.weekBuckets('createdAt', workspaceId, now),
      this.weekBuckets('resolvedAt', workspaceId, now),
      this.prisma.issue.count({ where: { ...baseWhere, resolvedAt: { gte: new Date(now.getTime() - 14 * DAY) } } }),
      this.prisma.issue.count({ where: unassignedOpenWhere }),
      this.prisma.issue.count({ where: { ...unassignedOpenWhere, ...highPriWhere } }),
      this.prisma.issue.count({ where: dueSoonWhere }),
      // Danh sách "cần chú ý": mỗi nhóm chỉ lấy 8 dòng đầu (kết quả cuối cắt 8 nên không cần nhiều hơn).
      this.prisma.issue.findMany({ where: overdueWhere, orderBy: { dueDate: 'asc' }, take: 8, select: attentionSelect }),
      this.prisma.issue.findMany({
        // Quá hạn đã nằm ở nhóm trên → nhóm này chỉ lấy việc chưa quá hạn (nhánh `else if` của bản cũ).
        where: { ...unassignedOpenWhere, ...highPriWhere, OR: [{ dueDate: null }, { dueDate: { gte: now } }] },
        orderBy: { createdAt: 'asc' }, take: 8, select: attentionSelect,
      }),
      this.prisma.issue.findMany({
        // Loại việc "ưu tiên cao, chưa gán" (đã nằm ở nhóm trên). Viết bằng OR dương, không dùng NOT,
        // vì NOT trên quan hệ priority có thể loại nhầm dòng priorityId NULL (NULL IN (...) → NULL).
        where: {
          ...dueSoonWhere,
          OR: [{ assigneeId: { not: null } }, { priorityId: null }, { priority: { rank: { lt: HIGH_RANK } } }],
        },
        orderBy: { dueDate: 'asc' }, take: 8, select: attentionSelect,
      }),
    ]);

    const [statuses, types, priorities] = await Promise.all([
      this.prisma.status.findMany({
        where: { id: { in: [...new Set(statusGroups.map((g) => g.statusId))] } },
        select: { id: true, category: true },
      }),
      this.prisma.issueType.findMany({
        where: { id: { in: [...new Set(typeGroups.map((g) => g.typeId))] } },
        select: { id: true, key: true, name: true, color: true },
      }),
      this.prisma.priority.findMany({
        where: { id: { in: prioGroups.map((g) => g.priorityId).filter((x): x is string => x !== null) } },
        select: { id: true, name: true, color: true, rank: true },
      }),
    ]);
    const categoryByStatus = new Map(statuses.map((s) => [s.id, s.category]));
    const typeById = new Map(types.map((t) => [t.id, t]));
    const prioById = new Map(priorities.map((p) => [p.id, p]));

    const empty = () => ({ total: 0, todo: 0, inProgress: 0, done: 0, overdue: 0, bug: 0 });
    const byProject = new Map<string, ReturnType<typeof empty>>();
    for (const p of projects) byProject.set(p.id, empty());
    // totals gồm cả issue của project đã lưu trữ (như bản cũ); byProject chỉ gồm project đang hiển thị.
    const totals = empty();

    for (const g of statusGroups) {
      const n = g._count._all;
      const cat = categoryByStatus.get(g.statusId);
      for (const t of [totals, byProject.get(g.projectId)]) {
        if (!t) continue;
        t.total += n;
        if (cat === 'TODO') t.todo += n;
        else if (cat === 'IN_PROGRESS') t.inProgress += n;
        else t.done += n;
      }
    }
    for (const g of overdueGroups) {
      for (const t of [totals, byProject.get(g.projectId)]) if (t) t.overdue += g._count._all;
    }

    const typeMap = new Map<string, { name: string; color: string | null; count: number }>();
    for (const g of typeGroups) {
      const type = typeById.get(g.typeId);
      if (!type) continue;
      const n = g._count._all;
      if (type.key === 'BUG') {
        totals.bug += n;
        const bp = byProject.get(g.projectId);
        if (bp) bp.bug += n;
      }
      const row = typeMap.get(type.name) ?? { name: type.name, color: type.color, count: 0 };
      row.count += n;
      typeMap.set(type.name, row);
    }

    const prioMap = new Map<string, { name: string; color: string | null; rank: number; count: number }>();
    for (const g of prioGroups) {
      const p = g.priorityId ? prioById.get(g.priorityId) : undefined;
      const name = p?.name ?? 'Chưa đặt';
      const row = prioMap.get(name) ?? { name, color: p?.color ?? null, rank: p?.rank ?? -1, count: 0 };
      row.count += g._count._all;
      prioMap.set(name, row);
    }

    // Xu hướng 8 tuần: tạo mới vs đã xử lý (bucket 7 = tuần hiện tại).
    const buckets = Array.from({ length: 8 }, () => ({ created: 0, resolved: 0 }));
    for (const r of createdWeeks) buckets[7 - r.idx]!.created += r.n;
    for (const r of resolvedWeeks) buckets[7 - r.idx]!.resolved += r.n;
    const weekLabel = (j: number) => {
      const d = new Date(now.getTime() - (7 - j) * WEEK);
      return `${d.getDate()}/${d.getMonth() + 1}`;
    };

    const attention = attentionRows(now, keyByProject, { overdueTop, highPriTop, dueSoonTop });
    const { warnings, forecast } = narrate(
      totals,
      { highPriUnassigned, dueSoon, unassignedNotDone },
      resolvedLast14,
    );

    return {
      projectCount: projects.length,
      totals,
      projects: projects.map((p) => ({
        id: p.id, key: p.key, name: p.name, ...byProject.get(p.id)!,
        sprint: sprintByProject.get(p.id) ?? null,
      })),
      byType: [...typeMap.values()].sort((a, b) => b.count - a.count),
      byPriority: [...prioMap.values()].sort((a, b) => b.rank - a.rank).map(({ rank: _rank, ...r }) => r),
      trend: buckets.map((b, j) => ({ label: weekLabel(j), created: b.created, resolved: b.resolved })),
      warnings,
      forecast,
      attention,
    };
  }

  // ---------- Báo cáo tổng hợp 1 dự án (cho màn Reports) ----------
  async projectReport(workspaceId: string, projectId: string) {
    await this.requireProject(workspaceId, projectId);
    const now = new Date();
    const DAY = 24 * 3600 * 1000;
    const HIGH_RANK = 4; // High/Highest

    // Aggregate SQL: groupBy theo status/type/priority/assignee thay vì kéo mọi issue về app rồi reduce.
    const baseWhere: Prisma.IssueWhereInput = { projectId, deletedAt: null };
    const openStatus: Prisma.IssueWhereInput = { status: { category: { not: 'DONE' } } };
    const sumPoints = { storyPoints: true } as const;

    const [statusGroups, typeGroups, prioGroups, assigneeGroups, overdueGroups, highPriUnassigned, dueSoon] =
      await Promise.all([
        this.prisma.issue.groupBy({ by: ['statusId'], where: baseWhere, _count: { _all: true }, _sum: sumPoints }),
        this.prisma.issue.groupBy({ by: ['typeId'], where: baseWhere, _count: { _all: true } }),
        this.prisma.issue.groupBy({ by: ['priorityId'], where: baseWhere, _count: { _all: true } }),
        this.prisma.issue.groupBy({ by: ['assigneeId', 'statusId'], where: baseWhere, _count: { _all: true }, _sum: sumPoints }),
        this.prisma.issue.groupBy({
          by: ['assigneeId'],
          where: { ...baseWhere, ...openStatus, dueDate: { lt: now } },
          _count: { _all: true },
        }),
        this.prisma.issue.count({
          where: { ...baseWhere, ...openStatus, assigneeId: null, priority: { rank: { gte: HIGH_RANK } } },
        }),
        this.prisma.issue.count({
          where: { ...baseWhere, ...openStatus, dueDate: { gte: now, lte: new Date(now.getTime() + 3 * DAY) } },
        }),
      ]);

    const assigneeIds = [...new Set(assigneeGroups.map((g) => g.assigneeId).filter((x): x is string => x !== null))];
    const [statuses, types, priorities, users] = await Promise.all([
      this.prisma.status.findMany({
        where: { id: { in: [...new Set(statusGroups.map((g) => g.statusId))] } },
        select: { id: true, name: true, category: true, order: true },
      }),
      this.prisma.issueType.findMany({
        where: { id: { in: typeGroups.map((g) => g.typeId) } },
        select: { id: true, name: true, color: true },
      }),
      this.prisma.priority.findMany({
        where: { id: { in: prioGroups.map((g) => g.priorityId).filter((x): x is string => x !== null) } },
        select: { id: true, name: true, color: true, rank: true },
      }),
      this.prisma.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, displayName: true } }),
    ]);
    const statusById = new Map(statuses.map((s) => [s.id, s]));
    const typeById = new Map(types.map((t) => [t.id, t]));
    const prioById = new Map(priorities.map((p) => [p.id, p]));
    const userById = new Map(users.map((u) => [u.id, u]));
    const pointsOf = (g: { _sum: { storyPoints: number | null } }) => g._sum.storyPoints ?? 0;

    const totals = { total: 0, todo: 0, inProgress: 0, done: 0, overdue: 0, unassigned: 0, points: 0 };
    for (const g of overdueGroups) totals.overdue += g._count._all;

    // Phân bố theo trạng thái thực (mang màu theo category để nhất quán với board).
    const statusMap = new Map<string, { name: string; category: Category; count: number; order: number }>();
    for (const g of statusGroups) {
      const st = statusById.get(g.statusId);
      if (!st) continue;
      const n = g._count._all;
      totals.total += n;
      totals.points += pointsOf(g);
      if (st.category === 'TODO') totals.todo += n;
      else if (st.category === 'IN_PROGRESS') totals.inProgress += n;
      else totals.done += n;
      const row = statusMap.get(st.name) ?? { name: st.name, category: st.category, count: 0, order: st.order };
      row.count += n;
      statusMap.set(st.name, row);
    }
    totals.points = round(totals.points);

    const typeMap = new Map<string, { name: string; color: string | null; count: number }>();
    for (const g of typeGroups) {
      const t = typeById.get(g.typeId);
      if (!t) continue;
      const row = typeMap.get(t.name) ?? { name: t.name, color: t.color, count: 0 };
      row.count += g._count._all;
      typeMap.set(t.name, row);
    }

    const prioMap = new Map<string, { name: string; color: string | null; rank: number; count: number }>();
    for (const g of prioGroups) {
      const p = g.priorityId ? prioById.get(g.priorityId) : undefined;
      const name = p?.name ?? 'Chưa đặt';
      const row = prioMap.get(name) ?? { name, color: p?.color ?? null, rank: p?.rank ?? -1, count: 0 };
      row.count += g._count._all;
      prioMap.set(name, row);
    }

    type AssigneeRow = {
      id: string | null;
      name: string;
      total: number;
      inProgress: number;
      done: number;
      overdue: number;
      points: number;
    };
    const assigneeMap = new Map<string, AssigneeRow>();
    const UNASSIGNED = '__unassigned__';
    for (const g of assigneeGroups) {
      const n = g._count._all;
      const cat = statusById.get(g.statusId)?.category;
      const aKey = g.assigneeId ?? UNASSIGNED;
      const u = g.assigneeId ? userById.get(g.assigneeId) : undefined;
      const row =
        assigneeMap.get(aKey) ??
        ({ id: u?.id ?? null, name: u?.displayName ?? 'Chưa gán', total: 0, inProgress: 0, done: 0, overdue: 0, points: 0 } satisfies AssigneeRow);
      row.total += n;
      row.points += pointsOf(g);
      if (cat === 'IN_PROGRESS') row.inProgress += n;
      else if (cat === 'DONE') row.done += n;
      if (!g.assigneeId) totals.unassigned += n;
      assigneeMap.set(aKey, row);
    }
    for (const g of overdueGroups) {
      const row = assigneeMap.get(g.assigneeId ?? UNASSIGNED);
      if (row) row.overdue += g._count._all;
    }
    for (const row of assigneeMap.values()) row.points = round(row.points);

    const CATEGORY_COLOR: Record<Category, string> = {
      TODO: 'var(--status-todo)',
      IN_PROGRESS: 'var(--status-progress)',
      DONE: 'var(--status-done)',
    };

    const completionRate = totals.total ? Math.round((totals.done / totals.total) * 100) : 0;

    // byAssignee: người có nhiều việc chưa xong lên trước; "Chưa gán" luôn xuống cuối.
    const byAssignee = [...assigneeMap.values()].sort((a, b) => {
      if (a.id === null) return 1;
      if (b.id === null) return -1;
      const aOpen = a.total - a.done;
      const bOpen = b.total - b.done;
      if (bOpen !== aOpen) return bOpen - aOpen;
      if (b.total !== a.total) return b.total - a.total;
      return a.name.localeCompare(b.name);
    });

    return {
      totals,
      completionRate,
      highPriUnassigned,
      dueSoon,
      // Theo thứ tự cột của workflow cho ổn định (bản cũ không đảm bảo thứ tự).
      byStatus: [...statusMap.values()]
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
        .map((s) => ({ name: s.name, count: s.count, color: CATEGORY_COLOR[s.category] })),
      byType: [...typeMap.values()].sort((a, b) => b.count - a.count),
      byPriority: [...prioMap.values()]
        .sort((a, b) => b.rank - a.rank)
        .map(({ rank: _rank, ...r }) => r),
      byAssignee,
    };
  }

  // ---------- Burndown (1 sprint) ----------
  async burndown(workspaceId: string, sprintId: string): Promise<BurndownReport> {
    const sprint = await this.prisma.sprint.findFirst({
      where: { id: sprintId, deletedAt: null, project: { workspaceId } },
      include: { issues: { where: { deletedAt: null }, select: { id: true, storyPoints: true } } },
    });
    if (!sprint) throw new NotFoundAppException('Đợt làm việc (sprint)');

    const points = new Map<string, number>();
    let committed = 0;
    for (const i of sprint.issues) {
      const p = i.storyPoints ?? 0;
      points.set(i.id, p);
      committed += p;
    }

    const start = sprint.startDate ?? sprint.createdAt;
    const end = sprint.endDate ?? sprint.completeDate ?? new Date();
    const days = eachDay(start, end);

    // STATUS transitions trong sprint → tái dựng điểm "đã Done" theo thời gian
    const history = await this.prisma.issueHistory.findMany({
      where: { sprintId, field: 'STATUS' },
      orderBy: { occurredAt: 'asc' },
      select: { issueId: true, oldCategory: true, newCategory: true, occurredAt: true },
    });

    let done = 0;
    let h = 0;
    const series = days.map((date, idx) => {
      const endOfDay = new Date(`${date}T23:59:59.999Z`);
      while (h < history.length && history[h]!.occurredAt <= endOfDay) {
        const ev = history[h++]!;
        const pts = points.get(ev.issueId) ?? 0;
        if (ev.newCategory === 'DONE' && ev.oldCategory !== 'DONE') done += pts;
        else if (ev.oldCategory === 'DONE' && ev.newCategory !== 'DONE') done -= pts;
      }
      const ideal = days.length > 1 ? committed * (1 - idx / (days.length - 1)) : 0;
      return { date, ideal: round(ideal), remaining: round(Math.max(committed - done, 0)) };
    });

    return {
      sprintId: sprint.id,
      sprintName: sprint.name,
      committedPoints: round(committed),
      start: start.toISOString(),
      end: end.toISOString(),
      series,
    };
  }

  // ---------- Velocity (N sprint CLOSED gần nhất) ----------
  async velocity(workspaceId: string, projectId: string, limit = 8): Promise<VelocityReport> {
    await this.requireProject(workspaceId, projectId);
    const sprints = await this.prisma.sprint.findMany({
      where: { projectId, state: 'CLOSED', deletedAt: null },
      orderBy: { sequence: 'desc' },
      take: Math.min(Math.max(limit, 1), 30),
      include: {
        snapshots: { where: { kind: 'CLOSE' }, orderBy: { snapshotAt: 'desc' }, take: 1 },
      },
    });

    const entries = sprints
      .reverse()
      .map((s) => {
        const snap = s.snapshots[0];
        return {
          sprintId: s.id,
          sprintName: s.name,
          committed: round(snap?.committedPoints ?? 0),
          completed: round(snap?.completedPoints ?? 0),
        };
      });
    const averageCompleted = entries.length
      ? round(entries.reduce((a, e) => a + e.completed, 0) / entries.length)
      : 0;
    return { sprints: entries, averageCompleted };
  }

  // ---------- Cumulative Flow Diagram ----------
  /**
   * Ngữ nghĩa: số issue ở mỗi category vào cuối mỗi ngày (UTC), dựng từ IssueHistory field STATUS.
   * Mỗi sự kiện đổi trạng thái là một "delta": old category -1, new category +1 (sự kiện tạo issue có
   * oldCategory = NULL nên chỉ +1; đổi trạng thái trong cùng category tự triệt tiêu). Nhờ vậy chỉ cần
   * đếm sự kiện bằng SQL — không phải replay từng issue:
   *   - trạng thái đầu kỳ = tổng delta của mọi sự kiện TRƯỚC `from`;
   *   - mỗi ngày = trạng thái ngày trước + delta của các sự kiện trong ngày.
   * Chỉ issue có lịch sử STATUS mới được tính (issue tạo trước khi có lịch sử không xuất hiện — giống bản
   * replay cũ); issue đã xoá mềm vẫn nằm trong dòng chảy lịch sử.
   */
  async cfd(workspaceId: string, projectId: string, fromStr?: string, toStr?: string): Promise<CfdReport> {
    await this.requireProject(workspaceId, projectId);
    const { from, to } = range(fromStr, toStr);
    const days = eachDay(from, to);
    const lo = new Date(`${days[0]}T00:00:00.000Z`);
    const hi = new Date(`${days[days.length - 1]}T23:59:59.999Z`);

    const [before, inRange] = await Promise.all([
      this.prisma.$queryRaw<StatusDeltaRow[]>`
        SELECT "oldCategory"::text AS "oldCategory", "newCategory"::text AS "newCategory", count(*) AS n
        FROM "IssueHistory"
        WHERE "projectId" = ${projectId} AND "field" = 'STATUS' AND "occurredAt" < ${lo}
        GROUP BY 1, 2`,
      this.prisma.$queryRaw<StatusDeltaRow[]>`
        SELECT to_char(date_trunc('day', "occurredAt"), 'YYYY-MM-DD') AS day,
               "oldCategory"::text AS "oldCategory", "newCategory"::text AS "newCategory", count(*) AS n
        FROM "IssueHistory"
        WHERE "projectId" = ${projectId} AND "field" = 'STATUS' AND "occurredAt" >= ${lo} AND "occurredAt" <= ${hi}
        GROUP BY 1, 2, 3`,
    ]);

    const level: Record<Category, number> = { TODO: 0, IN_PROGRESS: 0, DONE: 0 };
    const apply = (r: StatusDeltaRow) => {
      const n = Number(r.n);
      if (r.oldCategory) level[r.oldCategory] -= n;
      if (r.newCategory) level[r.newCategory] += n;
    };
    before.forEach(apply);
    const byDay = new Map<string, StatusDeltaRow[]>();
    for (const r of inRange) {
      const list = byDay.get(r.day!) ?? [];
      list.push(r);
      byDay.set(r.day!, list);
    }

    const series: CfdPoint[] = days.map((date) => {
      (byDay.get(date) ?? []).forEach(apply);
      return { date, todo: level.TODO, inProgress: level.IN_PROGRESS, done: level.DONE };
    });

    return { from: days[0]!, to: days[days.length - 1]!, series };
  }

  // ---------- Created vs Resolved ----------
  async createdResolved(
    workspaceId: string,
    projectId: string,
    fromStr?: string,
    toStr?: string,
  ): Promise<CreatedResolvedReport> {
    await this.requireProject(workspaceId, projectId);
    const { from, to } = range(fromStr, toStr);
    const days = eachDay(from, to);
    const lo = new Date(`${days[0]}T00:00:00.000Z`);
    const hi = new Date(`${days[days.length - 1]}T23:59:59.999Z`);

    const [created, resolved] = await Promise.all([
      this.prisma.$queryRaw<DayCountRow[]>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, count(*) AS n
        FROM "Issue"
        WHERE "projectId" = ${projectId} AND "deletedAt" IS NULL AND "createdAt" >= ${lo} AND "createdAt" <= ${hi}
        GROUP BY 1`,
      this.prisma.$queryRaw<DayCountRow[]>`
        SELECT to_char(date_trunc('day', "occurredAt"), 'YYYY-MM-DD') AS day, count(*) AS n
        FROM "IssueHistory"
        WHERE "projectId" = ${projectId} AND "field" = 'STATUS' AND "newCategory" = 'DONE'
          AND "occurredAt" >= ${lo} AND "occurredAt" <= ${hi}
        GROUP BY 1`,
    ]);

    const createdByDay = new Map(created.map((r) => [r.day, Number(r.n)]));
    const resolvedByDay = new Map(resolved.map((r) => [r.day, Number(r.n)]));
    const series = days.map((date) => ({
      date,
      created: createdByDay.get(date) ?? 0,
      resolved: resolvedByDay.get(date) ?? 0,
    }));
    return { from: days[0]!, to: days[days.length - 1]!, series };
  }

  /**
   * Đếm issue của workspace theo "tuổi tuần" của một cột thời gian: idx 0 = 7 ngày gần nhất tính lùi từ
   * `now`, idx 7 = tuần thứ 8. Tên cột là literal cố định (không nhận từ người dùng); mọi giá trị khác
   * đều là tham số bind.
   */
  private async weekBuckets(
    column: 'createdAt' | 'resolvedAt',
    workspaceId: string,
    now: Date,
  ): Promise<{ idx: number; n: number }[]> {
    const WEEK_MS = 7 * 24 * 3600 * 1000;
    const low = new Date(now.getTime() - 8 * WEEK_MS);
    const rows =
      column === 'createdAt'
        ? await this.prisma.$queryRaw<WeekRow[]>`
            SELECT floor(extract(epoch FROM (${now}::timestamp - "createdAt")) / 604800) AS idx,
                   count(*) AS n
            FROM "Issue"
            WHERE "workspaceId" = ${workspaceId} AND "deletedAt" IS NULL
              AND "createdAt" > ${low} AND "createdAt" <= ${now}
            GROUP BY 1`
        : await this.prisma.$queryRaw<WeekRow[]>`
            SELECT floor(extract(epoch FROM (${now}::timestamp - "resolvedAt")) / 604800) AS idx,
                   count(*) AS n
            FROM "Issue"
            WHERE "workspaceId" = ${workspaceId} AND "deletedAt" IS NULL
              AND "resolvedAt" > ${low} AND "resolvedAt" <= ${now}
            GROUP BY 1`;
    return rows
      .map((r) => ({ idx: Number(r.idx), n: Number(r.n) }))
      .filter((r) => r.idx >= 0 && r.idx <= 7);
  }

  private async requireProject(workspaceId: string, projectId: string) {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw new NotFoundAppException('Dự án');
    return p;
  }
}

// ---------- helpers ----------
type AttentionIssue = { key: string; summary: string; projectId: string; dueDate: Date | null };

/** Gộp 3 nhóm "cần chú ý" thành danh sách đã sắp (quá hạn > ưu tiên cao chưa gán > sắp đến hạn), tối đa 8 dòng. */
function attentionRows(
  now: Date,
  keyByProject: Map<string, string>,
  g: { overdueTop: AttentionIssue[]; highPriTop: AttentionIssue[]; dueSoonTop: AttentionIssue[] },
) {
  const DAY = 24 * 3600 * 1000;
  const rows: { key: string; summary: string; projectKey: string; reason: string; level: 'danger' | 'warning'; sort: number }[] = [];
  const base = (i: AttentionIssue) => ({ key: i.key, summary: i.summary, projectKey: keyByProject.get(i.projectId) ?? '' });
  for (const i of g.overdueTop) {
    const days = Math.ceil((now.getTime() - i.dueDate!.getTime()) / DAY);
    rows.push({ ...base(i), reason: `Quá hạn ${days} ngày`, level: 'danger', sort: 1000 + days });
  }
  for (const i of g.highPriTop) {
    rows.push({ ...base(i), reason: 'Ưu tiên cao, chưa gán người', level: 'warning', sort: 500 });
  }
  for (const i of g.dueSoonTop) {
    const dueInDays = (i.dueDate!.getTime() - now.getTime()) / DAY;
    rows.push({ ...base(i), reason: `Sắp đến hạn (${Math.ceil(dueInDays)} ngày)`, level: 'warning', sort: 300 - dueInDays });
  }
  return rows.sort((a, b) => b.sort - a.sort).slice(0, 8).map(({ sort: _s, ...r }) => r);
}

/** Cảnh báo + dự báo bằng chữ cho màn tổng quan (văn bản cho người dùng, giữ nguyên nội dung cũ). */
function narrate(
  totals: { total: number; done: number; overdue: number },
  counts: { highPriUnassigned: number; dueSoon: number; unassignedNotDone: number },
  resolvedLast14: number,
) {
  const { highPriUnassigned, dueSoon, unassignedNotDone } = counts;
  const notDone = totals.total - totals.done;
  const completionRate = totals.total ? Math.round((totals.done / totals.total) * 100) : 0;
  const weekly = resolvedLast14 / 2;

  // Cảnh báo (bằng chữ, có mức độ)
  const warnings: { level: 'danger' | 'warning' | 'info'; text: string }[] = [];
  if (totals.overdue > 0) warnings.push({ level: 'danger', text: `${totals.overdue} công việc đã quá hạn cần xử lý ngay.` });
  if (highPriUnassigned > 0) warnings.push({ level: 'warning', text: `${highPriUnassigned} công việc ưu tiên cao chưa có người làm.` });
  if (dueSoon > 0) warnings.push({ level: 'warning', text: `${dueSoon} việc sắp đến hạn trong 3 ngày tới.` });
  if (unassignedNotDone > 0) warnings.push({ level: 'info', text: `${unassignedNotDone} việc chưa gán người thực hiện.` });
  if (warnings.length === 0) warnings.push({ level: 'info', text: 'Không có cảnh báo — tiến độ đang trong tầm kiểm soát.' });

  // Dự báo (bằng chữ)
  const forecast: { label: string; text: string }[] = [];
  forecast.push({ label: 'Tiến độ', text: `Đã hoàn thành ${totals.done}/${totals.total} việc (${completionRate}%). Còn ${notDone} việc chưa xong.` });
  if (notDone > 0) {
    if (weekly >= 1) {
      const etaWeeks = Math.ceil(notDone / weekly);
      forecast.push({ label: 'Dự kiến hoàn tất', text: `Nhịp xử lý gần đây ~${weekly.toFixed(1)} việc/tuần → dự kiến cần ~${etaWeeks} tuần nữa để xong nếu giữ nhịp.` });
    } else {
      forecast.push({ label: 'Cảnh báo tiến độ', text: `14 ngày qua gần như không có việc nào hoàn tất trong khi còn ${notDone} việc tồn — tiến độ đang chững, nên rà soát nguồn lực/độ ưu tiên.` });
    }
  } else if (totals.total > 0) {
    forecast.push({ label: 'Dự kiến hoàn tất', text: 'Tất cả việc đã hoàn thành 🎉' });
  }
  if (notDone > 0 && totals.overdue > 0) {
    const r = Math.round((totals.overdue / notDone) * 100);
    forecast.push({ label: 'Rủi ro trễ hạn', text: `${r}% việc chưa xong đang quá hạn — ưu tiên nhóm quá hạn để tránh dồn ứ.` });
  }
  return { warnings, forecast };
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function eachDay(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cur = new Date(`${dayKey(from)}T00:00:00.000Z`);
  const last = new Date(`${dayKey(to)}T00:00:00.000Z`);
  // bound: tối đa 366 ngày để tránh chuỗi quá dài
  for (let i = 0; cur <= last && i < 366; i++) {
    out.push(dayKey(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out.length ? out : [dayKey(from)];
}

function range(fromStr?: string, toStr?: string): { from: Date; to: Date } {
  const to = toStr ? new Date(toStr) : new Date();
  const from = fromStr ? new Date(fromStr) : new Date(to.getTime() - 29 * 86_400_000);
  return { from, to };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
