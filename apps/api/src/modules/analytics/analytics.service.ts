import { Injectable } from '@nestjs/common';
import type {
  BurndownReport,
  CfdPoint,
  CfdReport,
  CreatedResolvedReport,
  VelocityReport,
} from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotFoundAppException } from '../../common/exceptions/app.exception';

type Category = 'TODO' | 'IN_PROGRESS' | 'DONE';

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

    const issues = await this.prisma.issue.findMany({
      where: { workspaceId, deletedAt: null },
      select: {
        id: true, key: true, summary: true, projectId: true, dueDate: true,
        createdAt: true, resolvedAt: true, assigneeId: true,
        status: { select: { category: true } },
        type: { select: { key: true, name: true, color: true } },
        priority: { select: { name: true, color: true, rank: true } },
      },
    });

    const empty = () => ({ total: 0, todo: 0, inProgress: 0, done: 0, overdue: 0, bug: 0 });
    const byProject = new Map<string, ReturnType<typeof empty>>();
    for (const p of projects) byProject.set(p.id, empty());
    const totals = empty();

    const typeMap = new Map<string, { name: string; color: string | null; count: number }>();
    const prioMap = new Map<string, { name: string; color: string | null; rank: number; count: number }>();

    // Xu hướng 8 tuần: tạo mới vs đã xử lý (bucket 7 = tuần hiện tại).
    const buckets = Array.from({ length: 8 }, () => ({ created: 0, resolved: 0 }));
    const weekLabel = (j: number) => {
      const d = new Date(now.getTime() - (7 - j) * WEEK);
      return `${d.getDate()}/${d.getMonth() + 1}`;
    };

    let resolvedLast14 = 0;
    let unassignedNotDone = 0;
    let highPriUnassigned = 0;
    let dueSoon = 0;
    const attention: { key: string; summary: string; projectKey: string; reason: string; level: 'danger' | 'warning'; sort: number }[] = [];

    for (const i of issues) {
      const cat = i.status.category as Category;
      const isDone = cat === 'DONE';
      const overdue = !!i.dueDate && i.dueDate < now && !isDone;
      const highPri = (i.priority?.rank ?? 0) >= HIGH_RANK;
      const isBug = i.type.key === 'BUG';

      for (const t of [totals, byProject.get(i.projectId)]) {
        if (!t) continue;
        t.total++;
        if (cat === 'TODO') t.todo++;
        else if (cat === 'IN_PROGRESS') t.inProgress++;
        else t.done++;
        if (overdue) t.overdue++;
        if (isBug) t.bug++;
      }

      const tn = i.type.name;
      const tRow = typeMap.get(tn) ?? { name: tn, color: i.type.color, count: 0 };
      tRow.count++;
      typeMap.set(tn, tRow);

      const pn = i.priority?.name ?? 'Chưa đặt';
      const pRow = prioMap.get(pn) ?? { name: pn, color: i.priority?.color ?? null, rank: i.priority?.rank ?? -1, count: 0 };
      pRow.count++;
      prioMap.set(pn, pRow);

      // Xu hướng
      const cIdx = Math.floor((now.getTime() - i.createdAt.getTime()) / WEEK);
      if (cIdx >= 0 && cIdx <= 7) buckets[7 - cIdx].created++;
      if (i.resolvedAt) {
        const rIdx = Math.floor((now.getTime() - i.resolvedAt.getTime()) / WEEK);
        if (rIdx >= 0 && rIdx <= 7) buckets[7 - rIdx].resolved++;
        if (now.getTime() - i.resolvedAt.getTime() <= 14 * DAY) resolvedLast14++;
      }

      // Cảnh báo + task cần chú ý
      if (!isDone && !i.assigneeId) unassignedNotDone++;
      if (!isDone && !i.assigneeId && highPri) highPriUnassigned++;
      const dueInDays = i.dueDate ? (i.dueDate.getTime() - now.getTime()) / DAY : null;
      if (!isDone && dueInDays !== null && dueInDays >= 0 && dueInDays <= 3) dueSoon++;

      const pk = keyByProject.get(i.projectId) ?? '';
      if (overdue) {
        const days = Math.ceil((now.getTime() - i.dueDate!.getTime()) / DAY);
        attention.push({ key: i.key, summary: i.summary, projectKey: pk, reason: `Quá hạn ${days} ngày`, level: 'danger', sort: 1000 + days });
      } else if (!isDone && highPri && !i.assigneeId) {
        attention.push({ key: i.key, summary: i.summary, projectKey: pk, reason: 'Ưu tiên cao, chưa gán người', level: 'warning', sort: 500 });
      } else if (!isDone && dueInDays !== null && dueInDays >= 0 && dueInDays <= 3) {
        attention.push({ key: i.key, summary: i.summary, projectKey: pk, reason: `Sắp đến hạn (${Math.ceil(dueInDays)} ngày)`, level: 'warning', sort: 300 - dueInDays });
      }
    }

    const notDone = totals.total - totals.done;
    const completionRate = totals.total ? Math.round((totals.done / totals.total) * 100) : 0;
    const weekly = resolvedLast14 / 2;

    // Cảnh báo (bằng chữ, có mức độ)
    const warnings: { level: 'danger' | 'warning' | 'info'; text: string }[] = [];
    if (totals.overdue > 0) warnings.push({ level: 'danger', text: `${totals.overdue} issue đã quá hạn cần xử lý ngay.` });
    if (highPriUnassigned > 0) warnings.push({ level: 'warning', text: `${highPriUnassigned} issue ưu tiên cao chưa có người làm.` });
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
      attention: attention.sort((a, b) => b.sort - a.sort).slice(0, 8).map(({ sort: _s, ...a }) => a),
    };
  }

  // ---------- Báo cáo tổng hợp 1 dự án (cho màn Reports) ----------
  async projectReport(workspaceId: string, projectId: string) {
    await this.requireProject(workspaceId, projectId);
    const now = new Date();
    const DAY = 24 * 3600 * 1000;
    const HIGH_RANK = 4; // High/Highest

    const issues = await this.prisma.issue.findMany({
      where: { projectId, deletedAt: null },
      select: {
        id: true,
        dueDate: true,
        storyPoints: true,
        assigneeId: true,
        status: { select: { name: true, category: true } },
        type: { select: { name: true, color: true } },
        priority: { select: { name: true, color: true, rank: true } },
        assignee: { select: { id: true, displayName: true } },
      },
    });

    const totals = { total: 0, todo: 0, inProgress: 0, done: 0, overdue: 0, unassigned: 0, points: 0 };

    // Phân bố theo trạng thái thực (mang màu theo category để nhất quán với board).
    const statusMap = new Map<string, { name: string; category: Category; count: number }>();
    const typeMap = new Map<string, { name: string; color: string | null; count: number }>();
    const prioMap = new Map<string, { name: string; color: string | null; rank: number; count: number }>();

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

    for (const i of issues) {
      const cat = i.status.category as Category;
      const isDone = cat === 'DONE';
      const overdue = !!i.dueDate && i.dueDate < now && !isDone;
      const pts = i.storyPoints ?? 0;

      totals.total++;
      totals.points = round(totals.points + pts);
      if (cat === 'TODO') totals.todo++;
      else if (cat === 'IN_PROGRESS') totals.inProgress++;
      else totals.done++;
      if (overdue) totals.overdue++;
      if (!i.assigneeId) totals.unassigned++;

      const sn = i.status.name;
      const sRow = statusMap.get(sn) ?? { name: sn, category: cat, count: 0 };
      sRow.count++;
      statusMap.set(sn, sRow);

      const tn = i.type.name;
      const tRow = typeMap.get(tn) ?? { name: tn, color: i.type.color, count: 0 };
      tRow.count++;
      typeMap.set(tn, tRow);

      const pn = i.priority?.name ?? 'Chưa đặt';
      const pRow = prioMap.get(pn) ?? { name: pn, color: i.priority?.color ?? null, rank: i.priority?.rank ?? -1, count: 0 };
      pRow.count++;
      prioMap.set(pn, pRow);

      const aKey = i.assigneeId ?? UNASSIGNED;
      const aRow =
        assigneeMap.get(aKey) ??
        ({
          id: i.assignee?.id ?? null,
          name: i.assignee?.displayName ?? 'Chưa gán',
          total: 0,
          inProgress: 0,
          done: 0,
          overdue: 0,
          points: 0,
        } as AssigneeRow);
      aRow.total++;
      aRow.points = round(aRow.points + pts);
      if (cat === 'IN_PROGRESS') aRow.inProgress++;
      else if (isDone) aRow.done++;
      if (overdue) aRow.overdue++;
      assigneeMap.set(aKey, aRow);
    }

    const CATEGORY_COLOR: Record<Category, string> = {
      TODO: 'var(--status-todo)',
      IN_PROGRESS: 'var(--status-progress)',
      DONE: 'var(--status-done)',
    };

    const highPriUnassigned = issues.filter(
      (i) => i.status.category !== 'DONE' && !i.assigneeId && (i.priority?.rank ?? 0) >= HIGH_RANK,
    ).length;
    const dueSoon = issues.filter((i) => {
      if (i.status.category === 'DONE' || !i.dueDate) return false;
      const d = (i.dueDate.getTime() - now.getTime()) / DAY;
      return d >= 0 && d <= 3;
    }).length;

    const completionRate = totals.total ? Math.round((totals.done / totals.total) * 100) : 0;

    // byAssignee: người có nhiều việc chưa xong lên trước; "Chưa gán" luôn xuống cuối.
    const byAssignee = [...assigneeMap.values()].sort((a, b) => {
      if (a.id === null) return 1;
      if (b.id === null) return -1;
      const aOpen = a.total - a.done;
      const bOpen = b.total - b.done;
      if (bOpen !== aOpen) return bOpen - aOpen;
      return b.total - a.total;
    });

    return {
      totals,
      completionRate,
      highPriUnassigned,
      dueSoon,
      byStatus: [...statusMap.values()].map((s) => ({
        name: s.name,
        count: s.count,
        color: CATEGORY_COLOR[s.category],
      })),
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
    if (!sprint) throw new NotFoundAppException('Sprint');

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
      while (h < history.length && history[h].occurredAt <= endOfDay) {
        const ev = history[h++];
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
  async cfd(workspaceId: string, projectId: string, fromStr?: string, toStr?: string): Promise<CfdReport> {
    await this.requireProject(workspaceId, projectId);
    const { from, to } = range(fromStr, toStr);
    const days = eachDay(from, to);

    const history = await this.prisma.issueHistory.findMany({
      where: { projectId, field: 'STATUS', occurredAt: { lte: new Date(`${days[days.length - 1]}T23:59:59.999Z`) } },
      orderBy: { occurredAt: 'asc' },
      select: { issueId: true, newCategory: true, occurredAt: true },
    });

    const current = new Map<string, Category>();
    let h = 0;
    const series: CfdPoint[] = days.map((date) => {
      const endOfDay = new Date(`${date}T23:59:59.999Z`);
      while (h < history.length && history[h].occurredAt <= endOfDay) {
        const ev = history[h++];
        if (ev.newCategory) current.set(ev.issueId, ev.newCategory as Category);
      }
      let todo = 0;
      let inProgress = 0;
      let doneC = 0;
      for (const cat of current.values()) {
        if (cat === 'DONE') doneC++;
        else if (cat === 'IN_PROGRESS') inProgress++;
        else todo++;
      }
      return { date, todo, inProgress, done: doneC };
    });

    return { from: days[0], to: days[days.length - 1], series };
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
      this.prisma.issue.findMany({
        where: { projectId, deletedAt: null, createdAt: { gte: lo, lte: hi } },
        select: { createdAt: true },
      }),
      this.prisma.issueHistory.findMany({
        where: { projectId, field: 'STATUS', newCategory: 'DONE', occurredAt: { gte: lo, lte: hi } },
        select: { occurredAt: true },
      }),
    ]);

    const createdByDay = tallyByDay(created.map((c) => c.createdAt));
    const resolvedByDay = tallyByDay(resolved.map((r) => r.occurredAt));
    const series = days.map((date) => ({
      date,
      created: createdByDay.get(date) ?? 0,
      resolved: resolvedByDay.get(date) ?? 0,
    }));
    return { from: days[0], to: days[days.length - 1], series };
  }

  private async requireProject(workspaceId: string, projectId: string) {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw new NotFoundAppException('Project');
    return p;
  }
}

// ---------- helpers ----------
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

function tallyByDay(dates: Date[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of dates) m.set(dayKey(d), (m.get(dayKey(d)) ?? 0) + 1);
  return m;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
