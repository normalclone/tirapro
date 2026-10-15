import { Injectable, Logger } from '@nestjs/common';
import type {
  AiAssigneeSuggestResult,
  AiAssigneeSuggestion,
  AiFallbackReason,
  SuggestAssigneeInput,
} from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { ClaudeService } from './claude.service';
import { DATA_NOT_INSTRUCTIONS, wrap } from './ai.service';

const WINDOW_DAYS = 90;
const MAX_CANDIDATES = 10;
const MAX_SUGGESTIONS = 3;

interface Candidate {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  resolvedSimilar: number;
  openLoad: number;
  recentTouch: boolean;
  score: number;
  reasons: string[];
}

const RANK_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    ranking: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Mã ẩn danh của ứng viên, ví dụ u1' },
          reason: {
            type: 'string',
            description: 'Lý do một câu bằng tiếng Việt, chỉ dựa trên số liệu được cung cấp',
          },
        },
        required: ['id', 'reason'],
      },
    },
  },
  required: ['ranking'],
};

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Gợi ý người nhận việc.
 * Heuristic luôn chạy và là nguồn sự thật cho `score`; Claude (nếu khả dụng) chỉ xếp hạng lại top 3 và giải thích.
 * Claude KHÔNG bao giờ thấy email/tên/id thật của thành viên — chỉ mã ẩn danh u1..uN cùng số liệu, map ngược sau khi trả lời.
 */
@Injectable()
export class AssigneeSuggestService {
  private readonly logger = new Logger(AssigneeSuggestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly claude: ClaudeService,
  ) {}

  async suggest(
    workspaceId: string,
    userId: string,
    input: SuggestAssigneeInput,
  ): Promise<AiAssigneeSuggestResult> {
    // Kiểm issue THUỘC dự án trong body (PermissionsGuard chỉ kiểm quyền trên projectId đó).
    const issue = await this.prisma.issue.findFirst({
      where: { id: input.issueId, projectId: input.projectId, workspaceId, deletedAt: null },
      select: {
        id: true,
        summary: true,
        typeId: true,
        projectId: true,
        parentId: true,
        epicId: true,
        assigneeId: true,
        type: { select: { name: true } },
        labels: { select: { labelId: true } },
        components: { select: { componentId: true } },
        sourceLinks: { select: { targetIssueId: true } },
        targetLinks: { select: { sourceIssueId: true } },
      },
    });
    if (!issue) throw new NotFoundAppException('Công việc');

    const candidates = await this.heuristic(issue);
    const top = candidates.slice(0, MAX_SUGGESTIONS).map(toSuggestion);
    if (candidates.length === 0) return { source: 'heuristic', suggestions: [] };

    if (!this.claude.available() || candidates.length < 2)
      return { source: 'heuristic', suggestions: top };

    const ranked = await this.rankWithClaude(
      workspaceId,
      userId,
      issue,
      candidates.slice(0, MAX_CANDIDATES),
    );
    if (ranked.suggestions) return { source: 'claude', suggestions: ranked.suggestions };
    return { source: 'heuristic', reason: ranked.reason, suggestions: top };
  }

  // ---------- heuristic ----------
  private async heuristic(issue: {
    id: string;
    typeId: string;
    projectId: string;
    parentId: string | null;
    epicId: string | null;
    labels: { labelId: string }[];
    components: { componentId: string }[];
    sourceLinks: { targetIssueId: string }[];
    targetLinks: { sourceIssueId: string }[];
  }): Promise<Candidate[]> {
    const members = await this.prisma.projectMembership.findMany({
      where: { projectId: issue.projectId, user: { status: 'ACTIVE' } },
      select: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
    });
    if (members.length === 0) return [];
    const ids = members.map((m) => m.user.id);
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);

    const similar: Record<string, unknown>[] = [{ typeId: issue.typeId }];
    if (issue.labels.length)
      similar.push({ labels: { some: { labelId: { in: issue.labels.map((l) => l.labelId) } } } });
    if (issue.components.length)
      similar.push({
        components: { some: { componentId: { in: issue.components.map((c) => c.componentId) } } },
      });

    const related = [
      issue.parentId,
      issue.epicId,
      ...issue.sourceLinks.map((l) => l.targetIssueId),
      ...issue.targetLinks.map((l) => l.sourceIssueId),
    ].filter((x): x is string => !!x && x !== issue.id);

    const [resolved, open, touchers] = await Promise.all([
      this.prisma.issue.groupBy({
        by: ['assigneeId'],
        where: {
          projectId: issue.projectId,
          deletedAt: null,
          id: { not: issue.id },
          assigneeId: { in: ids },
          status: { category: 'DONE' },
          resolvedAt: { gte: since },
          OR: similar,
        },
        _count: { _all: true },
      }),
      this.prisma.issue.groupBy({
        by: ['assigneeId'],
        where: {
          projectId: issue.projectId,
          deletedAt: null,
          assigneeId: { in: ids },
          status: { category: { not: 'DONE' } },
        },
        _count: { _all: true },
      }),
      this.touchers(related, ids, since),
    ]);

    const countOf = (rows: { assigneeId: string | null; _count: { _all: number } }[]) =>
      new Map(rows.filter((r) => r.assigneeId).map((r) => [r.assigneeId as string, r._count._all]));
    const resolvedBy = countOf(resolved);
    const openBy = countOf(open);
    const maxResolved = Math.max(0, ...resolvedBy.values());
    const maxOpen = Math.max(0, ...openBy.values());
    const norm = (v: number, max: number) => (max > 0 ? v / max : 0);

    return members
      .map(({ user }): Candidate => {
        const resolvedSimilar = resolvedBy.get(user.id) ?? 0;
        const openLoad = openBy.get(user.id) ?? 0;
        const recentTouch = touchers.has(user.id);
        const score = round2(
          0.5 * norm(resolvedSimilar, maxResolved) +
            0.3 * (1 - norm(openLoad, maxOpen)) +
            0.2 * (recentTouch ? 1 : 0),
        );
        const reasons: string[] = [];
        if (resolvedSimilar > 0)
          reasons.push(`Đã xử lý ${resolvedSimilar} issue tương tự trong ${WINDOW_DAYS} ngày qua`);
        reasons.push(
          openLoad === 0
            ? 'Hiện không có issue nào đang dở'
            : `Đang có ${openLoad} issue chưa xong`,
        );
        if (recentTouch) reasons.push('Đã tham gia issue cha hoặc issue liên kết');
        return {
          userId: user.id,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          resolvedSimilar,
          openLoad,
          recentTouch,
          score,
          reasons,
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.openLoad - b.openLoad ||
          a.displayName.localeCompare(b.displayName, 'vi'),
      );
  }

  /** Thành viên đã comment / sửa / được giao ở các issue cha & liên kết trong cửa sổ thời gian. */
  private async touchers(
    related: string[],
    memberIds: string[],
    since: Date,
  ): Promise<Set<string>> {
    if (related.length === 0) return new Set();
    const [comments, history, assigned] = await Promise.all([
      this.prisma.comment.findMany({
        where: {
          issueId: { in: related },
          authorId: { in: memberIds },
          deletedAt: null,
          createdAt: { gte: since },
        },
        select: { authorId: true },
        take: 500,
      }),
      this.prisma.issueHistory.findMany({
        where: { issueId: { in: related }, actorId: { in: memberIds }, occurredAt: { gte: since } },
        select: { actorId: true },
        take: 500,
      }),
      this.prisma.issue.findMany({
        where: { id: { in: related }, assigneeId: { in: memberIds }, deletedAt: null },
        select: { assigneeId: true },
      }),
    ]);
    const out = new Set<string>();
    for (const c of comments) if (c.authorId) out.add(c.authorId);
    for (const h of history) out.add(h.actorId);
    for (const a of assigned) if (a.assigneeId) out.add(a.assigneeId);
    return out;
  }

  // ---------- Claude ----------
  private async rankWithClaude(
    workspaceId: string,
    userId: string,
    issue: { summary: string; type: { name: string } },
    candidates: Candidate[],
  ): Promise<{ suggestions?: AiAssigneeSuggestion[]; reason?: AiFallbackReason }> {
    // Mã ẩn danh theo thứ tự heuristic; chỉ số liệu, không tên/email.
    const byAlias = new Map(candidates.map((c, i) => [`u${i + 1}`, c]));
    const table = candidates
      .map(
        (c, i) =>
          `u${i + 1} | giải_tương_tự=${c.resolvedSimilar} | đang_dở=${c.openLoad} | từng_tham_gia_issue_liên_quan=${c.recentTouch ? 'có' : 'không'} | điểm=${c.score}`,
      )
      .join('\n');
    try {
      const { data, reason } = await this.claude.extract<{
        ranking: { id: string; reason: string }[];
      }>({
        ctx: { workspaceId, userId, feature: 'suggest-assignee' },
        model: this.claude.modelFast,
        system:
          'Bạn giúp trưởng nhóm chọn người nhận một issue. Cho bảng số liệu của các ứng viên đã ẩn danh (u1, u2…), ' +
          `hãy chọn tối đa ${MAX_SUGGESTIONS} ứng viên phù hợp nhất theo thứ tự giảm dần, mỗi người kèm lý do đúng một câu tiếng Việt ` +
          'chỉ dựa trên số liệu (kinh nghiệm xử lý issue tương tự, khối lượng đang dở, mức độ liên quan). ' +
          'Chỉ dùng mã u1…uN có trong bảng; không bịa thông tin.' +
          DATA_NOT_INSTRUCTIONS,
        prompt: `${wrap('issue', `Loại: ${issue.type.name}\nTiêu đề: ${issue.summary}`)}\n\nỨng viên:\n${table}`,
        schema: RANK_SCHEMA,
        maxTokens: 600,
      });
      if (!data) return { reason };
      const seen = new Set<string>();
      const out: AiAssigneeSuggestion[] = [];
      for (const r of data.ranking ?? []) {
        const c = byAlias.get(r.id);
        if (!c || seen.has(r.id)) continue;
        seen.add(r.id);
        const claudeReason = typeof r.reason === 'string' ? r.reason.trim().slice(0, 300) : '';
        out.push({
          ...toSuggestion(c),
          reasons: claudeReason ? [claudeReason, ...c.reasons] : c.reasons,
        });
        if (out.length === MAX_SUGGESTIONS) break;
      }
      return out.length ? { suggestions: out } : { reason: 'error' };
    } catch (e) {
      // Hết hạn mức, khoá sai, quá tải… → người dùng vẫn nhận gợi ý heuristic thay vì lỗi.
      this.logger.warn(`Claude xếp hạng assignee thất bại → heuristic: ${(e as Error).message}`);
      return { reason: 'error' };
    }
  }
}

function toSuggestion(c: Candidate): AiAssigneeSuggestion {
  return {
    userId: c.userId,
    displayName: c.displayName,
    avatarUrl: c.avatarUrl,
    score: c.score,
    reasons: c.reasons,
  };
}
