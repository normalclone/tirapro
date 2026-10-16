import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  parseJql,
  closestMatch,
  foldForMatch,
  JqlParseError,
  type IssueDto,
  type JqlFieldName,
  type JqlNode,
  type JqlValue,
} from '@tirapro/shared';
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
  /**
   * Báo lỗi 422 khi giá trị của type/status/priority/… không có trong workspace (kèm "ý bạn là …") thay vì trả rỗng im lặng.
   * Chỉ bật cho truy vấn gõ tay (`GET /search`); board và bộ lọc đã lưu giữ hành vi cũ để dữ liệu đổi tên không làm sập chúng.
   */
  checkValues?: boolean;
}

/** Trường JQL được kiểm giá trị → tên tiếng Việt dùng trong câu báo lỗi. */
const CHECKED_FIELD_LABEL: Partial<Record<JqlFieldName, string>> = {
  type: 'loại',
  status: 'trạng thái',
  priority: 'mức ưu tiên',
  severity: 'mức nghiêm trọng',
  resolution: 'kết luận xử lý',
  sprint: 'sprint',
  project: 'dự án',
};
const MAX_LISTED_VALUES = 8;

export interface JqlValueSuggestion {
  field: string;
  value: string;
  didYouMean: string | null;
}

export interface JqlValidation {
  valid: boolean;
  error?: string;
  position?: number;
  suggestions?: JqlValueSuggestion[];
}

interface InvalidValue extends JqlValueSuggestion {
  message: string;
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
  severities: FieldOption[];
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
   * Id các issue gần giống `text` trong một dự án, xếp theo độ liên quan (bỏ dấu + tiền tố + trigram) — cho gợi ý
   * trùng của form Báo lỗi. Hàm bọc duy nhất quanh `FulltextSearcher`: nếu chữ ký tìm kiếm đổi thì chỉ sửa ở đây.
   */
  async similarIssueIds(
    workspaceId: string,
    projectId: string,
    text: string,
    limit = 8,
  ): Promise<string[]> {
    const res = await this.fulltext.search(workspaceId, text, { projectId, limit });
    return res?.ids ?? [];
  }

  /**
   * Danh mục giá trị cho bộ dựng truy vấn trực quan: issue type, status, priority,
   * sprint, label, resolution — phạm vi workspace. Status gom từ mọi workflow; sprint/label
   * gom từ mọi project (khử trùng theo tên vì JQL khớp theo tên). Degrade: rỗng nếu chưa có.
   */
  async fields(workspaceId: string): Promise<FilterFieldsDto> {
    const [types, statuses, priorities, severities, sprints, labels, resolutions] =
      await Promise.all([
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
        this.prisma.severity.findMany({
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
      severities: dedupeByName(severities),
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
      if (opts.checkValues) {
        const [first] = await this.findInvalidValues(workspaceId, ast.where);
        if (first) throw new BusinessRuleException(first.message);
      }
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

  /**
   * Kiểm tra JQL cho FE báo lỗi inline: cú pháp (kèm vị trí), rồi giá trị không có trong workspace
   * (kèm "ý bạn là …"). Lỗi giá trị có `valid:false` + `error` (câu đầu tiên) + `suggestions` (mọi giá trị sai).
   */
  async validate(workspaceId: string, jql: string): Promise<JqlValidation> {
    let ast;
    try {
      ast = parseJql(jql);
    } catch (e) {
      if (e instanceof JqlParseError)
        return { valid: false, error: e.message, position: e.position };
      throw e;
    }
    const bad = await this.findInvalidValues(workspaceId, ast.where);
    if (!bad.length) return { valid: true };
    return {
      valid: false,
      error: bad[0]!.message,
      suggestions: bad.map(({ field, value, didYouMean }) => ({ field, value, didYouMean })),
    };
  }

  /**
   * Giá trị chuỗi của `type/status/priority/severity/resolution/sprint/project` (toán tử `=`, `!=`, `IN`, `NOT IN`)
   * không khớp (không phân biệt hoa thường/dấu) giá trị nào có thật trong workspace. Chỉ tra danh mục của các trường
   * có mặt trong truy vấn. Không kiểm nhãn (tự do), summary/text, ngày, số, người.
   */
  private async findInvalidValues(
    workspaceId: string,
    where: JqlNode | null,
  ): Promise<InvalidValue[]> {
    const wanted: { field: JqlFieldName; value: string }[] = [];
    const walk = (n: JqlNode): void => {
      if (n.type === 'logical') {
        walk(n.left);
        walk(n.right);
      } else if (n.type === 'not') {
        walk(n.node);
      } else if (
        CHECKED_FIELD_LABEL[n.field] &&
        (n.operator === '=' ||
          n.operator === '!=' ||
          n.operator === 'IN' ||
          n.operator === 'NOT IN')
      ) {
        const vs: JqlValue[] = n.value.kind === 'list' ? n.value.value : [n.value];
        for (const v of vs)
          if (v.kind === 'string') wanted.push({ field: n.field, value: v.value });
      }
    };
    if (where) walk(where);
    if (!wanted.length) return [];

    // Khớp đúng như compiler: so tên KHÔNG phân biệt hoa/thường (không bỏ dấu), nên chỉ khác hoa/thường là hợp lệ.
    const byField = new Map<JqlFieldName, string[]>();
    for (const w of wanted) byField.set(w.field, [...(byField.get(w.field) ?? []), w.value]);
    const catalogs = new Map<JqlFieldName, string[]>();
    const known = new Map<JqlFieldName, Set<string>>();
    for (const [field, values] of byField) {
      if (field === 'sprint') {
        // Danh mục sprint bị cắt (take) nên kiểm tồn tại theo tên, không so với danh sách cắt.
        known.set(field, await this.existingSprintNames(workspaceId, values));
      } else {
        const names = await this.catalogNames(workspaceId, field);
        catalogs.set(field, names);
        known.set(field, new Set(names.map((n) => n.toLowerCase())));
      }
    }

    const out: InvalidValue[] = [];
    const seen = new Set<string>();
    for (const { field, value } of wanted) {
      if (known.get(field)!.has(value.toLowerCase())) continue;
      const dedupeKey = `${field}\u0000${foldForMatch(value)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      // Chỉ lúc có giá trị sai mới cần danh mục (có thể bị cắt) để gợi ý "ý bạn là" / liệt kê.
      if (!catalogs.has(field)) catalogs.set(field, await this.catalogNames(workspaceId, field));
      const options = catalogs.get(field)!;
      const didYouMean = closestMatch(value, options);
      const label = CHECKED_FIELD_LABEL[field]!;
      const message = didYouMean
        ? `Không có ${label} "${value}" — ý bạn là "${didYouMean}"?`
        : options.length
          ? `Không có ${label} "${value}". Các giá trị hiện có: ${options.slice(0, MAX_LISTED_VALUES).join(', ')}${options.length > MAX_LISTED_VALUES ? '…' : ''}`
          : `Không có ${label} "${value}".`;
      out.push({ field, value, didYouMean, message });
    }
    return out;
  }

  /** Tên sprint (không phân biệt hoa/thường, viết thường) trong số `values` có thật ở workspace — truy vấn tồn tại, không cắt. */
  private async existingSprintNames(workspaceId: string, values: string[]): Promise<Set<string>> {
    const rows = await this.prisma.sprint.findMany({
      where: {
        project: { workspaceId, deletedAt: null },
        OR: [...new Set(values)].map((v) => ({
          name: { equals: v, mode: 'insensitive' as const },
        })),
      },
      select: { name: true },
    });
    return new Set(rows.map((r) => r.name.toLowerCase()));
  }

  /** Tên các giá trị có thật của một trường JQL trong workspace (cùng nguồn với `fields()` nên sprint bị cắt 100 — chỉ dùng để gợi ý/liệt kê, KHÔNG để kiểm tồn tại; dự án: khoá dự án còn sống). */
  private async catalogNames(workspaceId: string, field: JqlFieldName): Promise<string[]> {
    const names = (rows: { name: string }[]) => [...new Set(rows.map((r) => r.name))];
    switch (field) {
      case 'type':
        return names(
          await this.prisma.issueType.findMany({
            where: { workspaceId },
            orderBy: { hierarchyLevel: 'asc' },
            select: { name: true },
          }),
        );
      case 'status':
        return names(
          await this.prisma.status.findMany({
            where: { workflow: { workspaceId } },
            orderBy: { order: 'asc' },
            select: { name: true },
          }),
        );
      case 'priority':
        return names(
          await this.prisma.priority.findMany({
            where: { workspaceId },
            orderBy: { rank: 'desc' },
            select: { name: true },
          }),
        );
      case 'severity':
        return names(
          await this.prisma.severity.findMany({
            where: { workspaceId },
            orderBy: { rank: 'desc' },
            select: { name: true },
          }),
        );
      case 'resolution':
        return names(
          await this.prisma.resolution.findMany({
            where: { workspaceId },
            orderBy: { rank: 'asc' },
            select: { name: true },
          }),
        );
      case 'sprint':
        return names(
          await this.prisma.sprint.findMany({
            where: { project: { workspaceId, deletedAt: null } },
            orderBy: { sequence: 'desc' },
            select: { name: true },
            take: 100,
          }),
        );
      case 'project':
        return (
          await this.prisma.project.findMany({
            where: { workspaceId, deletedAt: null },
            orderBy: { key: 'asc' },
            select: { key: true },
          })
        ).map((p) => p.key);
      default:
        return [];
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
