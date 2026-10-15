import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parseJql, JqlParseError, type IssueDto } from '@tirapro/shared';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import type { PageResult } from '../../common/dto/page-result';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { IssuesService } from '../issues/issues.service';
import { FulltextSearcher } from './fulltext';
import { collectFulltextTerms, compileJql, primaryFulltextTerm } from './jql-compiler';

export interface SearchOptions {
  /** `jql` (mặc định, dùng `jql`) hoặc `text` (full-text trên `q`, xếp theo độ liên quan). */
  mode?: 'jql' | 'text';
  q?: string;
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
  private readonly fulltext: FulltextSearcher;

  constructor(
    private readonly issues: IssuesService,
    private readonly prisma: PrismaService,
  ) {
    this.fulltext = new FulltextSearcher(prisma);
  }

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

  /**
   * Tìm issue. `mode=text`: full-text trên `q`; mặc định: JQL (parse → compile → Prisma). `text ~ "..."`
   * trong JQL cũng đi qua full-text. Workspace scope ghép trong IssuesService.query.
   */
  async search(
    workspaceId: string,
    currentUserId: string,
    opts: SearchOptions,
  ): Promise<PageResult<IssueDto>> {
    if (opts.mode === 'text') return this.searchText(workspaceId, opts);

    let where: Prisma.IssueWhereInput = {};
    let orderBy: Prisma.IssueOrderByWithRelationInput[] = [];
    let rawIds: string[] | undefined;

    if (opts.jql && opts.jql.trim()) {
      const ast = this.parse(opts.jql);
      const fulltext = new Map<string, readonly string[]>();
      for (const term of collectFulltextTerms(ast.where)) {
        const res = await this.fulltext.search(workspaceId, term);
        if (res) fulltext.set(term, res.ids); // null = chưa có searchVector → compiler dùng contains
      }
      const compiled = compileJql(ast, { currentUserId, fulltext });
      where = compiled.where;
      orderBy = compiled.orderBy;
      const primary = primaryFulltextTerm(ast.where);
      const ids = primary ? fulltext.get(primary) : undefined;
      if (ids && !orderBy.length) rawIds = [...ids]; // không ORDER BY tường minh → xếp theo rank
    }
    if (opts.projectId) {
      where = Object.keys(where).length
        ? { AND: [where, { projectId: opts.projectId }] }
        : { projectId: opts.projectId };
    }
    return this.issues.query(workspaceId, where, orderBy, opts.cursor, opts.limit, rawIds);
  }

  private async searchText(
    workspaceId: string,
    opts: SearchOptions,
  ): Promise<PageResult<IssueDto>> {
    const q = (opts.q ?? '').trim();
    if (!q) return this.issues.query(workspaceId, {}, [], opts.cursor, opts.limit, []);
    const res = await this.fulltext.search(workspaceId, q, { projectId: opts.projectId });
    if (res) return this.issues.query(workspaceId, {}, [], opts.cursor, opts.limit, res.ids);

    // Chưa có searchVector → rơi về contains (không xếp rank).
    const like = { contains: q, mode: 'insensitive' as const };
    const match: Prisma.IssueWhereInput = {
      OR: [{ summary: like }, { description: like }, { key: like }],
    };
    const where: Prisma.IssueWhereInput = opts.projectId
      ? { AND: [match, { projectId: opts.projectId }] }
      : match;
    return this.issues.query(workspaceId, where, [], opts.cursor, opts.limit);
  }

  /** Kiểm tra cú pháp JQL (cho FE highlight lỗi inline). */
  validate(jql: string): { valid: boolean; error?: string; position?: number } {
    try {
      parseJql(jql);
      return { valid: true };
    } catch (e) {
      if (e instanceof JqlParseError)
        return { valid: false, error: e.message, position: e.position };
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
    if (!seen.has(r.name))
      seen.set(r.name, { value: r.name, label: r.name, color: r.color ?? null });
  }
  return [...seen.values()];
}
