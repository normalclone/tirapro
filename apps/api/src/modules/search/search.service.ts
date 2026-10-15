import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parseJql, JqlParseError, type IssueDto, type JqlNode } from '@tirapro/shared';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import type { PageResult } from '../../common/dto/page-result';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { IssuesService } from '../issues/issues.service';
import { FulltextSearcher } from './fulltext';
import {
  collectFulltextTerms,
  compileJql,
  containsWhere,
  primaryFulltextTerm,
  topLevelProjectKeys,
} from './jql-compiler';

export interface SearchOptions {
  /** `jql` (mặc định, dùng `jql`) hoặc `text` (full-text trên `q`, xếp theo độ liên quan). */
  mode?: 'jql' | 'text';
  q?: string;
  jql?: string;
  projectId?: string;
  cursor?: string;
  limit: number;
  /** Không có ORDER BY tường minh thì xếp theo `rank` (thứ tự thả trên board/backlog) thay vì độ liên quan/updatedAt. */
  orderByRank?: boolean;
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
    let rankHint: string[] | undefined;

    if (opts.jql && opts.jql.trim()) {
      const ast = this.parse(opts.jql);
      const fulltext = new Map<string, readonly string[]>();
      const terms = collectFulltextTerms(ast.where);
      const scopeIds = terms.length
        ? await this.fulltextProjectScope(workspaceId, ast.where, opts.projectId)
        : undefined;
      for (const term of terms) {
        const res = await this.fulltext.search(
          workspaceId,
          term,
          scopeIds ? { projectIds: scopeIds } : {},
        );
        if (res) fulltext.set(term, res.ids); // null = chưa có searchVector → compiler dùng contains
      }
      const compiled = compileJql(ast, { currentUserId, fulltext });
      where = compiled.where;
      orderBy = compiled.orderBy;
      const primary = primaryFulltextTerm(ast.where);
      const ids = primary ? fulltext.get(primary) : undefined;
      // Không ORDER BY tường minh → id khớp full-text xếp theo rank lên trước. Chỉ là gợi ý xếp hạng:
      // tập kết quả do `where` (đã gồm ILIKE summary/description/key) quyết định, không bị cắt top-200.
      if (ids && !orderBy.length && !opts.orderByRank) rankHint = [...ids];
    }
    if (opts.orderByRank && !orderBy.length) orderBy = [{ rank: 'asc' }];
    if (opts.projectId) {
      where = Object.keys(where).length
        ? { AND: [where, { projectId: opts.projectId }] }
        : { projectId: opts.projectId };
    }
    return this.issues.query(
      workspaceId,
      where,
      orderBy,
      opts.cursor,
      opts.limit,
      undefined,
      rankHint,
    );
  }

  /**
   * Phạm vi project cho truy vấn full-text của JQL: `opts.projectId` ∩ project của điều kiện
   * `project = X` / `IN (…)` trên chuỗi AND thuần. undefined = cả workspace.
   */
  private async fulltextProjectScope(
    workspaceId: string,
    where: JqlNode | null,
    projectId: string | undefined,
  ): Promise<string[] | undefined> {
    let scopeIds: string[] | undefined = projectId ? [projectId] : undefined;
    const keys = topLevelProjectKeys(where);
    if (keys) {
      const found = (
        await this.prisma.project.findMany({
          where: { workspaceId, key: { in: keys }, deletedAt: null },
          select: { id: true },
        })
      ).map((p) => p.id);
      scopeIds = scopeIds ? scopeIds.filter((id) => found.includes(id)) : found;
    }
    return scopeIds;
  }

  private async searchText(
    workspaceId: string,
    opts: SearchOptions,
  ): Promise<PageResult<IssueDto>> {
    const q = (opts.q ?? '').trim();
    if (!q) return this.issues.query(workspaceId, {}, [], opts.cursor, opts.limit, []);
    const res = await this.fulltext.search(workspaceId, q, { projectId: opts.projectId });
    if (res) return this.issues.query(workspaceId, {}, [], opts.cursor, opts.limit, res.ids);

    // Nhánh phòng thủ (FulltextSearcher đã có fallback translate(), không còn trả null): contains ĐÃ ESCAPE
    // (`q="_"` không được khớp mọi dòng) — dùng chung containsWhere với JQL.
    const match: Prisma.IssueWhereInput = {
      OR: [
        containsWhere('summary', q),
        containsWhere('description', q, true),
        containsWhere('key', q),
      ],
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
