import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import type {
  CreateBaselineInput,
  CreateDependencyInput,
  CreateMilestoneInput,
  DependencyTypeInput,
  UpdateMilestoneInput,
} from './planning.schemas';

const MS_PER_DAY = 86_400_000;

/** Số ngày tuyệt đối (theo lịch UTC) — trục thời gian rời rạc cho CPM. */
function toDayNumber(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / MS_PER_DAY);
}

function fromDayNumber(n: number): string {
  return new Date(n * MS_PER_DAY).toISOString();
}

/** Không có ngày nào → suy thời lượng từ story point (heuristic), tối thiểu 1 ngày. */
function fallbackDuration(storyPoints: number | null): number {
  if (!storyPoints || storyPoints <= 0) return 1;
  return Math.min(Math.max(Math.round(storyPoints), 1), 20);
}

const ISSUE_REF_SELECT = { id: true, key: true, summary: true } as const;

interface CpmNode {
  id: string;
  key: string;
  summary: string;
  startDate: Date | null;
  dueDate: Date | null;
  /** Ngày sớm nhất được phép bắt đầu theo lịch đã đặt (null = tự do). */
  anchor: number | null;
  duration: number;
  es: number;
  ef: number;
  ls: number;
  lf: number;
}

interface CpmEdge {
  predecessorId: string;
  successorId: string;
  type: DependencyTypeInput;
  lagDays: number;
}

/**
 * Lịch trình nâng cao: phụ thuộc công việc, đường găng (CPM), cột mốc, kế hoạch gốc.
 *
 * Quy ước thời gian: mọi phép tính dùng "số ngày" nguyên (UTC), thanh công việc tính
 * bao gồm cả ngày bắt đầu lẫn ngày kết thúc → `finish = start + duration - 1`.
 */
@Injectable()
export class PlanningService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────── phụ thuộc ─────────────────────────

  async listDependencies(workspaceId: string, projectId: string) {
    await this.requireProject(workspaceId, projectId);
    const rows = await this.prisma.issueDependency.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, projectId: true, predecessorId: true, successorId: true,
        type: true, lagDays: true, createdAt: true,
        predecessor: { select: ISSUE_REF_SELECT },
        successor: { select: ISSUE_REF_SELECT },
      },
    });
    return rows.map((d) => ({
      id: d.id,
      projectId: d.projectId,
      predecessorId: d.predecessorId,
      successorId: d.successorId,
      type: d.type,
      lagDays: d.lagDays,
      createdAt: d.createdAt.toISOString(),
      predecessor: d.predecessor,
      successor: d.successor,
    }));
  }

  async createDependency(workspaceId: string, projectId: string, dto: CreateDependencyInput) {
    await this.requireProject(workspaceId, projectId);
    if (dto.predecessorId === dto.successorId) {
      throw new BusinessRuleException('Một công việc không thể phụ thuộc vào chính nó — hãy chọn công việc khác');
    }
    await this.requireIssues(projectId, [dto.predecessorId, dto.successorId]);

    const dup = await this.prisma.issueDependency.findFirst({
      where: { predecessorId: dto.predecessorId, successorId: dto.successorId },
      select: { id: true },
    });
    if (dup) throw new BusinessRuleException('Phụ thuộc này đã tồn tại');

    await this.assertNoCycle(projectId, dto.predecessorId, dto.successorId);

    const created = await this.prisma.issueDependency.create({
      data: {
        projectId,
        predecessorId: dto.predecessorId,
        successorId: dto.successorId,
        type: dto.type,
        lagDays: dto.lagDays,
      },
      select: { id: true },
    });
    const all = await this.listDependencies(workspaceId, projectId);
    return all.find((d) => d.id === created.id) ?? null;
  }

  async removeDependency(workspaceId: string, projectId: string, id: string) {
    await this.requireProject(workspaceId, projectId);
    const dep = await this.prisma.issueDependency.findFirst({ where: { id, projectId }, select: { id: true } });
    if (!dep) throw new NotFoundAppException('Phụ thuộc');
    await this.prisma.issueDependency.delete({ where: { id } });
    return { success: true };
  }

  // ───────────────────────── cột mốc ─────────────────────────

  async listMilestones(workspaceId: string, projectId: string) {
    await this.requireProject(workspaceId, projectId);
    const rows = await this.prisma.milestone.findMany({
      where: { projectId },
      orderBy: { dueDate: 'asc' },
    });
    return rows.map((m) => this.toMilestoneDto(m));
  }

  async createMilestone(workspaceId: string, projectId: string, dto: CreateMilestoneInput) {
    await this.requireProject(workspaceId, projectId);
    const name = dto.name.trim();
    if (!name) throw new BusinessRuleException('Tên cột mốc bắt buộc');
    const row = await this.prisma.milestone.create({
      data: {
        projectId,
        name,
        dueDate: new Date(dto.dueDate),
        description: dto.description ?? null,
        color: dto.color ?? null,
        completedAt: dto.completedAt ? new Date(dto.completedAt) : null,
      },
    });
    return this.toMilestoneDto(row);
  }

  async updateMilestone(workspaceId: string, projectId: string, id: string, dto: UpdateMilestoneInput) {
    await this.requireProject(workspaceId, projectId);
    const cur = await this.prisma.milestone.findFirst({ where: { id, projectId }, select: { id: true } });
    if (!cur) throw new NotFoundAppException('Cột mốc');

    const data: {
      name?: string; dueDate?: Date; description?: string | null; color?: string | null; completedAt?: Date | null;
    } = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BusinessRuleException('Tên cột mốc bắt buộc');
      data.name = name;
    }
    if (dto.dueDate !== undefined) data.dueDate = new Date(dto.dueDate);
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.completedAt !== undefined) data.completedAt = dto.completedAt ? new Date(dto.completedAt) : null;

    const row = await this.prisma.milestone.update({ where: { id }, data });
    return this.toMilestoneDto(row);
  }

  async removeMilestone(workspaceId: string, projectId: string, id: string) {
    await this.requireProject(workspaceId, projectId);
    const cur = await this.prisma.milestone.findFirst({ where: { id, projectId }, select: { id: true } });
    if (!cur) throw new NotFoundAppException('Cột mốc');
    await this.prisma.milestone.delete({ where: { id } });
    return { success: true };
  }

  // ───────────────────────── kế hoạch gốc ─────────────────────────

  async listBaselines(workspaceId: string, projectId: string) {
    await this.requireProject(workspaceId, projectId);
    const rows = await this.prisma.planBaseline.findMany({
      where: { projectId },
      orderBy: { capturedAt: 'desc' },
      select: {
        id: true, projectId: true, name: true, capturedAt: true, createdById: true,
        _count: { select: { items: true } },
      },
    });
    return rows.map((b) => ({
      id: b.id,
      projectId: b.projectId,
      name: b.name,
      capturedAt: b.capturedAt.toISOString(),
      createdById: b.createdById,
      itemCount: b._count.items,
    }));
  }

  /** Chụp ảnh startDate/dueDate của MỌI issue chưa xoá trong dự án. */
  async createBaseline(workspaceId: string, projectId: string, dto: CreateBaselineInput, actingUserId: string) {
    await this.requireProject(workspaceId, projectId);
    const issues = await this.prisma.issue.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true, startDate: true, dueDate: true },
    });
    const baseline = await this.prisma.planBaseline.create({
      data: { projectId, name: dto.name.trim(), createdById: actingUserId },
      select: { id: true },
    });
    if (issues.length > 0) {
      await this.prisma.planBaselineItem.createMany({
        data: issues.map((i) => ({
          baselineId: baseline.id,
          issueId: i.id,
          startDate: i.startDate,
          dueDate: i.dueDate,
        })),
      });
    }
    return this.getBaseline(workspaceId, projectId, baseline.id);
  }

  async getBaseline(workspaceId: string, projectId: string, id: string) {
    await this.requireProject(workspaceId, projectId);
    const b = await this.prisma.planBaseline.findFirst({
      where: { id, projectId },
      select: {
        id: true, projectId: true, name: true, capturedAt: true, createdById: true,
        items: {
          select: {
            issueId: true, startDate: true, dueDate: true,
            issue: { select: ISSUE_REF_SELECT },
          },
        },
      },
    });
    if (!b) throw new NotFoundAppException('Kế hoạch gốc');
    return {
      id: b.id,
      projectId: b.projectId,
      name: b.name,
      capturedAt: b.capturedAt.toISOString(),
      createdById: b.createdById,
      itemCount: b.items.length,
      items: b.items.map((it) => ({
        issueId: it.issueId,
        issueKey: it.issue.key,
        summary: it.issue.summary,
        startDate: it.startDate?.toISOString() ?? null,
        dueDate: it.dueDate?.toISOString() ?? null,
      })),
    };
  }

  // ───────────────────────── lịch trình / đường găng ─────────────────────────

  /**
   * CPM (Critical Path Method) trên đồ thị phụ thuộc.
   *
   * - Thời lượng lấy từ startDate/dueDate (bao gồm 2 đầu); thiếu ngày → suy từ ràng buộc
   *   phụ thuộc, không có ràng buộc nào thì lấy story point (fallback 1 ngày).
   * - Issue không có ngày VÀ không tham gia phụ thuộc nào → bỏ qua (`skippedCount`).
   * - Ngày đã đặt đóng vai trò "không bắt đầu sớm hơn" (anchor), nên slack luôn ≥ 0.
   */
  async schedule(workspaceId: string, projectId: string) {
    await this.requireProject(workspaceId, projectId);
    const [issues, deps] = await Promise.all([
      this.prisma.issue.findMany({
        where: { projectId, deletedAt: null },
        orderBy: [{ startDate: 'asc' }, { dueDate: 'asc' }, { number: 'asc' }],
        select: { id: true, key: true, summary: true, startDate: true, dueDate: true, storyPoints: true },
      }),
      this.prisma.issueDependency.findMany({
        where: { projectId },
        select: { predecessorId: true, successorId: true, type: true, lagDays: true },
      }),
    ]);

    const live = new Set(issues.map((i) => i.id));
    const edges: CpmEdge[] = deps
      .filter((d) => live.has(d.predecessorId) && live.has(d.successorId))
      .map((d) => ({
        predecessorId: d.predecessorId,
        successorId: d.successorId,
        type: d.type as DependencyTypeInput,
        lagDays: d.lagDays,
      }));

    const linked = new Set<string>();
    for (const e of edges) {
      linked.add(e.predecessorId);
      linked.add(e.successorId);
    }

    const included = issues.filter((i) => i.startDate || i.dueDate || linked.has(i.id));
    const skippedCount = issues.length - included.length;

    if (included.length === 0) {
      return {
        projectStart: null,
        projectFinish: null,
        durationDays: 0,
        criticalCount: 0,
        dependencyCount: edges.length,
        skippedCount,
        items: [] as ScheduleItem[],
      };
    }

    const nodes = new Map<string, CpmNode>();
    let projectStartDay: number | null = null;
    for (const i of included) {
      const s = i.startDate ? toDayNumber(i.startDate) : null;
      const e = i.dueDate ? toDayNumber(i.dueDate) : null;
      let anchor: number | null = null;
      let duration = 1;
      if (s !== null && e !== null) {
        anchor = Math.min(s, e);
        duration = Math.abs(e - s) + 1;
      } else if (s !== null) {
        anchor = s;
      } else if (e !== null) {
        anchor = e;
      } else {
        duration = fallbackDuration(i.storyPoints);
      }
      if (anchor !== null) projectStartDay = projectStartDay === null ? anchor : Math.min(projectStartDay, anchor);
      nodes.set(i.id, {
        id: i.id, key: i.key, summary: i.summary,
        startDate: i.startDate, dueDate: i.dueDate,
        anchor, duration, es: 0, ef: 0, ls: 0, lf: 0,
      });
    }
    const originDay = projectStartDay ?? toDayNumber(new Date());

    const incoming = new Map<string, CpmEdge[]>();
    const outgoing = new Map<string, CpmEdge[]>();
    for (const e of edges) {
      const inList = incoming.get(e.successorId);
      if (inList) inList.push(e); else incoming.set(e.successorId, [e]);
      const outList = outgoing.get(e.predecessorId);
      if (outList) outList.push(e); else outgoing.set(e.predecessorId, [e]);
    }

    const order = this.topoOrder([...nodes.keys()], incoming, outgoing);

    // Lượt xuôi: sớm nhất có thể.
    for (const id of order) {
      const n = nodes.get(id)!;
      let es = n.anchor ?? originDay;
      for (const e of incoming.get(id) ?? []) {
        const p = nodes.get(e.predecessorId);
        if (!p) continue;
        const req = this.earliestStartFrom(p, n, e);
        if (req > es) es = req;
      }
      n.es = es;
      n.ef = es + n.duration - 1;
    }

    let projectFinishDay = originDay;
    for (const n of nodes.values()) if (n.ef > projectFinishDay) projectFinishDay = n.ef;

    // Lượt ngược: muộn nhất cho phép mà không trễ dự án.
    for (let k = order.length - 1; k >= 0; k--) {
      const n = nodes.get(order[k])!;
      let lf = projectFinishDay;
      for (const e of outgoing.get(n.id) ?? []) {
        const s = nodes.get(e.successorId);
        if (!s) continue;
        const cap = this.latestFinishFrom(s, n, e);
        if (cap < lf) lf = cap;
      }
      if (lf < n.ef) lf = n.ef; // an toàn khi dữ liệu có chu trình sót
      n.lf = lf;
      n.ls = lf - n.duration + 1;
    }

    const items: ScheduleItem[] = included.map((i) => {
      const n = nodes.get(i.id)!;
      const slackDays = n.ls - n.es;
      return {
        id: n.id,
        key: n.key,
        summary: n.summary,
        startDate: n.startDate?.toISOString() ?? null,
        dueDate: n.dueDate?.toISOString() ?? null,
        durationDays: n.duration,
        earlyStart: fromDayNumber(n.es),
        earlyFinish: fromDayNumber(n.ef),
        lateStart: fromDayNumber(n.ls),
        lateFinish: fromDayNumber(n.lf),
        slackDays,
        isCritical: slackDays <= 0,
      };
    });

    return {
      projectStart: fromDayNumber(originDay),
      projectFinish: fromDayNumber(projectFinishDay),
      durationDays: projectFinishDay - originDay + 1,
      criticalCount: items.filter((it) => it.isCritical).length,
      dependencyCount: edges.length,
      skippedCount,
      items,
    };
  }

  // ───────────────────────── helpers ─────────────────────────

  /** Ràng buộc bắt đầu sớm nhất của `succ` do cạnh `e` từ `pred` áp đặt. */
  private earliestStartFrom(pred: CpmNode, succ: CpmNode, e: CpmEdge): number {
    switch (e.type) {
      case 'SS': return pred.es + e.lagDays;
      case 'FF': return pred.ef + e.lagDays - succ.duration + 1;
      case 'SF': return pred.es + e.lagDays - succ.duration + 1;
      default: return pred.ef + 1 + e.lagDays; // FS
    }
  }

  /** Ràng buộc kết thúc muộn nhất của `pred` do cạnh `e` tới `succ` áp đặt. */
  private latestFinishFrom(succ: CpmNode, pred: CpmNode, e: CpmEdge): number {
    switch (e.type) {
      case 'SS': return succ.ls - e.lagDays + pred.duration - 1;
      case 'FF': return succ.lf - e.lagDays;
      case 'SF': return succ.lf - e.lagDays + pred.duration - 1;
      default: return succ.ls - 1 - e.lagDays; // FS
    }
  }

  /** Kahn topological sort; phần còn lại (nếu có chu trình sót) được nối vào cuối. */
  private topoOrder(ids: string[], incoming: Map<string, CpmEdge[]>, outgoing: Map<string, CpmEdge[]>): string[] {
    const indeg = new Map<string, number>();
    for (const id of ids) indeg.set(id, (incoming.get(id) ?? []).length);
    const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
    const order: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      order.push(id);
      for (const e of outgoing.get(id) ?? []) {
        const left = (indeg.get(e.successorId) ?? 0) - 1;
        indeg.set(e.successorId, left);
        if (left === 0) queue.push(e.successorId);
      }
    }
    if (order.length < ids.length) {
      const seen = new Set(order);
      for (const id of ids) if (!seen.has(id)) order.push(id);
    }
    return order;
  }

  private async requireProject(workspaceId: string, projectId: string): Promise<void> {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw new NotFoundAppException('Dự án');
  }

  /** Mọi issue phải thuộc đúng dự án và chưa bị xoá. */
  private async requireIssues(projectId: string, issueIds: string[]): Promise<void> {
    const unique = [...new Set(issueIds)];
    const rows = await this.prisma.issue.findMany({
      where: { id: { in: unique }, projectId, deletedAt: null },
      select: { id: true },
    });
    if (rows.length !== unique.length) throw new NotFoundAppException('Công việc');
  }

  /**
   * Chặn CHU TRÌNH: cạnh mới là predecessor → successor, nên chỉ cần kiểm tra
   * predecessor có nằm phía sau successor trong đồ thị hiện tại hay không.
   */
  private async assertNoCycle(projectId: string, predecessorId: string, successorId: string): Promise<void> {
    const edges = await this.prisma.issueDependency.findMany({
      where: { projectId },
      select: { predecessorId: true, successorId: true },
    });
    const next = new Map<string, string[]>();
    for (const e of edges) {
      const arr = next.get(e.predecessorId);
      if (arr) arr.push(e.successorId);
      else next.set(e.predecessorId, [e.successorId]);
    }
    const seen = new Set<string>([successorId]);
    const stack = [successorId];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (cur === predecessorId) {
        throw new BusinessRuleException('Phụ thuộc này tạo thành chu trình — công việc trước đang phụ thuộc (trực tiếp hoặc gián tiếp) vào công việc sau');
      }
      for (const n of next.get(cur) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
  }

  private toMilestoneDto(m: {
    id: string; projectId: string; name: string; description: string | null;
    dueDate: Date; completedAt: Date | null; color: string | null; createdAt: Date; updatedAt: Date;
  }) {
    return {
      id: m.id,
      projectId: m.projectId,
      name: m.name,
      description: m.description,
      dueDate: m.dueDate.toISOString(),
      completedAt: m.completedAt?.toISOString() ?? null,
      color: m.color,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    };
  }
}

interface ScheduleItem {
  id: string;
  key: string;
  summary: string;
  startDate: string | null;
  dueDate: string | null;
  durationDays: number;
  earlyStart: string;
  earlyFinish: string;
  lateStart: string;
  lateFinish: string;
  slackDays: number;
  isCritical: boolean;
}
