import { Logger } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';

/** Số issue tối đa trả về từ một lần tìm full-text (xếp theo rank). */
export const FULLTEXT_LIMIT = 200;
const MAX_QUERY_LENGTH = 200;

export interface FulltextQuery {
  /** Chuỗi gửi cho `websearch_to_tsquery` (đã chuẩn hoá khoảng trắng). */
  q: string;
  /** Pattern cho ILIKE (ký tự đại diện đã escape) — khớp một phần từ, dựa vào index trigram. */
  like: string;
}

/** Chuẩn hoá chuỗi tìm kiếm của người dùng; null nếu rỗng. Mọi giá trị đều được bind, không nối vào SQL. */
export function buildFulltextQuery(raw: string): FulltextQuery | null {
  const q = raw
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
    .trim();
  if (!q) return null;
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  return { q, like: `%${escaped}%` };
}

/** Lỗi Postgres 42703 (undefined_column) — cột `searchVector` chưa có vì chưa chạy `db:raw`. */
export function isMissingColumnError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
  if (e.code === '42703' || e.meta?.code === '42703') return true;
  return typeof e.message === 'string' && e.message.includes('42703');
}

interface SearchOptions {
  projectId?: string;
  limit?: number;
}

/**
 * Tìm full-text trên Issue bằng `tsvector` (searchVector, config 'simple') cộng ILIKE trên summary
 * (trigram) để khớp một phần từ. Trả id xếp theo rank giảm dần.
 */
export class FulltextSearcher {
  private warned = false;

  constructor(
    private readonly prisma: Pick<PrismaClient, '$queryRaw'>,
    private readonly logger: Pick<Logger, 'warn'> = new Logger(FulltextSearcher.name),
  ) {}

  /**
   * `{ ids }` (có thể rỗng), hoặc `null` khi cột `searchVector` chưa tồn tại — khi đó người gọi
   * phải rơi về `contains` (đã log cảnh báo đúng một lần). Lỗi khác được ném lại.
   */
  async search(
    workspaceId: string,
    raw: string,
    opts: SearchOptions = {},
  ): Promise<{ ids: string[] } | null> {
    const built = buildFulltextQuery(raw);
    if (!built) return { ids: [] };
    const limit = Math.min(Math.max(opts.limit ?? FULLTEXT_LIMIT, 1), FULLTEXT_LIMIT);
    const projectFilter = opts.projectId
      ? Prisma.sql`AND i."projectId" = ${opts.projectId}`
      : Prisma.empty;
    try {
      const rows = await this.prisma.$queryRaw<{ id: string; rank: number }[]>`
        SELECT i."id", ts_rank(i."searchVector", q) AS rank
        FROM "Issue" i, websearch_to_tsquery('simple', ${built.q}) q
        WHERE i."workspaceId" = ${workspaceId}
          AND i."deletedAt" IS NULL
          ${projectFilter}
          AND (i."searchVector" @@ q OR i."summary" ILIKE ${built.like})
        ORDER BY rank DESC, i."updatedAt" DESC
        LIMIT ${limit}`;
      return { ids: rows.map((r) => r.id) };
    } catch (err) {
      if (!isMissingColumnError(err)) throw err;
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          'Issue.searchVector chưa có — tìm kiếm văn bản tạm dùng "contains" (chậm hơn). Hãy chạy `pnpm --filter @tirapro/api db:raw` để bật full-text.',
        );
      }
      return null;
    }
  }
}
