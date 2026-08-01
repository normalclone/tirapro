import { Injectable } from '@nestjs/common';
import type { Prisma, TimeOffKind } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import {
  HOURS_PER_DAY,
  addDays,
  countWorkingDays,
  isWorkingDay,
  isoDay,
  parseDayParam,
  round2,
  startOfWeek,
  toUtcDay,
  weekLabel,
} from './date.util';
import type {
  CreateAllocationInput,
  CreateTimeOffInput,
  ListAllocationsQuery,
  ListTimeOffQuery,
  UpdateAllocationInput,
  UpdateTimeOffInput,
  WorkloadQuery,
} from './resources.schemas';

/** Số tuần tối đa một lần truy vấn bảng tải (chặn truy vấn quét cả năm). */
const MAX_WEEKS = 26;
/** Story point → giờ khi issue không có ước lượng gốc (originalEstimate). */
const HOURS_PER_STORY_POINT = 4;
/** Trần số issue nạp cho một lần tính tải. */
const MAX_ISSUES = 5000;

const USER_SELECT = { id: true, email: true, displayName: true, avatarUrl: true } as const;
const PROJECT_SELECT = { id: true, key: true, name: true } as const;

const ALLOCATION_SELECT = {
  id: true, projectId: true, userId: true, percent: true, startDate: true, endDate: true,
  note: true, createdAt: true,
  project: { select: PROJECT_SELECT },
  user: { select: USER_SELECT },
} satisfies Prisma.AllocationSelect;

const TIME_OFF_SELECT = {
  id: true, workspaceId: true, userId: true, kind: true, startDate: true, endDate: true,
  note: true, createdAt: true,
  user: { select: USER_SELECT },
} satisfies Prisma.TimeOffSelect;

export interface WorkloadWeekCell {
  weekStart: string;
  capacityHours: number;
  assignedHours: number;
  loggedHours: number;
  workingDays: number;
  offDays: number;
  /** % phân bổ trung bình trên các ngày làm việc thực sự của tuần. */
  allocationPercent: number;
  issueCount: number;
  /** assigned / capacity — null khi capacity = 0. */
  ratio: number | null;
  overloaded: boolean;
}

export interface WorkloadRow {
  user: { id: string; email: string; displayName: string; avatarUrl: string | null };
  weeks: WorkloadWeekCell[];
  totals: {
    capacityHours: number;
    assignedHours: number;
    loggedHours: number;
    ratio: number | null;
    overloaded: boolean;
  };
  /** true = chưa có bản ghi phân bổ nào → coi như toàn thời gian 100%. */
  usesDefaultCapacity: boolean;
}

export interface WorkloadReport {
  from: string;
  to: string;
  projectId: string | null;
  hoursPerDay: number;
  weeks: { start: string; end: string; label: string }[];
  rows: WorkloadRow[];
}

/**
 * Năng lực & tải nguồn lực.
 *
 * - **Phân bổ (Allocation)** — % thời gian một người dành cho một dự án trong một khoảng ngày.
 * - **Nghỉ phép / ngày lễ (TimeOff)** — `userId = null` nghĩa là ngày lễ áp dụng cho cả workspace.
 * - **Tải theo tuần** — với mỗi thành viên & mỗi tuần (Thứ Hai → Chủ Nhật):
 *   - `capacity` = Σ(ngày làm việc không nghỉ × 8h × %phân bổ của ngày đó)
 *   - `assigned` = Σ ước lượng issue được giao, trải đều theo ngày làm việc trong khoảng
 *     ngày của issue (`startDate`→`dueDate`); ước lượng = `originalEstimate`, thiếu thì
 *     `storyPoints × 4h`
 *   - `logged`  = Σ `WorkLog.timeSpent` có `startedAt` rơi vào tuần
 *   - `overloaded` = assigned > capacity
 */
@Injectable()
export class ResourcesService {
  constructor(private readonly prisma: PrismaService) {}

  /* ─────────────────────────── Phân bổ ─────────────────────────── */

  async listAllocations(workspaceId: string, q: ListAllocationsQuery) {
    const where: Prisma.AllocationWhereInput = {
      project: { workspaceId, deletedAt: null },
      ...(q.projectId ? { projectId: q.projectId } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
    };
    if (q.to) where.startDate = { lte: parseDayParam(q.to, new Date()) };
    if (q.from) where.endDate = { gte: parseDayParam(q.from, new Date()) };

    const rows = await this.prisma.allocation.findMany({
      where,
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      select: ALLOCATION_SELECT,
    });
    return rows.map((r) => this.toAllocationDto(r));
  }

  async createAllocation(workspaceId: string, dto: CreateAllocationInput) {
    const { startDate, endDate } = this.requireRange(dto.startDate, dto.endDate);
    await this.requireProject(workspaceId, dto.projectId);
    await this.requireMember(workspaceId, dto.userId);

    const created = await this.prisma.allocation.create({
      data: {
        projectId: dto.projectId,
        userId: dto.userId,
        percent: dto.percent ?? 100,
        startDate,
        endDate,
        note: dto.note ?? null,
      },
      select: ALLOCATION_SELECT,
    });
    return this.toAllocationDto(created);
  }

  async updateAllocation(workspaceId: string, id: string, dto: UpdateAllocationInput) {
    const current = await this.prisma.allocation.findFirst({
      where: { id, project: { workspaceId } },
      select: { id: true, startDate: true, endDate: true },
    });
    if (!current) throw new NotFoundAppException('Phân bổ');

    const data: Prisma.AllocationUpdateInput = {};
    if (dto.projectId !== undefined && dto.projectId !== null) {
      await this.requireProject(workspaceId, dto.projectId);
      data.project = { connect: { id: dto.projectId } };
    }
    if (dto.userId !== undefined && dto.userId !== null) {
      await this.requireMember(workspaceId, dto.userId);
      data.user = { connect: { id: dto.userId } };
    }
    if (dto.percent !== undefined && dto.percent !== null) data.percent = dto.percent;
    if (dto.note !== undefined) data.note = dto.note;

    const nextStart = dto.startDate ? toUtcDay(dto.startDate) : current.startDate;
    const nextEnd = dto.endDate ? toUtcDay(dto.endDate) : current.endDate;
    if (dto.startDate !== undefined || dto.endDate !== undefined) {
      const range = this.requireRange(nextStart, nextEnd);
      data.startDate = range.startDate;
      data.endDate = range.endDate;
    }

    const updated = await this.prisma.allocation.update({ where: { id }, data, select: ALLOCATION_SELECT });
    return this.toAllocationDto(updated);
  }

  async deleteAllocation(workspaceId: string, id: string) {
    const found = await this.prisma.allocation.findFirst({ where: { id, project: { workspaceId } }, select: { id: true } });
    if (!found) throw new NotFoundAppException('Phân bổ');
    await this.prisma.allocation.delete({ where: { id } });
    return { success: true };
  }

  /* ─────────────────────── Nghỉ phép / ngày lễ ─────────────────────── */

  async listTimeOff(workspaceId: string, q: ListTimeOffQuery) {
    const where: Prisma.TimeOffWhereInput = {
      workspaceId,
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.kind ? { kind: q.kind as TimeOffKind } : {}),
    };
    if (q.to) where.startDate = { lte: parseDayParam(q.to, new Date()) };
    if (q.from) where.endDate = { gte: parseDayParam(q.from, new Date()) };

    const rows = await this.prisma.timeOff.findMany({
      where,
      orderBy: [{ startDate: 'desc' }],
      take: 500,
      select: TIME_OFF_SELECT,
    });
    return rows.map((r) => this.toTimeOffDto(r));
  }

  async createTimeOff(workspaceId: string, dto: CreateTimeOffInput) {
    const { startDate, endDate } = this.requireRange(dto.startDate, dto.endDate);
    if (dto.userId) await this.requireMember(workspaceId, dto.userId);

    const created = await this.prisma.timeOff.create({
      data: {
        workspaceId,
        userId: dto.userId ?? null,
        kind: (dto.kind ?? 'LEAVE') as TimeOffKind,
        startDate,
        endDate,
        note: dto.note ?? null,
      },
      select: TIME_OFF_SELECT,
    });
    return this.toTimeOffDto(created);
  }

  async updateTimeOff(workspaceId: string, id: string, dto: UpdateTimeOffInput) {
    const current = await this.prisma.timeOff.findFirst({
      where: { id, workspaceId },
      select: { id: true, startDate: true, endDate: true },
    });
    if (!current) throw new NotFoundAppException('Ngày nghỉ');

    const data: Prisma.TimeOffUpdateInput = {};
    if (dto.userId !== undefined) {
      if (dto.userId) {
        await this.requireMember(workspaceId, dto.userId);
        data.user = { connect: { id: dto.userId } };
      } else {
        data.user = { disconnect: true };
      }
    }
    if (dto.kind !== undefined && dto.kind !== null) data.kind = dto.kind as TimeOffKind;
    if (dto.note !== undefined) data.note = dto.note;

    if (dto.startDate !== undefined || dto.endDate !== undefined) {
      const range = this.requireRange(
        dto.startDate ? toUtcDay(dto.startDate) : current.startDate,
        dto.endDate ? toUtcDay(dto.endDate) : current.endDate,
      );
      data.startDate = range.startDate;
      data.endDate = range.endDate;
    }

    const updated = await this.prisma.timeOff.update({ where: { id }, data, select: TIME_OFF_SELECT });
    return this.toTimeOffDto(updated);
  }

  async deleteTimeOff(workspaceId: string, id: string) {
    const found = await this.prisma.timeOff.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!found) throw new NotFoundAppException('Ngày nghỉ');
    await this.prisma.timeOff.delete({ where: { id } });
    return { success: true };
  }

  /* ─────────────────────────── Tải theo tuần ─────────────────────────── */

  async workload(workspaceId: string, q: WorkloadQuery): Promise<WorkloadReport> {
    const today = new Date();
    const from = parseDayParam(q.from, today);
    const to = parseDayParam(q.to, addDays(startOfWeek(today), 27)); // mặc định 4 tuần
    const rangeStart = startOfWeek(from);
    let lastWeekStart = startOfWeek(to < from ? from : to);
    if ((lastWeekStart.getTime() - rangeStart.getTime()) / (7 * 24 * 3600 * 1000) > MAX_WEEKS - 1) {
      lastWeekStart = addDays(rangeStart, (MAX_WEEKS - 1) * 7);
    }
    const rangeEnd = addDays(lastWeekStart, 6);
    const weekCount = Math.round((lastWeekStart.getTime() - rangeStart.getTime()) / (7 * 24 * 3600 * 1000)) + 1;
    const weekStarts = Array.from({ length: weekCount }, (_, i) => addDays(rangeStart, i * 7));
    const weekIndexOf = (d: Date) =>
      Math.floor((startOfWeek(d).getTime() - rangeStart.getTime()) / (7 * 24 * 3600 * 1000));

    const projectFilter = q.projectId ? { projectId: q.projectId } : {};

    const memberships = await this.prisma.workspaceMembership.findMany({
      where: { workspaceId, user: { status: { not: 'DEACTIVATED' } } },
      select: { user: { select: USER_SELECT } },
    });
    const users = memberships.map((m) => m.user).sort((a, b) => a.displayName.localeCompare(b.displayName, 'vi'));
    const userIds = users.map((u) => u.id);

    if (userIds.length === 0) {
      return {
        from: isoDay(rangeStart), to: isoDay(rangeEnd), projectId: q.projectId ?? null,
        hoursPerDay: HOURS_PER_DAY,
        weeks: weekStarts.map((w) => ({ start: isoDay(w), end: isoDay(addDays(w, 6)), label: weekLabel(w) })),
        rows: [],
      };
    }

    const [allocations, timeOffs, issues, workLogs] = await Promise.all([
      this.prisma.allocation.findMany({
        where: {
          userId: { in: userIds },
          project: { workspaceId, deletedAt: null },
          ...projectFilter,
          startDate: { lte: rangeEnd },
          endDate: { gte: rangeStart },
        },
        select: { userId: true, percent: true, startDate: true, endDate: true },
      }),
      this.prisma.timeOff.findMany({
        where: {
          workspaceId,
          startDate: { lte: rangeEnd },
          endDate: { gte: rangeStart },
          OR: [{ userId: null }, { userId: { in: userIds } }],
        },
        select: { userId: true, startDate: true, endDate: true },
      }),
      this.prisma.issue.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          assigneeId: { in: userIds },
          ...projectFilter,
          OR: [
            { startDate: { gte: rangeStart, lte: rangeEnd } },
            { dueDate: { gte: rangeStart, lte: rangeEnd } },
            { AND: [{ startDate: { lte: rangeStart } }, { dueDate: { gte: rangeEnd } }] },
          ],
        },
        take: MAX_ISSUES,
        select: { assigneeId: true, startDate: true, dueDate: true, originalEstimate: true, storyPoints: true },
      }),
      this.prisma.workLog.findMany({
        where: {
          authorId: { in: userIds },
          startedAt: { gte: rangeStart, lt: addDays(rangeEnd, 1) },
          issue: { workspaceId, deletedAt: null, ...projectFilter },
        },
        select: { authorId: true, timeSpent: true, startedAt: true },
      }),
    ]);

    // Ngày nghỉ: set ISO-day theo từng người + set chung (ngày lễ workspace).
    const holidayDays = new Set<string>();
    const offByUser = new Map<string, Set<string>>();
    for (const t of timeOffs) {
      const target = t.userId ? (offByUser.get(t.userId) ?? new Set<string>()) : holidayDays;
      if (t.userId) offByUser.set(t.userId, target);
      const s = toUtcDay(t.startDate) < rangeStart ? rangeStart : toUtcDay(t.startDate);
      const e = toUtcDay(t.endDate) > rangeEnd ? rangeEnd : toUtcDay(t.endDate);
      for (let d = s; d <= e; d = addDays(d, 1)) target.add(isoDay(d));
    }

    const allocByUser = new Map<string, { percent: number; start: Date; end: Date }[]>();
    for (const a of allocations) {
      const list = allocByUser.get(a.userId) ?? [];
      list.push({ percent: a.percent, start: toUtcDay(a.startDate), end: toUtcDay(a.endDate) });
      allocByUser.set(a.userId, list);
    }

    // Giờ đã log theo (user, tuần).
    const loggedByUserWeek = new Map<string, number>();
    for (const w of workLogs) {
      const idx = weekIndexOf(w.startedAt);
      if (idx < 0 || idx >= weekCount) continue;
      const k = `${w.authorId}#${idx}`;
      loggedByUserWeek.set(k, (loggedByUserWeek.get(k) ?? 0) + w.timeSpent);
    }

    // Ước lượng đã giao theo (user, tuần) — trải đều theo ngày làm việc của issue.
    const assignedByUserWeek = new Map<string, number>();
    const issueCountByUserWeek = new Map<string, number>();
    for (const i of issues) {
      if (!i.assigneeId) continue;
      const estimate = this.estimateSeconds(i.originalEstimate, i.storyPoints);
      const rawStart = i.startDate ?? i.dueDate;
      const rawEnd = i.dueDate ?? i.startDate;
      if (!rawStart || !rawEnd) continue;
      let winStart = toUtcDay(rawStart);
      let winEnd = toUtcDay(rawEnd);
      if (winEnd < winStart) [winStart, winEnd] = [winEnd, winStart];

      const totalWorking = countWorkingDays(winStart, winEnd);
      const spreadOverWorking = totalWorking > 0;
      const totalDays = spreadOverWorking
        ? totalWorking
        : Math.round((winEnd.getTime() - winStart.getTime()) / (24 * 3600 * 1000)) + 1;
      const perDay = totalDays > 0 ? estimate / totalDays : 0;

      const first = Math.max(0, weekIndexOf(winStart));
      const last = Math.min(weekCount - 1, weekIndexOf(winEnd));
      for (let idx = first; idx <= last; idx++) {
        const wStart = weekStarts[idx];
        const segStart = winStart > wStart ? winStart : wStart;
        const segEnd = winEnd < addDays(wStart, 6) ? winEnd : addDays(wStart, 6);
        if (segEnd < segStart) continue;
        const days = spreadOverWorking
          ? countWorkingDays(segStart, segEnd)
          : Math.round((segEnd.getTime() - segStart.getTime()) / (24 * 3600 * 1000)) + 1;
        const k = `${i.assigneeId}#${idx}`;
        issueCountByUserWeek.set(k, (issueCountByUserWeek.get(k) ?? 0) + 1);
        if (days > 0 && perDay > 0) assignedByUserWeek.set(k, (assignedByUserWeek.get(k) ?? 0) + perDay * days);
      }
    }

    const rows: WorkloadRow[] = users.map((u) => {
      const allocs = allocByUser.get(u.id) ?? [];
      const usesDefaultCapacity = allocs.length === 0;
      const userOff = offByUser.get(u.id);

      let tCap = 0;
      let tAssigned = 0;
      let tLogged = 0;

      const weeks: WorkloadWeekCell[] = weekStarts.map((wStart, idx) => {
        let capacityHours = 0;
        let workingDays = 0;
        let offDays = 0;
        let percentSum = 0;

        for (let i = 0; i < 7; i++) {
          const day = addDays(wStart, i);
          if (!isWorkingDay(day)) continue;
          const iso = isoDay(day);
          if (holidayDays.has(iso) || userOff?.has(iso)) {
            offDays++;
            continue;
          }
          workingDays++;
          const percent = usesDefaultCapacity
            ? 100
            : allocs.reduce((sum, a) => (a.start <= day && day <= a.end ? sum + a.percent : sum), 0);
          percentSum += percent;
          capacityHours += (HOURS_PER_DAY * percent) / 100;
        }

        const key = `${u.id}#${idx}`;
        const assignedHours = (assignedByUserWeek.get(key) ?? 0) / 3600;
        const loggedHours = (loggedByUserWeek.get(key) ?? 0) / 3600;
        tCap += capacityHours;
        tAssigned += assignedHours;
        tLogged += loggedHours;

        return {
          weekStart: isoDay(wStart),
          capacityHours: round2(capacityHours),
          assignedHours: round2(assignedHours),
          loggedHours: round2(loggedHours),
          workingDays,
          offDays,
          allocationPercent: workingDays > 0 ? Math.round(percentSum / workingDays) : 0,
          issueCount: issueCountByUserWeek.get(key) ?? 0,
          ratio: capacityHours > 0 ? round2(assignedHours / capacityHours) : null,
          overloaded: capacityHours > 0 ? assignedHours > capacityHours : assignedHours > 0,
        };
      });

      return {
        user: u,
        weeks,
        totals: {
          capacityHours: round2(tCap),
          assignedHours: round2(tAssigned),
          loggedHours: round2(tLogged),
          ratio: tCap > 0 ? round2(tAssigned / tCap) : null,
          overloaded: tCap > 0 ? tAssigned > tCap : tAssigned > 0,
        },
        usesDefaultCapacity,
      };
    });

    return {
      from: isoDay(rangeStart),
      to: isoDay(rangeEnd),
      projectId: q.projectId ?? null,
      hoursPerDay: HOURS_PER_DAY,
      weeks: weekStarts.map((w) => ({ start: isoDay(w), end: isoDay(addDays(w, 6)), label: weekLabel(w) })),
      rows,
    };
  }

  /* ─────────────────────────── helpers ─────────────────────────── */

  private estimateSeconds(originalEstimate: number | null, storyPoints: number | null): number {
    if (originalEstimate && originalEstimate > 0) return originalEstimate;
    if (storyPoints && storyPoints > 0) return storyPoints * HOURS_PER_STORY_POINT * 3600;
    return 0;
  }

  private requireRange(start: Date | string, end: Date | string) {
    const startDate = toUtcDay(start);
    const endDate = toUtcDay(end);
    if (endDate < startDate) throw new BusinessRuleException('Ngày kết thúc phải sau ngày bắt đầu');
    return { startDate, endDate };
  }

  private async requireProject(workspaceId: string, projectId: string) {
    const p = await this.prisma.project.findFirst({ where: { id: projectId, workspaceId, deletedAt: null }, select: { id: true } });
    if (!p) throw new NotFoundAppException('Dự án');
    return p;
  }

  private async requireMember(workspaceId: string, userId: string) {
    const m = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    });
    if (!m) throw new BusinessRuleException('Người dùng không thuộc không gian làm việc này — hãy chọn một thành viên khác');
    return m;
  }

  private toAllocationDto(a: {
    id: string; projectId: string; userId: string; percent: number; startDate: Date; endDate: Date;
    note: string | null; createdAt: Date;
    project: { id: string; key: string; name: string };
    user: { id: string; email: string; displayName: string; avatarUrl: string | null };
  }) {
    return {
      id: a.id,
      projectId: a.projectId,
      userId: a.userId,
      percent: a.percent,
      startDate: isoDay(a.startDate),
      endDate: isoDay(a.endDate),
      note: a.note,
      createdAt: a.createdAt.toISOString(),
      project: a.project,
      user: a.user,
    };
  }

  private toTimeOffDto(t: {
    id: string; workspaceId: string; userId: string | null; kind: TimeOffKind; startDate: Date; endDate: Date;
    note: string | null; createdAt: Date;
    user: { id: string; email: string; displayName: string; avatarUrl: string | null } | null;
  }) {
    return {
      id: t.id,
      workspaceId: t.workspaceId,
      userId: t.userId,
      kind: t.kind,
      startDate: isoDay(t.startDate),
      endDate: isoDay(t.endDate),
      note: t.note,
      createdAt: t.createdAt.toISOString(),
      user: t.user,
    };
  }
}
