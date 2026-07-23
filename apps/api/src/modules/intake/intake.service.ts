import { Injectable } from '@nestjs/common';
import type { CreateIssueInput } from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotFoundAppException, BusinessRuleException } from '../../common/exceptions/app.exception';
import { IssuesService } from '../issues/issues.service';
import type { ReportIssueInput } from './intake.schema';

/** Chuẩn hóa tiêu đề để so khớp dedupe: bỏ khoảng trắng thừa + lowercase. */
function normalizeSummary(summary: string): string {
  return summary.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface ReportDedupedResult {
  deduped: true;
  issueId: string;
  occurrenceCount: number;
}

export interface ReportCreatedResult {
  deduped: false;
  issueId: string;
  key: string;
}

export type ReportResult = ReportDedupedResult | ReportCreatedResult;

export interface DuplicateSuggestion {
  id: string;
  key: string;
  summary: string;
  occurrenceCount: number;
  triageState: string | null;
}

@Injectable()
export class IntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: IssuesService,
  ) {}

  /**
   * Báo cáo một issue (bug). Nếu đã tồn tại issue "sống" gần trùng tiêu đề trong cùng project
   * thì tăng occurrenceCount thay vì tạo mới (feed Triage inbox).
   */
  async report(workspaceId: string, userId: string, input: ReportIssueInput): Promise<ReportResult> {
    // 1. Xác minh project thuộc workspace hiện tại.
    const project = await this.prisma.project.findFirst({
      where: { id: input.projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundAppException('Project');

    // 2. Dedupe: tìm issue chưa xóa cùng project có tiêu đề chuẩn hóa trùng và còn "sống".
    const target = normalizeSummary(input.summary);
    const candidates = await this.prisma.issue.findMany({
      where: { projectId: input.projectId, deletedAt: null },
      select: {
        id: true,
        summary: true,
        occurrenceCount: true,
        triageState: true,
        version: true,
        status: { select: { category: true } },
      },
    });

    const duplicate = candidates.find((c) => {
      if (normalizeSummary(c.summary) !== target) return false;
      // "Sống" = đang chờ/snooze triage HOẶC trạng thái chưa Done.
      const liveTriage = c.triageState === 'PENDING' || c.triageState === 'SNOOZED';
      const notDone = c.status.category !== 'DONE';
      return liveTriage || notDone;
    });

    if (duplicate) {
      const updated = await this.prisma.issue.update({
        where: { id: duplicate.id },
        data: {
          occurrenceCount: { increment: 1 },
          triageState: 'PENDING', // mở lại triage
          version: { increment: 1 },
        },
        select: { id: true, occurrenceCount: true },
      });
      return { deduped: true, issueId: updated.id, occurrenceCount: updated.occurrenceCount };
    }

    // 3. Không trùng → tạo mới. Resolve typeId: body → IssueType 'Bug' → type đầu tiên.
    const typeId = input.typeId ?? (await this.resolveTypeId(workspaceId));

    const createInput: CreateIssueInput = {
      projectId: input.projectId,
      typeId,
      summary: input.summary,
      description: input.description ?? null,
      descriptionFormat: 'MARKDOWN',
    };
    const created = await this.issues.create(workspaceId, userId, createInput);

    await this.prisma.issue.update({
      where: { id: created.id },
      data: { triageState: 'PENDING', occurrenceCount: 1 },
    });

    return { deduped: false, issueId: created.id, key: created.key };
  }

  /**
   * Gợi ý các issue có thể trùng cho UI (tối đa 5): tiêu đề chuẩn hóa CHỨA truy vấn chuẩn hóa.
   */
  async findDuplicates(workspaceId: string, projectId: string, summary: string): Promise<DuplicateSuggestion[]> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundAppException('Project');

    const query = normalizeSummary(summary);
    if (!query) return [];

    const candidates = await this.prisma.issue.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true, key: true, summary: true, occurrenceCount: true, triageState: true },
    });

    return candidates
      .filter((c) => normalizeSummary(c.summary).includes(query))
      .slice(0, 5)
      .map((c) => ({
        id: c.id,
        key: c.key,
        summary: c.summary,
        occurrenceCount: c.occurrenceCount,
        triageState: c.triageState,
      }));
  }

  /** typeId mặc định cho intake: ưu tiên IssueType tên 'Bug', nếu không có lấy type đầu tiên. */
  private async resolveTypeId(workspaceId: string): Promise<string> {
    const bug = await this.prisma.issueType.findFirst({
      where: { workspaceId, name: 'Bug' },
      select: { id: true },
    });
    if (bug) return bug.id;

    const first = await this.prisma.issueType.findFirst({
      where: { workspaceId },
      orderBy: { hierarchyLevel: 'asc' },
      select: { id: true },
    });
    if (!first) throw new BusinessRuleException('Workspace chưa cấu hình loại issue nào');
    return first.id;
  }
}
