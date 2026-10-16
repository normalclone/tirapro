import { Injectable, Logger } from '@nestjs/common';
import { GoalsService } from '../goals/goals.service';
import { expectedProgress, isBehind } from '../goals/goal-pace';
import { RaidService, type RaidLevel } from '../raid/raid.service';
import { addDays, isoDay, toUtcDay } from '../resources/date.util';
import { ResourcesService } from '../resources/resources.service';

const LIMIT = 5;

export interface LeadershipOverview {
  /** ≤5 rủi ro (loại RISK, trạng thái mở) điểm cao nhất; hoà thì hạn gần hơn trước. */
  topRisks: Array<{
    id: string;
    title: string;
    score: number;
    level: RaidLevel;
    levelLabel: string;
    project: { key: string; name: string } | null;
    owner: { id: string; displayName: string } | null;
    dueDate: string | null;
  }>;
  /** ≤5 mục tiêu ACTIVE có kỳ `YYYY-Qn` chậm hơn thời gian đã trôi ≥15 điểm; chênh lớn nhất trước. */
  slowGoals: Array<{
    id: string;
    name: string;
    period: string;
    progress: number;
    expectedProgress: number;
    owner: { id: string; displayName: string } | null;
  }>;
  /** ≤5 người quá tải ở tuần này hoặc tuần sau; tỉ số tải cao nhất trước. */
  overloaded: Array<{
    user: { id: string; displayName: string; avatarUrl: string | null };
    worstRatio: number;
    weekLabel: string;
    assignedHours: number;
    capacityHours: number;
  }>;
}

const person = (o: { id: string; displayName: string } | null) =>
  o ? { id: o.id, displayName: o.displayName } : null;

/**
 * Ba thẻ lãnh đạo trên Tổng quan: Top rủi ro · OKR chậm · Người quá tải. Mỗi nguồn đã lọc theo dự án người xem thấy
 * (viewerId truyền xuống RAID/OKR/nhân lực). Một nguồn lỗi chỉ làm thẻ của nó rỗng — không kéo sập các thẻ còn lại.
 */
@Injectable()
export class LeadershipService {
  private readonly logger = new Logger(LeadershipService.name);

  constructor(
    private readonly raid: RaidService,
    private readonly goals: GoalsService,
    private readonly resources: ResourcesService,
  ) {}

  async get(workspaceId: string, viewerId: string, now = new Date()): Promise<LeadershipOverview> {
    const [topRisks, slowGoals, overloaded] = await Promise.all([
      this.safe('topRisks', () => this.topRisks(workspaceId, viewerId)),
      this.safe('slowGoals', () => this.slowGoals(workspaceId, viewerId, now)),
      this.safe('overloaded', () => this.overloaded(workspaceId, viewerId, now)),
    ]);
    return { topRisks, slowGoals, overloaded };
  }

  private async safe<T>(what: string, run: () => Promise<T[]>): Promise<T[]> {
    try {
      return await run();
    } catch (err) {
      this.logger.warn(
        `Thẻ lãnh đạo (${what}) lỗi: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private async topRisks(
    workspaceId: string,
    viewerId: string,
  ): Promise<LeadershipOverview['topRisks']> {
    const items = await this.raid.list(workspaceId, { kind: 'RISK', status: 'OPEN' }, viewerId);
    const due = (d: string | null) => (d ? Date.parse(d) : Number.POSITIVE_INFINITY);
    return items
      .filter((r) => r.kind === 'RISK' && r.status === 'OPEN')
      .sort((a, b) => b.score - a.score || due(a.dueDate) - due(b.dueDate))
      .slice(0, LIMIT)
      .map((r) => ({
        id: r.id,
        title: r.title,
        score: r.score,
        level: r.level,
        levelLabel: r.levelLabel,
        project: r.project ? { key: r.project.key, name: r.project.name } : null,
        owner: person(r.owner),
        dueDate: r.dueDate,
      }));
  }

  private async slowGoals(
    workspaceId: string,
    viewerId: string,
    now: Date,
  ): Promise<LeadershipOverview['slowGoals']> {
    const goals = await this.goals.list(workspaceId, { status: 'ACTIVE' }, viewerId);
    const out: Array<LeadershipOverview['slowGoals'][number] & { gap: number }> = [];
    for (const g of goals) {
      if (g.status !== 'ACTIVE') continue;
      const expected = expectedProgress(g.period, now);
      if (expected === null || !isBehind(g.progress, expected)) continue;
      out.push({
        id: g.id,
        name: g.name,
        period: g.period,
        progress: g.progress,
        expectedProgress: expected,
        owner: person(g.owner),
        gap: expected - g.progress,
      });
    }
    return out
      .sort((a, b) => b.gap - a.gap)
      .slice(0, LIMIT)
      .map(({ gap: _gap, ...rest }) => rest);
  }

  private async overloaded(
    workspaceId: string,
    viewerId: string,
    now: Date,
  ): Promise<LeadershipOverview['overloaded']> {
    // [hôm nay, hôm nay + 7 ngày] phủ đúng tuần này và tuần sau (tuần bắt đầu Thứ Hai).
    const today = toUtcDay(now);
    const report = await this.resources.workload(
      workspaceId,
      { from: isoDay(today), to: isoDay(addDays(today, 7)) },
      viewerId,
    );
    const out: LeadershipOverview['overloaded'] = [];
    for (const row of report.rows) {
      let worst: { ratio: number; idx: number } | null = null;
      row.weeks.slice(0, 2).forEach((w, idx) => {
        // ratio null = năng lực 0 mà có việc: không có tỉ số để so nên bỏ để khỏi nhiễu.
        if (!w.overloaded || w.ratio === null) return;
        if (!worst || w.ratio > worst.ratio) worst = { ratio: w.ratio, idx };
      });
      if (!worst) continue;
      const { ratio, idx } = worst as { ratio: number; idx: number };
      const cell = row.weeks[idx]!;
      out.push({
        user: {
          id: row.user.id,
          displayName: row.user.displayName,
          avatarUrl: row.user.avatarUrl,
        },
        worstRatio: ratio,
        weekLabel: report.weeks[idx]?.label ?? cell.weekStart,
        assignedHours: cell.assignedHours,
        capacityHours: cell.capacityHours,
      });
    }
    return out.sort((a, b) => b.worstRatio - a.worstRatio).slice(0, LIMIT);
  }
}
