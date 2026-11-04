import { Injectable } from '@nestjs/common';
import { JqlParseError, parseJql, type JqlQueryAst } from '@tirapro/shared';
import type { CursorPageInfo, PersonalIssueDto, WorkspaceRefDto } from '@tirapro/types';
import { requestContext, getStore } from '../../common/context/request-context';
import { PageResult } from '../../common/dto/page-result';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import { mapLimit } from '../../common/map-limit';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { SearchService } from '../search/search.service';
import { buildComparator } from './me-search-order';

export interface MeSearchOptions {
  jql?: string;
  /** Con trỏ đục (base64 JSON `{ wsCursors }`) lấy từ `pageInfo.endCursor` của trang trước. */
  cursor?: string;
  limit: number;
}

const MAX_LIMIT = 200;
/** Số workspace tìm đồng thời (người dùng thường dưới 10 workspace). */
const WORKSPACE_CONCURRENCY = 4;

/** Bộ đệm một trang của một workspace + vị trí đã lấy ra gộp. */
interface Buffer {
  ws: WorkspaceRefDto;
  /** Con trỏ đầu vào của trang này (null = từ đầu). */
  cursor: string | null;
  items: PersonalIssueDto[];
  pos: number;
  hasMore: boolean;
  /** id việc cuối cùng đã đưa vào kết quả ở lần gộp này. */
  lastEmitted: string | null;
}

function decodeCursor(raw: string | undefined): Record<string, string | null> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    const wsCursors = (parsed as { wsCursors?: unknown } | null)?.wsCursors;
    if (wsCursors && typeof wsCursors === 'object' && !Array.isArray(wsCursors)) {
      const out: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(wsCursors as Record<string, unknown>)) {
        if (v !== null && typeof v !== 'string') throw new Error('bad cursor value');
        out[k] = v;
      }
      return out;
    }
  } catch {
    /* rơi xuống lỗi chung */
  }
  throw new BusinessRuleException('Con trỏ phân trang không hợp lệ — hãy tải lại từ trang đầu');
}

const encodeCursor = (wsCursors: Record<string, string | null>): string =>
  Buffer.from(JSON.stringify({ wsCursors })).toString('base64');

/**
 * Tìm việc XUYÊN workspace của một người dùng (`GET /me/search`). KHÔNG viết lại luật hiển thị: lặp qua workspace người đó
 * là thành viên (chưa xoá) và gọi lại `SearchService.search(workspaceId, userId, …)` cho từng workspace — dự án riêng tư
 * không là thành viên, việc đã xoá, dự án đã xoá… do chính đường tìm kiếm workspace lọc. Rồi gộp theo thứ tự ORDER BY của JQL.
 */
@Injectable()
export class MeSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly searchService: SearchService,
  ) {}

  /** Workspace người dùng là thành viên, trừ workspace đã xoá (schema chưa có cờ "lưu trữ" ở cấp workspace). */
  async myWorkspaces(userId: string): Promise<WorkspaceRefDto[]> {
    const rows = await this.prisma.workspaceMembership.findMany({
      where: { userId, workspace: { deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      select: { workspace: { select: { id: true, name: true } } },
    });
    return rows.map((r) => ({ id: r.workspace.id, name: r.workspace.name }));
  }

  async search(userId: string, opts: MeSearchOptions): Promise<PageResult<PersonalIssueDto>> {
    const limit = Math.min(Math.max(Math.trunc(opts.limit) || 1, 1), MAX_LIMIT);
    // Phân tích JQL MỘT lần trước vòng lặp: lỗi cú pháp là 422 ngay (không lẫn với "giá trị không có ở workspace này").
    const ast = this.parse(opts.jql);
    const prevCursors = decodeCursor(opts.cursor);

    const workspaces = await this.eligibleWorkspaces(userId, await this.myWorkspaces(userId));
    if (!workspaces.length) return this.page([], limit, {}, false);

    const settled = await mapLimit(workspaces, WORKSPACE_CONCURRENCY, (ws) =>
      this.fetchWorkspace(
        userId,
        ws,
        prevCursors[ws.id] ?? null,
        opts.jql,
        limit,
        workspaces.length > 1,
      ),
    );
    // Giá trị không có ở MỘT workspace → workspace đó 0 việc. Không có ở MỌI workspace → lỗi 422 như tìm kiếm workspace.
    const failures = settled.filter((s): s is { error: BusinessRuleException } => 'error' in s);
    if (failures.length === settled.length) throw failures[0]!.error;
    const buffers = await this.decorate(settled.filter((s): s is Buffer => !('error' in s)));

    const compare = buildComparator(ast.orderBy);
    const out: PersonalIssueDto[] = [];
    while (out.length < limit) {
      let best: Buffer | undefined;
      for (const b of buffers) {
        const head = b.items[b.pos];
        if (head && (!best || compare(head, best.items[best.pos]!) < 0)) best = b;
      }
      if (!best) break;
      const item = best.items[best.pos++]!;
      best.lastEmitted = item.id;
      out.push(item);
    }

    // Mỗi workspace chỉ nhả một TIỀN TỐ của trang nó đã lấy (mỗi bộ đệm có `limit` việc nên không bao giờ cạn trước khi đủ
    // trang) → con trỏ mới = id việc cuối đã nhả; việc đã lấy mà chưa nhả sẽ được lấy lại ở trang sau (không trùng, không sót).
    const next: Record<string, string | null> = {};
    for (const ws of workspaces) next[ws.id] = prevCursors[ws.id] ?? null;
    for (const b of buffers) next[b.ws.id] = b.lastEmitted ?? b.cursor;
    const hasNext = buffers.some((b) => b.pos < b.items.length || b.hasMore);
    return this.page(out, limit, next, hasNext);
  }

  private page(
    data: PersonalIssueDto[],
    limit: number,
    wsCursors: Record<string, string | null>,
    hasNextPage: boolean,
  ): PageResult<PersonalIssueDto> {
    const pageInfo: CursorPageInfo = {
      hasNextPage,
      endCursor: data.length ? encodeCursor(wsCursors) : null,
      limit,
    };
    return new PageResult(data, pageInfo);
  }

  private parse(jql: string | undefined): JqlQueryAst {
    try {
      return parseJql(jql ?? '');
    } catch (e) {
      if (e instanceof JqlParseError)
        throw new BusinessRuleException(`JQL không hợp lệ: ${e.message} (vị trí ${e.position})`);
      throw e;
    }
  }

  /**
   * `GET /search` đòi `project:view` cấp workspace (PermissionsGuard) — workspace mà vai trò không có thì tìm kiếm workspace
   * trả 403, nên ở đây cũng bỏ qua (không lách guard bằng đường `/me`). Admin hệ thống được guard cho qua.
   */
  private async eligibleWorkspaces(
    userId: string,
    all: WorkspaceRefDto[],
  ): Promise<WorkspaceRefDto[]> {
    const perms = await Promise.all(
      all.map((w) => this.rbac.getEffectivePermissions(userId, w.id)),
    );
    const allowed = all.filter(
      (_, i) => perms[i]!.has('project:view') || perms[i]!.has('project:view:own'),
    );
    if (allowed.length === all.length) return all;
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSystemAdmin: true },
    });
    return u?.isSystemAdmin ? all : allowed;
  }

  /** Một trang của một workspace, chạy trong ngữ cảnh request mang đúng `workspaceId` (như một request vào workspace đó). */
  private async fetchWorkspace(
    userId: string,
    ws: WorkspaceRefDto,
    cursor: string | null,
    jql: string | undefined,
    limit: number,
    multi: boolean,
  ): Promise<Buffer | { error: BusinessRuleException }> {
    const store = getStore();
    try {
      const res = await requestContext.run(
        { requestId: store?.requestId ?? 'me-search', userId, workspaceId: ws.id },
        () =>
          this.searchService.search(ws.id, userId, {
            mode: 'jql',
            jql,
            cursor: cursor ?? undefined,
            limit,
            checkValues: true,
            scope: 'personal',
            // Nhiều workspace: bỏ thứ tự theo độ liên quan (không so được giữa workspace) → xếp theo updatedAt.
            ignoreRankHint: multi,
          }),
      );
      const info = res.pageInfo as CursorPageInfo;
      return {
        ws,
        cursor,
        items: res.data as unknown as PersonalIssueDto[],
        pos: 0,
        hasMore: info.hasNextPage,
        lastEmitted: null,
      };
    } catch (e) {
      if (e instanceof BusinessRuleException) return { error: e };
      throw e;
    }
  }

  /** Gắn `workspace` và `projectKey` (một truy vấn tên khoá dự án cho cả trang). */
  private async decorate(buffers: Buffer[]): Promise<Buffer[]> {
    const projectIds = [...new Set(buffers.flatMap((b) => b.items.map((i) => i.projectId)))];
    const keys = new Map<string, string>();
    if (projectIds.length) {
      const rows = await this.prisma.project.findMany({
        where: { id: { in: projectIds }, deletedAt: null },
        select: { id: true, key: true },
      });
      for (const r of rows) keys.set(r.id, r.key);
    }
    for (const b of buffers) {
      b.items = b.items.map((i) => ({
        ...i,
        workspace: b.ws,
        projectKey: keys.get(i.projectId) ?? i.key.split('-')[0] ?? '',
      }));
    }
    return buffers;
  }
}
