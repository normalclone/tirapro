import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parseJql, JqlParseError, type IssueDto } from '@tirapro/shared';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import type { PageResult } from '../../common/dto/page-result';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { IssuesService } from '../issues/issues.service';
import { compileJql } from './jql-compiler';

export interface SearchOptions {
  jql?: string;
  projectId?: string;
  cursor?: string;
  limit: number;
}

/** Một lựa chọn cho bộ dựng truy vấn (value đúng dạng JQL khớp, label hiển thị). */
export interface FieldOption {
  value: string;
  label: string;
  color?: string | null;
}

/** Danh mục giá trị cho bộ lọc "đơn giản" — gom theo workspace, khử trùng theo tên. */
export interface FilterFieldsDto {
  types: FieldOption[];
  statuses: FieldOption[];
  priorities: FieldOption[];
  sprints: FieldOption[];
  labels: FieldOption[];
  resolutions: FieldOption[];
}

@Injectable()
export class SearchService {
  constructor(
    private readonly issues: IssuesService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Danh mục giá trị cho bộ dựng truy vấn trực quan: issue type, status, priority,
   * sprint, label, resolution — phạm vi workspace. Status gom từ mọi workflow; sprint/label
   * gom từ mọi project (khử trùng theo tên vì JQL khớp theo tên). Degrade: rỗng nếu chưa có.
   */
  async fields(workspaceId: string): Promise<FilterFieldsDto> {
    const [types, statuses, priorities, sprints, labels, resolutions] = await Promise.all([
      this.prisma.issueType.findMany({
        where: { workspaceId },
        orderBy: { hierarchyLevel: 'asc' },
        select: { name: true, color: true },
      }),
      this.prisma.status.findMany({
        where: { workflow: { workspaceId } },
        orderBy: { order: 'asc' },
        select: { name: true, color: true },
      }),
      this.prisma.priority.findMany({
        where: { workspaceId },
        orderBy: { rank: 'desc' },
        select: { name: true, color: true },
      }),
      this.prisma.sprint.findMany({
        where: { project: { workspaceId, deletedAt: null } },
        orderBy: { sequence: 'desc' },
        select: { name: true },
        take: 100,
      }),
      this.prisma.label.findMany({
        where: { project: { workspaceId, deletedAt: null } },
        orderBy: { name: 'asc' },
        select: { name: true, color: true },
        take: 200,
      }),
      this.prisma.resolution.findMany({
        where: { workspaceId },
        orderBy: { rank: 'asc' },
        select: { name: true },
      }),
    ]);

    return {
      types: dedupeByName(types),
      statuses: dedupeByName(statuses),
      priorities: dedupeByName(priorities),
      sprints: dedupeByName(sprints),
      labels: dedupeByName(labels),
      resolutions: dedupeByName(resolutions),
    };
  }

  /** Tìm issue bằng JQL (parse → compile → Prisma). Workspace scope ghép trong IssuesService.query. */
  async search(workspaceId: string, currentUserId: string, opts: SearchOptions): Promise<PageResult<IssueDto>> {
    let where: Prisma.IssueWhereInput = {};
    let orderBy: Prisma.IssueOrderByWithRelationInput[] = [];

    if (opts.jql && opts.jql.trim()) {
      const ast = this.parse(opts.jql);
      const compiled = compileJql(ast, { currentUserId });
      where = compiled.where;
      orderBy = compiled.orderBy;
    }
    if (opts.projectId) {
      where = Object.keys(where).length ? { AND: [where, { projectId: opts.projectId }] } : { projectId: opts.projectId };
    }
    return this.issues.query(workspaceId, where, orderBy, opts.cursor, opts.limit);
  }

  /** Kiểm tra cú pháp JQL (cho FE highlight lỗi inline). */
  validate(jql: string): { valid: boolean; error?: string; position?: number } {
    try {
      parseJql(jql);
      return { valid: true };
    } catch (e) {
      if (e instanceof JqlParseError) return { valid: false, error: e.message, position: e.position };
      throw e;
    }
  }

  private parse(jql: string) {
    try {
      return parseJql(jql);
    } catch (e) {
      if (e instanceof JqlParseError) {
        throw new BusinessRuleException(`JQL không hợp lệ: ${e.message} (vị trí ${e.position})`);
      }
      throw e;
    }
  }
}

/** Khử trùng theo `name` (giữ bản đầu), trả về {value,label,color} cho FE. */
function dedupeByName(rows: { name: string; color?: string | null }[]): FieldOption[] {
  const seen = new Map<string, FieldOption>();
  for (const r of rows) {
    if (!seen.has(r.name)) seen.set(r.name, { value: r.name, label: r.name, color: r.color ?? null });
  }
  return [...seen.values()];
}
