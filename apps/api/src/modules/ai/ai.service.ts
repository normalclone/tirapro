import { Injectable } from '@nestjs/common';
import type {
  AiCapabilities,
  AiGeneratedIssue,
  AiGenerateIssuesResult,
  AiSummaryResult,
  AiSuggestResult,
  GenerateIssuesInput,
} from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { ClaudeService } from './claude.service';

/** JSON Schema cho forced tool-use: đề xuất issues. */
const GENERATE_ISSUES_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Tiêu đề ngắn gọn (<120 ký tự)' },
          type: { type: 'string', enum: ['Task', 'Bug', 'Story', 'Epic'] },
          description: { type: 'string' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' } },
          storyPoints: { type: 'number', description: 'Ước lượng theo Fibonacci: 1,2,3,5,8,13' },
          priority: { type: 'string', enum: ['Highest', 'High', 'Medium', 'Low', 'Lowest'] },
        },
        required: ['summary'],
      },
    },
  },
  required: ['issues'],
};

const SUGGEST_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    priority: { type: 'string', enum: ['Highest', 'High', 'Medium', 'Low', 'Lowest'] },
    storyPoints: { type: 'number' },
    rationale: { type: 'string', description: 'Giải thích ngắn gọn cho đề xuất (tiếng Việt)' },
  },
  required: ['rationale'],
};

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly claude: ClaudeService,
  ) {}

  capabilities(): AiCapabilities {
    const available = this.claude.available();
    return {
      available,
      mode: available ? 'claude' : 'heuristic',
      model: this.claude.modelPrimary,
      features: ['generate-issues', 'summarize', 'suggest'],
    };
  }

  // ---------- NL → issues (preview) ----------
  async generateIssues(workspaceId: string, input: GenerateIssuesInput): Promise<AiGenerateIssuesResult> {
    const project = await this.prisma.project.findFirst({
      where: { id: input.projectId, workspaceId, deletedAt: null },
      select: { id: true, key: true, name: true },
    });
    if (!project) throw new NotFoundAppException('Project');

    const result = await this.claude.extract<{ issues: AiGeneratedIssue[] }>({
      toolName: 'propose_issues',
      toolDescription: 'Đề xuất danh sách công việc (issues) có cấu trúc từ mô tả người dùng.',
      system:
        'Bạn là trợ lý quản lý dự án Agile. Phân rã yêu cầu thành các issue rõ ràng, khả thi. ' +
        'Mỗi issue có tiêu đề ngắn gọn, loại (Task/Bug/Story/Epic), mô tả, tiêu chí chấp nhận, ' +
        'ước lượng story points (Fibonacci) và độ ưu tiên. Trả lời bằng tiếng Việt, không bịa thông tin.',
      prompt: `Dự án: ${project.name} (${project.key}).\n\nYêu cầu của người dùng:\n${input.text}`,
      schema: GENERATE_ISSUES_SCHEMA,
      maxTokens: 3000,
    });
    if (result?.issues?.length) {
      return { source: 'claude', issues: result.issues.slice(0, 25) };
    }
    return { source: 'heuristic', issues: this.heuristicIssues(input.text) };
  }

  private heuristicIssues(text: string): AiGeneratedIssue[] {
    const parts = text
      .split(/\r?\n|(?<=[.!?])\s+|•|;/g)
      .map((s) => s.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter((s) => s.length > 3);
    const uniq = Array.from(new Set(parts)).slice(0, 15);
    const list = uniq.length ? uniq : [text.trim().slice(0, 120)];
    return list.map((s) => ({
      summary: s.slice(0, 120),
      type: this.guessType(s),
      description: s,
    }));
  }

  private guessType(s: string): string {
    if (/\b(lỗi|bug|sửa|fix|crash|error|hỏng)\b/i.test(s)) return 'Bug';
    if (/(người dùng|user|là .* tôi muốn|as a |story)/i.test(s)) return 'Story';
    return 'Task';
  }

  // ---------- Tóm tắt issue ----------
  async summarizeIssue(workspaceId: string, issueId: string): Promise<AiSummaryResult> {
    const issue = await this.loadIssue(workspaceId, issueId);
    const comments = await this.prisma.comment.findMany({
      where: { issueId: issue.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 50,
      include: { author: { select: { displayName: true } } },
    });

    const ctx =
      `Issue ${issue.key}: ${issue.summary}\n` +
      `Loại: ${issue.type?.name ?? '—'} | Trạng thái: ${issue.status?.name ?? '—'} | ` +
      `Ưu tiên: ${issue.priority?.name ?? '—'} | Phụ trách: ${issue.assignee?.displayName ?? 'chưa gán'}\n` +
      `Mô tả: ${stripText(issue.description) || '(trống)'}\n\n` +
      `Bình luận (${comments.length}):\n` +
      comments.map((c) => `- ${c.author?.displayName ?? 'Ẩn danh'}: ${stripText(c.body)}`).join('\n');

    const out = await this.claude.complete({
      system:
        'Tóm tắt issue ngắn gọn bằng 3-5 gạch đầu dòng: bối cảnh, tình trạng hiện tại, ' +
        'blocker/điểm cần chú ý, và bước tiếp theo đề xuất. Trả lời bằng tiếng Việt.',
      prompt: ctx,
      maxTokens: 800,
    });
    if (out) return { source: 'claude', summary: out };

    const lines = [
      `**${issue.key}** — ${issue.summary}`,
      `Trạng thái: ${issue.status?.name ?? '—'}${issue.assignee ? `, phụ trách ${issue.assignee.displayName}` : ''}.`,
      `Có ${comments.length} bình luận.`,
      issue.description ? `Mô tả: ${stripText(issue.description).slice(0, 200)}…` : 'Chưa có mô tả.',
    ];
    return { source: 'heuristic', summary: lines.join('\n') };
  }

  // ---------- Gợi ý ưu tiên / điểm ----------
  async suggest(workspaceId: string, issueId: string): Promise<AiSuggestResult> {
    const issue = await this.loadIssue(workspaceId, issueId);
    const ctx =
      `Issue ${issue.key}: ${issue.summary}\nLoại: ${issue.type?.name ?? '—'}\n` +
      `Mô tả: ${stripText(issue.description) || '(trống)'}`;

    const out = await this.claude.extract<{ priority?: string; storyPoints?: number; rationale: string }>({
      toolName: 'suggest_fields',
      toolDescription: 'Đề xuất độ ưu tiên và ước lượng story points cho issue.',
      system:
        'Bạn là trợ lý Agile. Dựa trên nội dung issue, đề xuất độ ưu tiên (Highest..Lowest) và ' +
        'story points (Fibonacci: 1,2,3,5,8,13). Giải thích ngắn gọn bằng tiếng Việt.',
      prompt: ctx,
      schema: SUGGEST_SCHEMA,
      maxTokens: 600,
    });
    if (out?.rationale) {
      return { source: 'claude', priority: out.priority, storyPoints: out.storyPoints, rationale: out.rationale };
    }

    // Heuristic: ưu tiên theo từ khoá, điểm theo độ dài mô tả
    const text = `${issue.summary} ${stripText(issue.description)}`.toLowerCase();
    const priority = /(khẩn|gấp|critical|production|sập|down|blocker)/.test(text)
      ? 'Highest'
      : /(lỗi|bug|sửa|fix)/.test(text)
        ? 'High'
        : 'Medium';
    const len = text.length;
    const storyPoints = len < 80 ? 2 : len < 200 ? 3 : len < 500 ? 5 : 8;
    return {
      source: 'heuristic',
      priority,
      storyPoints,
      rationale: `Đề xuất theo từ khoá & độ phức tạp ước lượng (heuristic — chưa bật AI).`,
    };
  }

  private async loadIssue(workspaceId: string, issueId: string) {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, workspaceId, deletedAt: null },
      include: { status: true, assignee: true, priority: true, type: true },
    });
    if (!issue) throw new NotFoundAppException('Issue');
    return issue;
  }
}

/** Rút text từ MARKDOWN hoặc TIPTAP_JSON (chỉ lấy nội dung dạng chữ). */
function stripText(input: string | null | undefined): string {
  if (!input) return '';
  const trimmed = input.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const acc: string[] = [];
      const walk = (n: unknown): void => {
        if (!n || typeof n !== 'object') return;
        const obj = n as Record<string, unknown>;
        if (typeof obj.text === 'string') acc.push(obj.text);
        if (Array.isArray(obj.content)) obj.content.forEach(walk);
      };
      walk(parsed);
      if (acc.length) return acc.join(' ').trim();
    } catch {
      /* không phải JSON hợp lệ → trả nguyên văn */
    }
  }
  return trimmed;
}
