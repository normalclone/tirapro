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
import { TRIAGE_VISIBLE } from '../../common/triage-visibility';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ProjectAccessService } from '../rbac/project-access.service';
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
  /** Ẩn việc chưa duyệt (PENDING/SNOOZED/DECLINED) — dùng cho board có `filterJql` để khớp board không lọc. */
  excludeUntriaged?: boolean;
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
  component: 'thành phần',
  fixVersion: 'phiên bản sửa',
  affectedVersion: 'phiên bản bị ảnh hưởng',
};
/** Trường kiểm tồn tại theo tên (không so với danh mục cắt `take`): sprint/thành phần/phiên bản. */
const EXISTENCE_FIELDS: ReadonlySet<JqlFieldName> = new Set([
  'sprint',
  'component',
  'fixVersion',
  'affectedVersion',
]);
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
  components: FieldOption[];
  versions: FieldOption[];
}

@Injectable()
export class SearchService {
  private readonly fulltext: FulltextSearcher;

  constructor(
    private readonly issues: IssuesService,
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {
    this.fulltext = new FulltextSearcher(prisma);
  }

  /**
   * Id các issue gần giống `text` trong một dự án, xếp theo độ liên quan (bỏ dấu + tiền tố + trigram) — cho gợi ý
   * trùng của form Báo lỗi. Hàm bọc duy nhất quanh `FulltextSearcher`: nếu chữ ký tìm kiếm đổi thì chỉ sửa ở đây.
   * `viewerId` (đường do người dùng điều khiển): dự án riêng tư người đó không thấy → 404 'Dự án' như dự án không tồn tại,
   * không bao giờ trả id việc của dự án ẩn. `viewerId = null` = ngữ cảnh hệ thống (phải nêu rõ).
   */
  async similarIssueIds(
    workspaceId: string,
    projectId: string,
    text: string,
    viewerId: string | null,
    limit = 8,
  ): Promise<string[]> {
    if (viewerId) await this.assertProjectVisibleTo(viewerId, workspaceId, projectId);
    const res = await this.fulltext.search(workspaceId, text, { projectId, limit });
    return res?.ids ?? [];
  }

  /** 404 'Dự án' (như dự án không tồn tại) nếu `viewerId` không thấy dự án riêng tư này. */
  async assertProjectVisibleTo(
    viewerId: string,
    workspaceId: string,
    projectId: string,
  ): Promise<void> {
    await this.access.assertCanSee(viewerId, workspaceId, projectId, 'Dự án');
  }

  /**
   * Danh mục giá trị cho bộ dựng truy vấn trực quan: issue type, status, priority,
   * sprint, label, resolution — phạm vi workspace. Status gom từ mọi workflow; sprint/label
   * gom từ mọi project (khử trùng theo tên vì JQL khớp theo tên). Degrade: rỗng nếu chưa có.
   * `viewerId`: chỉ gom từ dự án người đó thấy được (không lộ tên sprint/nhãn/thành phần/phiên bản của dự án riêng tư).
   */
  async fields(workspaceId: string, userId: string): Promise<FilterFieldsDto> {
    // Chỉ liệt kê sprint/nhãn/thành phần/phiên bản của dự án người hỏi được xem (không lộ dự án riêng tư).
    const visible = await this.access.visibleWhere(userId, workspaceId);
    const inVisibleProject = { project: { workspaceId, deletedAt: null, ...visible } };
    const [
      types,
      statuses,
      priorities,
      severities,
      sprints,
      labels,
      resolutions,
      components,
      versions,
    ] = await Promise.all([
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
        where: inVisibleProject,
        orderBy: { sequence: 'desc' },
        select: { name: true },
        take: 100,
      }),
      this.prisma.label.findMany({
        where: inVisibleProject,
        orderBy: { name: 'asc' },
        select: { name: true, color: true },
        take: 200,
      }),
      this.prisma.resolution.findMany({
        where: { workspaceId },
        orderBy: { rank: 'asc' },
        select: { name: true },
      }),
      this.prisma.component.findMany({
        where: inVisibleProject,
        orderBy: { name: 'asc' },
        select: { name: true },
        take: 200,
      }),
      this.prisma.version.findMany({
        where: inVisibleProject,
        orderBy: { name: 'asc' },
        select: { name: true },
        take: 200,
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
      components: dedupeByName(components),
      versions: dedupeByName(versions),
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
    if (opts.mode === 'text') return this.searchText(workspaceId, opts, currentUserId);

    let where: Prisma.IssueWhereInput = {};
    let orderBy: Prisma.IssueOrderByWithRelationInput[] = [];
    let rankHint: string[] | undefined;

    if (opts.jql && opts.jql.trim()) {
      const ast = this.parse(opts.jql);
      if (opts.checkValues) {
        const [first] = await this.findInvalidValues(workspaceId, currentUserId, ast.where);
        if (first) throw new BusinessRuleException(first.message);
      }
      const fulltext = new Map<string, readonly string[]>();
      const terms = collectFulltextTerms(ast.where);
      const scopeIds = terms.length
        ? await this.fulltextProjectScope(workspaceId, ast.where, opts.projectId, currentUserId)
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
    if (opts.excludeUntriaged) {
      where = Object.keys(where).length ? { AND: [where, TRIAGE_VISIBLE] } : TRIAGE_VISIBLE;
    }
    return this.issues.query(workspaceId, where, orderBy, opts.cursor, opts.limit, currentUserId, {
      rankHint,
    });
  }

  /**
   * Phạm vi project cho truy vấn full-text của JQL: `opts.projectId` ∩ project của điều kiện
   * `project = X` / `IN (…)` trên chuỗi AND thuần, giao với tập dự án người xem thấy. undefined = cả workspace.
   * Chỉ để xếp hạng tốt hơn (không phí top-200 vào dự án ẩn): lọc an toàn thật nằm ở scope của `issues.query`.
   */
  private async fulltextProjectScope(
    workspaceId: string,
    where: JqlNode | null,
    projectId: string | undefined,
    viewerId: string,
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
    return this.intersectVisible(workspaceId, scopeIds, viewerId);
  }

  /** Giao `scopeIds` (undefined = cả workspace) với dự án người xem thấy (null = thấy hết → giữ nguyên). */
  private async intersectVisible(
    workspaceId: string,
    scopeIds: string[] | undefined,
    viewerId: string,
  ): Promise<string[] | undefined> {
    const visible = await this.access.visibleProjectIds(viewerId, workspaceId);
    if (visible === null) return scopeIds;
    return scopeIds ? scopeIds.filter((id) => visible.includes(id)) : visible;
  }

  private async searchText(
    workspaceId: string,
    opts: SearchOptions,
    viewerId: string,
  ): Promise<PageResult<IssueDto>> {
    const q = (opts.q ?? '').trim();
    if (!q)
      return this.issues.query(workspaceId, {}, [], opts.cursor, opts.limit, viewerId, {
        rawIds: [],
      });
    const projectIds = await this.intersectVisible(
      workspaceId,
      opts.projectId ? [opts.projectId] : undefined,
      viewerId,
    );
    const res = await this.fulltext.search(workspaceId, q, {
      projectId: opts.projectId,
      ...(projectIds ? { projectIds } : {}),
    });
    if (res)
      return this.issues.query(workspaceId, {}, [], opts.cursor, opts.limit, viewerId, {
        rawIds: res.ids,
      });

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
    return this.issues.query(workspaceId, where, [], opts.cursor, opts.limit, viewerId);
  }

  /**
   * Kiểm tra JQL cho FE báo lỗi inline: cú pháp (kèm vị trí), rồi giá trị không có trong workspace
   * (kèm "ý bạn là …"). Lỗi giá trị có `valid:false` + `error` (câu đầu tiên) + `suggestions` (mọi giá trị sai).
   */
  async validate(workspaceId: string, userId: string, jql: string): Promise<JqlValidation> {
    let ast;
    try {
      ast = parseJql(jql);
    } catch (e) {
      if (e instanceof JqlParseError)
        return { valid: false, error: e.message, position: e.position };
      throw e;
    }
    const bad = await this.findInvalidValues(workspaceId, userId, ast.where);
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
    userId: string,
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
    // Mọi danh mục/tồn tại chỉ tính trong dự án người hỏi được xem: khoá dự án/sprint/thành phần riêng tư không lộ qua "ý bạn là".
    const visible = await this.access.visibleWhere(userId, workspaceId);

    // Khớp đúng như compiler: so tên KHÔNG phân biệt hoa/thường (không bỏ dấu), nên chỉ khác hoa/thường là hợp lệ.
    const byField = new Map<JqlFieldName, string[]>();
    for (const w of wanted) byField.set(w.field, [...(byField.get(w.field) ?? []), w.value]);
    const catalogs = new Map<JqlFieldName, string[]>();
    const known = new Map<JqlFieldName, Set<string>>();
    for (const [field, values] of byField) {
      if (EXISTENCE_FIELDS.has(field)) {
        // Danh mục bị cắt (take) nên kiểm tồn tại theo tên, không so với danh sách cắt.
        known.set(field, await this.existingNames(workspaceId, field, values, visible));
      } else {
        const names = await this.catalogNames(workspaceId, field, visible);
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
      if (!catalogs.has(field))
        catalogs.set(field, await this.catalogNames(workspaceId, field, visible));
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

  /** Tên (viết thường, không phân biệt hoa/thường) trong số `values` có thật ở dự án người hỏi xem được — truy vấn tồn tại, không cắt. */
  private async existingNames(
    workspaceId: string,
    field: JqlFieldName,
    values: string[],
    visible: Prisma.ProjectWhereInput,
  ): Promise<Set<string>> {
    const OR = [...new Set(values)].map((v) => ({
      name: { equals: v, mode: 'insensitive' as const },
    }));
    const rows =
      field === 'sprint'
        ? await this.prisma.sprint.findMany({
            where: { project: { workspaceId, deletedAt: null, ...visible }, OR },
            select: { name: true },
          })
        : field === 'component'
          ? await this.prisma.component.findMany({
              where: { project: { workspaceId, deletedAt: null, ...visible }, OR },
              select: { name: true },
            })
          : await this.prisma.version.findMany({
              where: { project: { workspaceId, deletedAt: null, ...visible }, OR },
              select: { name: true },
            });
    return new Set(rows.map((r) => r.name.toLowerCase()));
  }

  /** Tên các giá trị có thật của một trường JQL trong workspace (cùng nguồn với `fields()` nên sprint bị cắt 100 — chỉ dùng để gợi ý/liệt kê, KHÔNG để kiểm tồn tại; dự án: khoá dự án còn sống). */
  private async catalogNames(
    workspaceId: string,
    field: JqlFieldName,
    visible: Prisma.ProjectWhereInput,
  ): Promise<string[]> {
    const inVisible = { project: { workspaceId, deletedAt: null, ...visible } };
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
            where: inVisible,
            orderBy: { sequence: 'desc' },
            select: { name: true },
            take: 100,
          }),
        );
      case 'project':
        return (
          await this.prisma.project.findMany({
            where: { workspaceId, deletedAt: null, ...visible },
            orderBy: { key: 'asc' },
            select: { key: true },
          })
        ).map((p) => p.key);
      case 'component':
        return names(
          await this.prisma.component.findMany({
            where: inVisible,
            orderBy: { name: 'asc' },
            select: { name: true },
            take: 100,
          }),
        );
      case 'fixVersion':
      case 'affectedVersion':
        return names(
          await this.prisma.version.findMany({
            where: inVisible,
            orderBy: { name: 'asc' },
            select: { name: true },
            take: 100,
          }),
        );
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
