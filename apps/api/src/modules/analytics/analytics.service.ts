import { Injectable } from '@nestjs/common';
import type {
  BurndownReport,
  CfdPoint,
  CfdReport,
  CreatedResolvedReport,
  SprintClosePayload,
  SprintSummaryReport,
  VelocityReport,
} from '@tirapro/shared';
import { overdueCutoff } from '@tirapro/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { isBugType } from '../../common/bug-type';
import { TRIAGE_VISIBLE, triageVisibleSql } from '../../common/triage-visibility';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { ProjectAccessService } from '../rbac/project-access.service';
import { ProjectHealthService } from './project-health.service';

type Category = 'TODO' | 'IN_PROGRESS' | 'DONE';

/** Dòng kết quả $queryRaw — count(*) của Postgres trả về bigint, nên `n` phải qua Number(). */
interface CfdRow {
  day: string;
  category: Category;
  n: bigint | number;
}
interface DayCountRow {
  day: string;
  n: bigint | number;
}
interface WeekRow {
  idx: number;
  n: bigint | number;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: ProjectHealthService,
    private readonly access: ProjectAccessService,
  ) {}

  // ---------- Tổng quan workspace (mọi dự án người xem được thấy) ----------
  /**
   * `viewerId`: chỉ tính/hiện dự án người đó được thấy (dự án riêng tư chỉ cho thành viên + admin).
   * Số liệu hai người xem có thể khác nhau. `viewerId` bắt buộc.
   */
  async workspaceOverview(workspaceId: string, viewerId: string) {
    const visible = await this.access.visibleWhere(viewerId, workspaceId);
    const visibleIds = await this.access.visibleProjectIds(viewerId, workspaceId, visible);
    const now = new Date();
    const DAY = 24 * 3600 * 1000;
    const WEEK = 7 * DAY;
    const HIGH_RANK = 4; // High/Highest

    const projects = await this.prisma.project.findMany({
      where: { workspaceId, deletedAt: null, isArchived: false, ...visible },
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
    // Loại issue của dự án đã XOÁ; dự án chỉ lưu trữ vẫn tính vào tổng (xem comment ở `totals`).
    // Việc chưa duyệt/từ chối/hoãn (Việc mới vào) KHÔNG lẫn vào số liệu — như Board/Việc chờ/QA/KR. Bỏ vào `AND` (không
    // spread `OR` của TRIAGE_VISIBLE) vì các where dẫn xuất bên dưới có `OR` riêng ở gốc.
    const baseWhere: Prisma.IssueWhereInput = {
      workspaceId,
      deletedAt: null,
      project: { deletedAt: null, ...visible },
      AND: [TRIAGE_VISIBLE],
    };
    const openStatus: Prisma.IssueWhereInput = { status: { category: { not: 'DONE' } } };
    const overdueWhere: Prisma.IssueWhereInput = {
      ...baseWhere,
      ...openStatus,
      // quá hạn theo NGÀY VN: hạn hôm nay chưa quá hạn (cùng định nghĩa Sức khoẻ dự án/digest/Danh mục)
      dueDate: { lt: overdueCutoff(now) },
    };
    const unassignedOpenWhere: Prisma.IssueWhereInput = {
      ...baseWhere,
      ...openStatus,
      assigneeId: null,
    };
    const highPriWhere: Prisma.IssueWhereInput = { priority: { rank: { gte: HIGH_RANK } } };
    const dueSoonWhere: Prisma.IssueWhereInput = {
      ...baseWhere,
      ...openStatus,
      dueDate: { gte: overdueCutoff(now), lte: new Date(now.getTime() + 3 * DAY) },
    };
    const attentionSelect = { key: true, summary: true, projectId: true, dueDate: true } as const;

    const [
      statusGroups,
      typeGroups,
      prioGroups,
      overdueGroups,
      createdWeeks,
      resolvedWeeks,
      resolvedLast14,
      unassignedNotDone,
      highPriUnassigned,
      dueSoon,
      overdueTop,
      highPriTop,
      dueSoonTop,
    ] = await Promise.all([
      this.prisma.issue.groupBy({
        by: ['projectId', 'statusId'],
        where: baseWhere,
        _count: { _all: true },
      }),
      this.prisma.issue.groupBy({
        by: ['projectId', 'typeId'],
        where: baseWhere,
        _count: { _all: true },
      }),
      this.prisma.issue.groupBy({ by: ['priorityId'], where: baseWhere, _count: { _all: true } }),
      this.prisma.issue.groupBy({ by: ['projectId'], where: overdueWhere, _count: { _all: true } }),
      this.weekBuckets('createdAt', workspaceId, now, visibleIds),
      this.weekBuckets('resolvedAt', workspaceId, now, visibleIds),
      this.prisma.issue.count({
        where: { ...baseWhere, resolvedAt: { gte: new Date(now.getTime() - 14 * DAY) } },
      }),
      this.prisma.issue.count({ where: unassignedOpenWhere }),
      this.prisma.issue.count({ where: { ...unassignedOpenWhere, ...highPriWhere } }),
      this.prisma.issue.count({ where: dueSoonWhere }),
      // Danh sách "cần chú ý": mỗi nhóm chỉ lấy 8 dòng đầu (kết quả cuối cắt 8 nên không cần nhiều hơn).
      this.prisma.issue.findMany({
        where: overdueWhere,
        orderBy: { dueDate: 'asc' },
        take: 8,
        select: attentionSelect,
      }),
      this.prisma.issue.findMany({
        // Quá hạn đã nằm ở nhóm trên → nhóm này chỉ lấy việc chưa quá hạn (nhánh `else if` của bản cũ).
        where: {
          ...unassignedOpenWhere,
          ...highPriWhere,
          OR: [{ dueDate: null }, { dueDate: { gte: overdueCutoff(now) } }],
        },
        orderBy: { createdAt: 'asc' },
        take: 8,
        select: attentionSelect,
      }),
      this.prisma.issue.findMany({
        // Loại việc "ưu tiên cao, chưa gán" (đã nằm ở nhóm trên). Viết bằng OR dương, không dùng NOT,
        // vì NOT trên quan hệ priority có thể loại nhầm dòng priorityId NULL (NULL IN (...) → NULL).
        where: {
          ...dueSoonWhere,
          OR: [
            { assigneeId: { not: null } },
            { priorityId: null },
            { priority: { rank: { lt: HIGH_RANK } } },
          ],
        },
        orderBy: { dueDate: 'asc' },
        take: 8,
        select: attentionSelect,
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
        where: {
          id: { in: prioGroups.map((g) => g.priorityId).filter((x): x is string => x !== null) },
        },
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
      if (isBugType(type)) {
        totals.bug += n;
        const bp = byProject.get(g.projectId);
        if (bp) bp.bug += n;
      }
      const row = typeMap.get(type.name) ?? { name: type.name, color: type.color, count: 0 };
      row.count += n;
      typeMap.set(type.name, row);
    }

    const prioMap = new Map<
      string,
      { name: string; color: string | null; rank: number; count: number }
    >();
    for (const g of prioGroups) {
      const p = g.priorityId ? prioById.get(g.priorityId) : undefined;
      const name = p?.name ?? 'Chưa đặt';
      const row = prioMap.get(name) ?? {
        name,
        color: p?.color ?? null,
        rank: p?.rank ?? -1,
        count: 0,
      };
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

    // Sức khoẻ: một lô cho mọi dự án đang hiển thị (danh sách đã là dự án sống, chưa lưu trữ).
    const healthMap = await this.health.forProjects(
      workspaceId,
      projects.map((p) => p.id),
      viewerId,
    );
    const attention = attentionRows(now, keyByProject, { overdueTop, highPriTop, dueSoonTop });
    const { warnings, forecast } = narrate(
      totals,
      { highPriUnassigned, dueSoon, unassignedNotDone },
      resolvedLast14,
    );

    return {
      // true = số liệu đã bị thu hẹp theo quyền xem của người gọi (FE gắn ghi chú "Chỉ gồm dự án bạn có quyền xem")
      scoped: Object.keys(visible).length > 0,
      projectCount: projects.length,
      totals,
      projects: projects.map((p) => ({
        id: p.id,
        key: p.key,
        name: p.name,
        ...byProject.get(p.id)!,
        sprint: sprintByProject.get(p.id) ?? null,
        health: healthMap.get(p.id) ?? null,
      })),
      byType: [...typeMap.values()].sort((a, b) => b.count - a.count),
      byPriority: [...prioMap.values()]
        .sort((a, b) => b.rank - a.rank)
        .map(({ rank: _rank, ...r }) => r),
      trend: buckets.map((b, j) => ({
        label: weekLabel(j),
        created: b.created,
        resolved: b.resolved,
      })),
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
    // Việc chưa duyệt không tính vào báo cáo (cùng quy tắc Tổng quan/Board).
    const baseWhere: Prisma.IssueWhereInput = { projectId, deletedAt: null, AND: [TRIAGE_VISIBLE] };
    const openStatus: Prisma.IssueWhereInput = { status: { category: { not: 'DONE' } } };
    const sumPoints = { storyPoints: true } as const;

    const [
      statusGroups,
      typeGroups,
      prioGroups,
      assigneeGroups,
      overdueGroups,
      highPriUnassigned,
      dueSoon,
    ] = await Promise.all([
      this.prisma.issue.groupBy({
        by: ['statusId'],
        where: baseWhere,
        _count: { _all: true },
        _sum: sumPoints,
      }),
      this.prisma.issue.groupBy({ by: ['typeId'], where: baseWhere, _count: { _all: true } }),
      this.prisma.issue.groupBy({ by: ['priorityId'], where: baseWhere, _count: { _all: true } }),
      this.prisma.issue.groupBy({
        by: ['assigneeId', 'statusId'],
        where: baseWhere,
        _count: { _all: true },
        _sum: sumPoints,
      }),
      this.prisma.issue.groupBy({
        by: ['assigneeId'],
        where: { ...baseWhere, ...openStatus, dueDate: { lt: overdueCutoff(now) } },
        _count: { _all: true },
      }),
      this.prisma.issue.count({
        where: {
          ...baseWhere,
          ...openStatus,
          assigneeId: null,
          priority: { rank: { gte: HIGH_RANK } },
        },
      }),
      this.prisma.issue.count({
        where: {
          ...baseWhere,
          ...openStatus,
          dueDate: { gte: overdueCutoff(now), lte: new Date(now.getTime() + 3 * DAY) },
        },
      }),
    ]);

    const assigneeIds = [
      ...new Set(assigneeGroups.map((g) => g.assigneeId).filter((x): x is string => x !== null)),
    ];
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
        where: {
          id: { in: prioGroups.map((g) => g.priorityId).filter((x): x is string => x !== null) },
        },
        select: { id: true, name: true, color: true, rank: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: assigneeIds } },
        select: { id: true, displayName: true },
      }),
    ]);
    const statusById = new Map(statuses.map((s) => [s.id, s]));
    const typeById = new Map(types.map((t) => [t.id, t]));
    const prioById = new Map(priorities.map((p) => [p.id, p]));
    const userById = new Map(users.map((u) => [u.id, u]));
    const pointsOf = (g: { _sum: { storyPoints: number | null } }) => g._sum.storyPoints ?? 0;

    const totals = {
      total: 0,
      todo: 0,
      inProgress: 0,
      done: 0,
      overdue: 0,
      unassigned: 0,
      points: 0,
    };
    for (const g of overdueGroups) totals.overdue += g._count._all;

    // Phân bố theo trạng thái thực (mang màu theo category để nhất quán với board).
    const statusMap = new Map<
      string,
      { name: string; category: Category; count: number; order: number }
    >();
    for (const g of statusGroups) {
      const st = statusById.get(g.statusId);
      if (!st) continue;
      const n = g._count._all;
      totals.total += n;
      totals.points += pointsOf(g);
      if (st.category === 'TODO') totals.todo += n;
      else if (st.category === 'IN_PROGRESS') totals.inProgress += n;
      else totals.done += n;
      const row = statusMap.get(st.name) ?? {
        name: st.name,
        category: st.category,
        count: 0,
        order: st.order,
      };
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

    const prioMap = new Map<
      string,
      { name: string; color: string | null; rank: number; count: number }
    >();
    for (const g of prioGroups) {
      const p = g.priorityId ? prioById.get(g.priorityId) : undefined;
      const name = p?.name ?? 'Chưa đặt';
      const row = prioMap.get(name) ?? {
        name,
        color: p?.color ?? null,
        rank: p?.rank ?? -1,
        count: 0,
      };
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
        ({
          id: u?.id ?? null,
          name: u?.displayName ?? 'Chưa gán',
          total: 0,
          inProgress: 0,
          done: 0,
          overdue: 0,
          points: 0,
        } satisfies AssigneeRow);
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

    const health =
      (await this.health.forProjects(workspaceId, [projectId], null)).get(projectId) ?? null; // đã qua guard dự án

    return {
      totals,
      completionRate,
      health,
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
  async burndown(
    workspaceId: string,
    projectId: string,
    sprintId: string,
  ): Promise<BurndownReport> {
    // projectId (đã qua guard report:view theo dự án) PHẢI khớp sprint — nếu không, client có thể gửi projectId của dự án
    // mình có quyền + sprintId của dự án khác để đọc burndown ngoài quyền.
    const sprint = await this.prisma.sprint.findFirst({
      where: {
        id: sprintId,
        projectId,
        deletedAt: null,
        project: { workspaceId, deletedAt: null },
      },
      include: {
        issues: {
          where: { deletedAt: null, ...TRIAGE_VISIBLE },
          select: { id: true, storyPoints: true },
        },
      },
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
      select: { issueId: true, newCategory: true, occurredAt: true },
    });

    // Snapshot DAILY/CLOSE (+ START làm mốc): nguồn chính cho "còn lại" mỗi ngày; ngày chưa có snapshot (trước khi có cron,
    // hoặc hôm nay) mới tính lại từ lịch sử. Mỗi ngày lấy snapshot MUỘN NHẤT trong ngày đó (DAILY đóng dấu cuối ngày).
    const snaps = await this.prisma.sprintSnapshot.findMany({
      where: { sprintId, kind: { in: ['START', 'DAILY', 'CLOSE'] } },
      orderBy: { snapshotAt: 'asc' },
      select: { kind: true, snapshotAt: true, committedPoints: true, remainingPoints: true },
    });
    const snapByDay = new Map<string, number>();
    // START chỉ làm mốc cam kết (bên dưới), KHÔNG làm điểm "còn lại" của ngày: ngày đầu/hôm nay chưa có DAILY thì
    // lịch sử mới phản ánh tiến độ đã làm trong ngày (START luôn = toàn bộ cam kết, che mất tiến độ).
    for (const sn of snaps)
      if (sn.kind !== 'START') snapByDay.set(dayKey(sn.snapshotAt), sn.remainingPoints);
    // Mốc "cam kết" của đường lý tưởng = điểm lúc START (nếu có), không bị lệch khi việc bị đẩy ra sau này.
    const startSnap = snaps.find((x) => x.kind === 'START' && x.committedPoints > 0);
    const baseline = startSnap ? startSnap.committedPoints : committed;

    // Cố ý KHÔNG dùng oldCategory/delta (giống CFD): chuỗi STATUS có thể đứt nên chỉ tin newCategory của sự kiện
    // cuối cùng — issue đang DONE hay không — và chỉ cộng/trừ điểm khi trạng thái boolean đó thật sự đổi.
    const todayKey = dayKey(new Date());
    let done = 0;
    const doneNow = new Map<string, boolean>();
    let h = 0;
    const series = days.map((date, idx) => {
      const endOfDay = new Date(`${date}T23:59:59.999Z`);
      while (h < history.length && history[h]!.occurredAt <= endOfDay) {
        const ev = history[h++]!;
        if (!ev.newCategory) continue;
        const isDone = ev.newCategory === 'DONE';
        if (isDone === (doneNow.get(ev.issueId) ?? false)) continue;
        doneNow.set(ev.issueId, isDone);
        const pts = points.get(ev.issueId) ?? 0;
        done += isDone ? pts : -pts;
      }
      const ideal = days.length > 1 ? baseline * (1 - idx / (days.length - 1)) : 0;
      // Sprint đang chạy: ngày chưa tới không có dữ liệu thật — trả null để FE ngừng đường "Còn lại" ở hôm nay
      // thay vì kéo đường phẳng tới cuối sprint (CLOSED đã đủ ngày; FUTURE không có "hôm nay" trong khoảng).
      if (sprint.state === 'ACTIVE' && date > todayKey) {
        return { date, ideal: round(ideal), remaining: null };
      }
      const snapped = snapByDay.get(date);
      const remaining =
        snapped !== undefined ? Math.max(snapped, 0) : Math.max(committed - done, 0);
      return { date, ideal: round(ideal), remaining: round(remaining) };
    });

    return {
      sprintId: sprint.id,
      sprintName: sprint.name,
      committedPoints: round(baseline),
      start: start.toISOString(),
      end: end.toISOString(),
      today: todayKey,
      series,
    };
  }

  // ---------- Tổng kết sprint (1 sprint) ----------
  async sprintSummary(
    workspaceId: string,
    projectId: string,
    sprintId: string,
  ): Promise<SprintSummaryReport> {
    // projectId (đã qua guard report:view theo dự án) PHẢI khớp sprint — cùng lý do với burndown().
    const sprint = await this.prisma.sprint.findFirst({
      where: {
        id: sprintId,
        projectId,
        deletedAt: null,
        project: { workspaceId, deletedAt: null },
      },
      include: {
        snapshots: {
          where: { kind: { in: ['START', 'CLOSE'] } },
          orderBy: { snapshotAt: 'desc' },
        },
      },
    });
    if (!sprint) throw new NotFoundAppException('Đợt làm việc (sprint)');

    const startSnap = sprint.snapshots.find((x) => x.kind === 'START');
    const closeSnap =
      sprint.state === 'CLOSED' ? sprint.snapshots.find((x) => x.kind === 'CLOSE') : undefined;

    // Số liệu trực tiếp: chỉ cần khi chưa có snapshot CLOSE (ACTIVE/FUTURE, hoặc CLOSED cũ thiếu snapshot).
    const live = { points: 0, count: 0, donePoints: 0, doneCount: 0 };
    if (!closeSnap) {
      const issues = await this.prisma.issue.findMany({
        where: { sprintId, deletedAt: null, ...TRIAGE_VISIBLE },
        select: { storyPoints: true, status: { select: { category: true } } },
      });
      for (const i of issues) {
        const p = i.storyPoints ?? 0;
        live.points += p;
        live.count += 1;
        if (i.status.category === 'DONE') {
          live.donePoints += p;
          live.doneCount += 1;
        }
      }
    }

    // ĐỊNH NGHĨA (luôn nhất quán: committed = completed + remaining): `committed` là tổng phạm vi hiện tại của sprint
    // (CLOSED: phạm vi lúc đóng theo snapshot CLOSE; ACTIVE/FUTURE: tính trực tiếp) — nên "đã xong x/y" không bao giờ
    // có x > y dù giữa sprint có thêm/bớt việc. Mốc cam kết ban đầu (snapshot START) trả riêng ở `initialCommitted`.
    const committed = closeSnap
      ? { points: closeSnap.committedPoints, count: closeSnap.committedCount }
      : { points: live.points, count: live.count };
    const completed = closeSnap
      ? { points: closeSnap.completedPoints, count: closeSnap.completedCount }
      : { points: live.donePoints, count: live.doneCount };
    const remaining = {
      points: Math.max(committed.points - completed.points, 0),
      count: Math.max(committed.count - completed.count, 0),
    };
    const initialCommitted =
      sprint.state !== 'FUTURE' &&
      startSnap &&
      (startSnap.committedPoints > 0 || startSnap.committedCount > 0)
        ? { points: round(startSnap.committedPoints), count: startSnap.committedCount }
        : null;

    // Việc chuyển tiếp: chỉ đọc từ payload (không suy diễn từ IssueHistory — không phân biệt được "chuyển lúc đóng"
    // với "bị gỡ giữa sprint"). Sprint đóng trước khi có tính năng: payload null → rỗng.
    const payload = closeSnap?.payload as Partial<SprintClosePayload> | null | undefined;
    const carriedOver = Array.isArray(payload?.carriedOver) ? payload.carriedOver : [];
    const movedTo = payload?.movedTo ?? null;

    // Velocity TB = trung bình completedPoints của tối đa 3 sprint đã đóng TRƯỚC sprint này (cùng định nghĩa trợ lý sprint).
    const prior = await this.prisma.sprint.findMany({
      where: {
        projectId,
        state: 'CLOSED',
        deletedAt: null,
        sequence: { lt: sprint.sequence },
        // Sprint đóng trước khi có snapshot CLOSE không có số liệu → bỏ qua (không tính 0 kéo trung bình xuống).
        snapshots: { some: { kind: 'CLOSE' } },
      },
      orderBy: { sequence: 'desc' },
      take: 3,
      include: {
        snapshots: { where: { kind: 'CLOSE' }, orderBy: { snapshotAt: 'desc' }, take: 1 },
      },
    });
    const priorPoints = prior.flatMap((p) => p.snapshots.map((x) => x.completedPoints));
    const average = priorPoints.length
      ? round(priorPoints.reduce((a, x) => a + x, 0) / priorPoints.length)
      : 0;
    const deltaPct =
      average > 0 ? Math.round(((completed.points - average) / average) * 100) : null;

    return {
      sprint: {
        id: sprint.id,
        name: sprint.name,
        goal: sprint.goal,
        state: sprint.state,
        startDate: sprint.startDate?.toISOString() ?? null,
        endDate: sprint.endDate?.toISOString() ?? null,
        completeDate: sprint.completeDate?.toISOString() ?? null,
        sequence: sprint.sequence,
      },
      committed: { points: round(committed.points), count: committed.count },
      initialCommitted,
      completed: { points: round(completed.points), count: completed.count },
      remaining: { points: round(remaining.points), count: remaining.count },
      carriedOver,
      movedTo,
      velocity: { average, sprintsCounted: priorPoints.length, deltaPct },
      time: sprintTime(sprint, new Date()),
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

    const entries = sprints.reverse().map((s) => {
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
   * Ngữ nghĩa (đúng bằng bản replay cũ): vào cuối mỗi ngày (UTC), mỗi issue thuộc category của sự kiện
   * STATUS CUỐI CÙNG có occurredAt <= cuối ngày đó ("newCategory của sự kiện cuối thắng").
   * Cố ý KHÔNG dùng oldCategory/delta: chuỗi sự kiện có thể đứt (đổi trạng thái không ghi lịch sử, admin
   * đổi category của Status, dữ liệu seed backdate…) — cách "cuối thắng" tự lành, số đếm không bao giờ âm.
   *
   * Một câu SQL: window `LEAD` trên từng issue cho ra khoảng hiệu lực [occurredAt, sự kiện kế tiếp) của
   * mỗi sự kiện; join với dãy ngày (generate_series) rồi đếm theo (ngày, category). Chỉ giữ sự kiện còn
   * hiệu lực tại/sau đầu kỳ nên phần lịch sử cũ đã bị thay thế không phải join. Issue chưa từng có sự kiện
   * STATUS không xuất hiện; issue xoá mềm vẫn được tính (giống bản cũ).
   */
  async cfd(
    workspaceId: string,
    projectId: string,
    fromStr?: string,
    toStr?: string,
  ): Promise<CfdReport> {
    await this.requireProject(workspaceId, projectId);
    const { from, to } = range(fromStr, toStr);
    const days = eachDay(from, to);
    const lo = new Date(`${days[0]}T00:00:00.000Z`);
    const hi = new Date(`${days[days.length - 1]}T23:59:59.999Z`);

    const rows = await this.prisma.$queryRaw<CfdRow[]>`
      WITH ev AS (
        SELECT "newCategory", "occurredAt",
               LEAD("occurredAt") OVER (PARTITION BY "issueId" ORDER BY "occurredAt", "id") AS "nextAt"
        FROM "IssueHistory"
        WHERE "projectId" = ${projectId} AND "field" = 'STATUS' AND "newCategory" IS NOT NULL
          AND "occurredAt" <= ${utc(hi)}
          AND EXISTS (SELECT 1 FROM "Issue" WHERE "Issue"."id" = "IssueHistory"."issueId" AND ${triageVisibleSql()})
      ), live AS (
        SELECT "newCategory", "occurredAt", "nextAt" FROM ev WHERE "nextAt" IS NULL OR "nextAt" > ${utc(lo)}
      ), d AS (
        SELECT g::timestamp AS "dayStart",
               g::timestamp + interval '1 day' - interval '1 millisecond' AS "dayEnd"
        FROM generate_series(${utc(lo)}, ${utc(hi)}, interval '1 day') AS g
      )
      SELECT to_char(d."dayStart", 'YYYY-MM-DD') AS day, live."newCategory"::text AS category, count(*) AS n
      FROM d
      JOIN live ON live."occurredAt" <= d."dayEnd" AND (live."nextAt" IS NULL OR live."nextAt" > d."dayEnd")
      GROUP BY 1, 2`;

    const byDay = new Map<string, Record<Category, number>>();
    for (const r of rows) {
      const cur = byDay.get(r.day) ?? { TODO: 0, IN_PROGRESS: 0, DONE: 0 };
      cur[r.category] += Number(r.n);
      byDay.set(r.day, cur);
    }
    const series: CfdPoint[] = days.map((date) => {
      const c = byDay.get(date);
      return { date, todo: c?.TODO ?? 0, inProgress: c?.IN_PROGRESS ?? 0, done: c?.DONE ?? 0 };
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
        WHERE "projectId" = ${projectId} AND "deletedAt" IS NULL AND ${triageVisibleSql()}
          AND "createdAt" >= ${utc(lo)} AND "createdAt" <= ${utc(hi)}
        GROUP BY 1`,
      this.prisma.$queryRaw<DayCountRow[]>`
        SELECT to_char(date_trunc('day', "occurredAt"), 'YYYY-MM-DD') AS day, count(*) AS n
        FROM "IssueHistory"
        WHERE "projectId" = ${projectId} AND "field" = 'STATUS' AND "newCategory" = 'DONE'
          AND EXISTS (SELECT 1 FROM "Issue" WHERE "Issue"."id" = "IssueHistory"."issueId" AND ${triageVisibleSql()})
          AND "occurredAt" >= ${utc(lo)} AND "occurredAt" <= ${utc(hi)}
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
    /** null = không giới hạn; ngược lại chỉ đếm việc của các dự án này (dự án riêng tư người xem không thấy bị loại). */
    visibleIds: string[] | null = null,
  ): Promise<{ idx: number; n: number }[]> {
    const onlyVisible =
      visibleIds === null ? Prisma.empty : Prisma.sql`AND "projectId" = ANY(${visibleIds}::text[])`;
    const WEEK_MS = 7 * 24 * 3600 * 1000;
    const low = new Date(now.getTime() - 8 * WEEK_MS);
    const rows =
      column === 'createdAt'
        ? await this.prisma.$queryRaw<WeekRow[]>`
            SELECT floor(extract(epoch FROM (${utc(now)} - "createdAt")) / 604800) AS idx,
                   count(*) AS n
            FROM "Issue"
            WHERE "workspaceId" = ${workspaceId} AND "deletedAt" IS NULL
              AND EXISTS (SELECT 1 FROM "Project" p WHERE p."id" = "Issue"."projectId" AND p."deletedAt" IS NULL)
              ${onlyVisible}
              AND ${triageVisibleSql()}
              AND "createdAt" > ${utc(low)} AND "createdAt" <= ${utc(now)}
            GROUP BY 1`
        : await this.prisma.$queryRaw<WeekRow[]>`
            SELECT floor(extract(epoch FROM (${utc(now)} - "resolvedAt")) / 604800) AS idx,
                   count(*) AS n
            FROM "Issue"
            WHERE "workspaceId" = ${workspaceId} AND "deletedAt" IS NULL
              AND EXISTS (SELECT 1 FROM "Project" p WHERE p."id" = "Issue"."projectId" AND p."deletedAt" IS NULL)
              ${onlyVisible}
              AND ${triageVisibleSql()}
              AND "resolvedAt" > ${utc(low)} AND "resolvedAt" <= ${utc(now)}
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
/**
 * Tham số Date trong $queryRaw được Prisma gửi dưới dạng timestamptz, còn cột của schema là timestamp(3)
 * không múi giờ (lưu giờ UTC). So sánh trực tiếp sẽ bị lệch theo múi giờ của session Postgres, nên đổi
 * tham số về "timestamp UTC" tường minh — kết quả không phụ thuộc cấu hình DB.
 */
const utc = (d: Date) => Prisma.sql`(${d}::timestamptz AT TIME ZONE 'UTC')`;

type AttentionIssue = { key: string; summary: string; projectId: string; dueDate: Date | null };

/** Gộp 3 nhóm "cần chú ý" thành danh sách đã sắp (quá hạn > ưu tiên cao chưa gán > sắp đến hạn), tối đa 8 dòng. */
function attentionRows(
  now: Date,
  keyByProject: Map<string, string>,
  g: { overdueTop: AttentionIssue[]; highPriTop: AttentionIssue[]; dueSoonTop: AttentionIssue[] },
) {
  const DAY = 24 * 3600 * 1000;
  const rows: {
    key: string;
    summary: string;
    projectKey: string;
    reason: string;
    level: 'danger' | 'warning';
    sort: number;
  }[] = [];
  const base = (i: AttentionIssue) => ({
    key: i.key,
    summary: i.summary,
    projectKey: keyByProject.get(i.projectId) ?? '',
  });
  const cutoff = overdueCutoff(now);
  for (const i of g.overdueTop) {
    // số ngày tính theo ngày lịch VN (hạn hôm qua = 1 ngày)
    const days = Math.max(1, Math.round((cutoff.getTime() - i.dueDate!.getTime()) / DAY));
    rows.push({ ...base(i), reason: `Quá hạn ${days} ngày`, level: 'danger', sort: 1000 + days });
  }
  for (const i of g.highPriTop) {
    rows.push({ ...base(i), reason: 'Ưu tiên cao, chưa gán người', level: 'warning', sort: 500 });
  }
  for (const i of g.dueSoonTop) {
    const dueInDays = Math.max(0, Math.round((i.dueDate!.getTime() - cutoff.getTime()) / DAY));
    rows.push({
      ...base(i),
      reason: dueInDays === 0 ? 'Đến hạn hôm nay' : `Sắp đến hạn (${dueInDays} ngày)`,
      level: 'warning',
      sort: 300 - dueInDays,
    });
  }
  return rows
    .sort((a, b) => b.sort - a.sort)
    .slice(0, 8)
    .map(({ sort: _s, ...r }) => r);
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
  if (totals.overdue > 0)
    warnings.push({
      level: 'danger',
      text: `${totals.overdue} công việc đã quá hạn cần xử lý ngay.`,
    });
  if (highPriUnassigned > 0)
    warnings.push({
      level: 'warning',
      text: `${highPriUnassigned} công việc ưu tiên cao chưa có người làm.`,
    });
  if (dueSoon > 0)
    warnings.push({ level: 'warning', text: `${dueSoon} việc sắp đến hạn trong 3 ngày tới.` });
  if (unassignedNotDone > 0)
    warnings.push({ level: 'info', text: `${unassignedNotDone} việc chưa gán người thực hiện.` });
  if (warnings.length === 0)
    warnings.push({ level: 'info', text: 'Không có cảnh báo — tiến độ đang trong tầm kiểm soát.' });

  // Dự báo (bằng chữ)
  const forecast: { label: string; text: string }[] = [];
  forecast.push({
    label: 'Tiến độ',
    text: `Đã hoàn thành ${totals.done}/${totals.total} việc (${completionRate}%). Còn ${notDone} việc chưa xong.`,
  });
  if (notDone > 0) {
    if (weekly >= 1) {
      const etaWeeks = Math.ceil(notDone / weekly);
      forecast.push({
        label: 'Dự kiến hoàn tất',
        text: `Nhịp xử lý gần đây ~${weekly.toFixed(1)} việc/tuần → dự kiến cần ~${etaWeeks} tuần nữa để xong nếu giữ nhịp.`,
      });
    } else {
      forecast.push({
        label: 'Cảnh báo tiến độ',
        text: `14 ngày qua gần như không có việc nào hoàn tất trong khi còn ${notDone} việc tồn — tiến độ đang chững, nên rà soát nguồn lực/độ ưu tiên.`,
      });
    }
  } else if (totals.total > 0) {
    forecast.push({ label: 'Dự kiến hoàn tất', text: 'Tất cả việc đã hoàn thành 🎉' });
  }
  if (notDone > 0 && totals.overdue > 0) {
    const r = Math.round((totals.overdue / notDone) * 100);
    forecast.push({
      label: 'Rủi ro trễ hạn',
      text: `${r}% việc chưa xong đang quá hạn — ưu tiên nhóm quá hạn để tránh dồn ứ.`,
    });
  }
  return { warnings, forecast };
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const MS_PER_DAY = 86_400_000;
const daysBetween = (from: Date, to: Date): number =>
  Math.round(
    (Date.parse(`${dayKey(to)}T00:00:00.000Z`) - Date.parse(`${dayKey(from)}T00:00:00.000Z`)) /
      MS_PER_DAY,
  );

/**
 * Thời gian sprint theo NGÀY LỊCH (UTC, đếm cả hai đầu). `totalDays`/`daysLeft` null khi chưa đặt ngày kết thúc;
 * `daysLeft` chỉ cho sprint ACTIVE (0 = hết hôm nay, âm = trễ).
 */
function sprintTime(
  s: {
    state: string;
    createdAt: Date;
    startDate: Date | null;
    endDate: Date | null;
    completeDate: Date | null;
  },
  now: Date,
): SprintSummaryReport['time'] {
  if (!s.endDate) return { totalDays: null, elapsedDays: null, daysLeft: null };
  const start = s.startDate ?? s.createdAt;
  const totalDays = Math.max(daysBetween(start, s.endDate) + 1, 1);
  const ref = s.state === 'CLOSED' ? (s.completeDate ?? s.endDate) : now;
  const elapsedDays =
    s.state === 'FUTURE' ? 0 : Math.min(Math.max(daysBetween(start, ref) + 1, 0), totalDays);
  return {
    totalDays,
    elapsedDays,
    daysLeft: s.state === 'ACTIVE' ? daysBetween(now, s.endDate) : null,
  };
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
