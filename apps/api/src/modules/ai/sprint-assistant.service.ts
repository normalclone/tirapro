import { Injectable, Logger } from '@nestjs/common';
import type { AiFallbackReason, AiSprintPick, AiSprintPlanResult, SprintPlanInput } from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { ClaudeService } from './claude.service';
import { DATA_NOT_INSTRUCTIONS, wrap } from './ai.service';

const VELOCITY_SPRINTS = 3;
const DUE_SOON_DAYS = 14;
const CLAUDE_CANDIDATES = 40;
const BACKLOG_LIMIT = 500;

interface BacklogRow {
  id: string;
  key: string;
  summary: string;
  storyPoints: number | null;
  version: number;
  dueDate: Date | null;
  rank: string;
  priority: { rank: number } | null;
}

interface Candidate extends BacklogRow {
  storyPoints: number;
  dueSoon: boolean;
}

const PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Mã ứng viên, ví dụ c3' },
          reason: { type: 'string', description: 'Lý do một câu bằng tiếng Việt' },
        },
        required: ['id', 'reason'],
      },
    },
  },
  required: ['picks'],
};

/**
 * Trợ lý lập sprint. Heuristic (velocity + thứ tự ưu tiên backlog) luôn chạy và là kết quả mặc định;
 * Claude chỉ được gọi khi người dùng nhập mục tiêu sprint, để chọn lại tập issue khớp mục tiêu trong năng lực.
 * Kết quả của Claude luôn bị ép lại theo capacity ở phía server — không tin tổng điểm model tự tính.
 */
@Injectable()
export class SprintAssistantService {
  private readonly logger = new Logger(SprintAssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly claude: ClaudeService,
  ) {}

  async plan(workspaceId: string, userId: string, input: SprintPlanInput): Promise<AiSprintPlanResult> {
    const sprint = await this.prisma.sprint.findFirst({
      where: { id: input.sprintId, projectId: input.projectId, deletedAt: null, project: { workspaceId } },
      select: { id: true, state: true },
    });
    if (!sprint) throw new NotFoundAppException('Sprint');
    if (sprint.state === 'CLOSED') {
      throw new BusinessRuleException('Sprint này đã đóng. Hãy chọn một sprint chưa bắt đầu hoặc đang chạy để lập kế hoạch.');
    }

    const closes = await this.prisma.sprintSnapshot.findMany({
      where: { kind: 'CLOSE', sprint: { projectId: input.projectId, deletedAt: null } },
      orderBy: { snapshotAt: 'desc' },
      take: VELOCITY_SPRINTS,
      select: { completedPoints: true },
    });
    const velocityAvg = closes.length
      ? Math.round((closes.reduce((s, c) => s + c.completedPoints, 0) / closes.length) * 10) / 10
      : 0;
    const capacity = input.capacityPoints ?? velocityAvg;

    const backlog = (await this.prisma.issue.findMany({
      where: {
        workspaceId, projectId: input.projectId, sprintId: null, deletedAt: null,
        status: { category: { not: 'DONE' } },
        // Epic là vỏ gom nhóm, subtask đi theo issue cha → không đưa thẳng vào sprint.
        type: { isSubtask: false },
        NOT: { type: { key: 'EPIC' } },
      },
      orderBy: { rank: 'asc' },
      take: BACKLOG_LIMIT,
      select: { id: true, key: true, summary: true, storyPoints: true, version: true, dueDate: true, rank: true, priority: { select: { rank: true } } },
    })) as BacklogRow[];

    const dueLimit = Date.now() + DUE_SOON_DAYS * 86_400_000;
    const unestimated = backlog.filter((i) => !(i.storyPoints && i.storyPoints > 0)).length;
    const ordered: Candidate[] = backlog
      .filter((i): i is BacklogRow & { storyPoints: number } => !!i.storyPoints && i.storyPoints > 0)
      .map((i) => ({ ...i, dueSoon: !!i.dueDate && i.dueDate.getTime() <= dueLimit }))
      .sort(
        (a, b) =>
          Number(b.dueSoon) - Number(a.dueSoon) ||
          (b.priority?.rank ?? 0) - (a.priority?.rank ?? 0) ||
          (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0),
      );

    const heuristicPicks = this.greedy(ordered, capacity, (c) => this.heuristicReason(c));
    const base = { capacityPoints: capacity, velocityAvg, unestimated };
    const result = (picks: AiSprintPick[], extra: { source: 'claude' | 'heuristic'; reason?: AiFallbackReason }) => ({
      ...base, ...extra, picks, leftovers: ordered.length - picks.length,
    });

    const goal = input.goal?.trim();
    if (!goal || capacity <= 0 || ordered.length === 0 || !this.claude.available()) {
      return result(heuristicPicks, { source: 'heuristic' });
    }

    const claude = await this.pickWithClaude(workspaceId, userId, goal, capacity, ordered.slice(0, CLAUDE_CANDIDATES));
    return claude.picks
      ? result(claude.picks, { source: 'claude' })
      : result(heuristicPicks, { source: 'heuristic', reason: claude.reason });
  }

  /** Duyệt theo thứ tự, lấy issue nào còn vừa năng lực (issue quá lớn bị bỏ qua chứ không chặn các issue sau). */
  private greedy(list: Candidate[], capacity: number, reasonOf: (c: Candidate) => string): AiSprintPick[] {
    const picks: AiSprintPick[] = [];
    let used = 0;
    for (const c of list) {
      if (used + c.storyPoints > capacity) continue;
      used += c.storyPoints;
      picks.push(toPick(c, reasonOf(c)));
    }
    return picks;
  }

  private heuristicReason(c: Candidate): string {
    if (c.dueSoon) return `Đến hạn trong ${DUE_SOON_DAYS} ngày tới`;
    if ((c.priority?.rank ?? 0) > 0) return 'Độ ưu tiên cao, đứng đầu backlog';
    return 'Theo thứ tự backlog';
  }

  private async pickWithClaude(
    workspaceId: string,
    userId: string,
    goal: string,
    capacity: number,
    candidates: Candidate[],
  ): Promise<{ picks?: AiSprintPick[]; reason?: AiFallbackReason }> {
    const byAlias = new Map(candidates.map((c, i) => [`c${i + 1}`, c]));
    const lines = candidates
      .map((c, i) => `c${i + 1} | ${c.storyPoints} điểm | ưu tiên=${c.priority?.rank ?? 0}${c.dueSoon ? ' | sắp đến hạn' : ''} | ${c.summary}`)
      .join('\n');
    try {
      const { data, reason } = await this.claude.extract<{ picks: { id: string; reason: string }[] }>({
        ctx: { workspaceId, userId, feature: 'sprint-plan' },
        model: this.claude.modelFast,
        system:
          'Bạn là trợ lý lập kế hoạch sprint Agile. Từ danh sách ứng viên trong backlog (đã sắp theo độ ưu tiên) và mục tiêu sprint, ' +
          `chọn tập issue phù hợp nhất với mục tiêu sao cho tổng điểm không vượt ${capacity}. ` +
          'Ưu tiên issue sắp đến hạn hoặc có độ ưu tiên cao. Mỗi issue kèm lý do đúng một câu tiếng Việt. ' +
          'Chỉ dùng mã c1…cN có trong danh sách; không bịa thông tin.' + DATA_NOT_INSTRUCTIONS,
        prompt: `Mục tiêu sprint:\n${wrap('user_request', goal)}\n\nNăng lực: ${capacity} điểm.\n\nỨng viên:\n${wrap('issue', lines)}`,
        schema: PLAN_SCHEMA,
        maxTokens: 2000,
      });
      if (!data) return { reason };
      // Server ép lại: id hợp lệ, không trùng, tổng điểm ≤ capacity.
      const picks: AiSprintPick[] = [];
      const seen = new Set<string>();
      let used = 0;
      for (const p of data.picks ?? []) {
        const c = byAlias.get(p.id);
        if (!c || seen.has(p.id) || used + c.storyPoints > capacity) continue;
        seen.add(p.id);
        used += c.storyPoints;
        picks.push(toPick(c, (typeof p.reason === 'string' && p.reason.trim().slice(0, 300)) || 'Khớp mục tiêu sprint'));
      }
      return picks.length ? { picks } : { reason: 'error' };
    } catch (e) {
      this.logger.warn(`Claude lập sprint thất bại → heuristic: ${(e as Error).message}`);
      return { reason: 'error' };
    }
  }
}

function toPick(c: Candidate, reason: string): AiSprintPick {
  return { issueId: c.id, key: c.key, summary: c.summary, storyPoints: c.storyPoints, version: c.version, reason };
}
