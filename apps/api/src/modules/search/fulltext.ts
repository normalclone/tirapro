import { Logger } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { escapeLike } from '../../common/like';
import {
  normalizeVi,
  searchTokens,
  truncateCodePoints,
  VI_TRANSLATE_FROM,
  VI_TRANSLATE_TO,
} from './vi-text';

/** Số issue tối đa trả về từ một lần tìm full-text (xếp theo rank). */
const FULLTEXT_LIMIT = 200;
/** Độ dài tối đa của chuỗi tìm (tính theo ký tự/code point, không phải đơn vị UTF-16). */
const MAX_QUERY_LENGTH = 200;
/** Khoảng tối thiểu giữa hai lần log cảnh báo "đường phòng thủ 42601 chạy lại" (tránh ngập log). */
const SYNTAX_WARN_INTERVAL_MS = 10 * 60 * 1000;

export interface FulltextQuery {
  /** Chuỗi gõ đã chuẩn hoá khoảng trắng (giữ dấu, giữ hoa/thường). */
  q: string;
  /** Pattern cho ILIKE (ký tự đại diện đã escape) — khớp một phần từ, dựa vào index trigram. */
  like: string;
  /** Chuỗi gõ đã bỏ dấu + hạ chữ thường (so với `lower(immutable_unaccent(col))`). */
  qn: string;
  /** Pattern LIKE của `qn` (đã escape). */
  likeNorm: string;
  /** `tok:* & tok:*` cho `to_tsquery('simple', immutable_unaccent(…))`; '' nếu không có token. */
  tsquery: string;
}

/** Chuẩn hoá chuỗi tìm kiếm của người dùng; null nếu rỗng. Mọi giá trị đều được bind, không nối vào SQL. */
export function buildFulltextQuery(raw: string): FulltextQuery | null {
  const q = truncateCodePoints(
    raw
      .replace(/\u0000/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
    MAX_QUERY_LENGTH,
  ).trim();
  if (!q) return null;
  const qn = normalizeVi(q);
  return {
    q,
    like: `%${escapeLike(q)}%`,
    qn,
    likeNorm: `%${escapeLike(qn)}%`,
    tsquery: searchTokens(q)
      .map((t) => `${t}:*`)
      .join(' & '),
  };
}

/**
 * Lỗi Postgres 42703 (undefined_column — chưa có cột `searchVector`) hoặc 42883 (undefined_function —
 * chưa có `immutable_unaccent`): cả hai đều do chưa chạy `db:raw`.
 */
export function isMissingSearchObject(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
  const codes = ['42703', '42883'];
  if (codes.includes(e.code as string) || codes.includes(e.meta?.code as string)) return true;
  return typeof e.message === 'string' && codes.some((c) => (e.message as string).includes(c));
}

/** Lỗi cú pháp (42601) — phòng thủ khi `to_tsquery` vẫn nhận chuỗi lạ mà bước lọc token bỏ sót. */
function isSyntaxError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
  if (e.code === '42601' || e.meta?.code === '42601') return true;
  return typeof e.message === 'string' && e.message.includes('42601');
}

/** Client của một giao dịch tương tác (đã `SET LOCAL statement_timeout`): truy vấn chạy trong đó + SAVEPOINT cho đường lui. */
export type TxClient = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

export interface SearchOptions {
  projectId?: string;
  /** Thu hẹp theo nhiều dự án (giao với `projectId` nếu truyền cả hai do người gọi tự xử lý). Mảng rỗng => không có kết quả. */
  projectIds?: string[];
  limit?: number;
}

/**
 * Điều kiện khớp văn bản của một issue (alias `i`; CTE `q(tsq, qn)`): token full-text tiền tố HOẶC chuỗi con
 * đã bỏ dấu ở summary/description (dùng index trigram theo biểu thức), mã `key` (ILIKE thô — mã không bỏ dấu)
 * HOẶC gõ sai nhẹ so với summary (`<%` = word_similarity ≥ ngưỡng, dùng chỉ mục trigram). Description không
 * quét fuzzy (dài, tốn kém, nhiều nhiễu); từ ≤ 4 ký tự gõ sai không được tha.
 */
function buildTextMatchSql(built: FulltextQuery): Prisma.Sql {
  return Prisma.sql`(i."searchVector" @@ q.tsq
    OR lower(immutable_unaccent(i."summary")) LIKE ${built.likeNorm}
    OR lower(immutable_unaccent(i."description")) LIKE ${built.likeNorm}
    OR i."key" ILIKE ${built.like}
    OR q.qn <% lower(immutable_unaccent(i."summary")))`;
}

/** Phạm vi project cho câu SQL: `projectIds` > `projectId` > không giới hạn; mảng rỗng => `[]`. */
function resolveProjectScope(opts: SearchOptions): string[] | null {
  return opts.projectIds ?? (opts.projectId ? [opts.projectId] : null);
}

/**
 * Tìm full-text trên Issue: `tsvector` (searchVector, 'simple', đã bỏ dấu) với tiền tố từng từ, cộng chuỗi con
 * bỏ dấu ở summary/description, mã `key`, và typo nhẹ (trigram) ở summary. Chỉ xét issue chưa xoá của dự án chưa xoá,
 * trong phạm vi project nếu có. Trả id xếp theo rank giảm dần (tối đa `limit`) — dùng để XẾP HẠNG;
 * tính đúng đắn của kết quả JQL không phụ thuộc danh sách này (xem `jql-compiler`).
 */
export class FulltextSearcher {
  private warned = false;
  private lastSyntaxWarnAt = 0;

  constructor(
    private readonly prisma: Pick<PrismaClient, '$queryRaw'>,
    private readonly logger: Pick<Logger, 'warn'> = new Logger(FulltextSearcher.name),
  ) {}

  /**
   * `{ ids }` (có thể rỗng). Khi chưa chạy `db:raw` (thiếu `searchVector`/`immutable_unaccent`) rơi về câu
   * `translate()`+LIKE (log cảnh báo đúng một lần) nên không còn trả `null`; kiểu giữ `| null` cho tương thích
   * (người gọi vẫn có nhánh `contains` phòng thủ). Lỗi khác được ném lại.
   */
  async search(
    workspaceId: string,
    raw: string,
    opts: SearchOptions = {},
    tx?: TxClient,
  ): Promise<{ ids: string[] } | null> {
    const db: Pick<PrismaClient, '$queryRaw'> = tx ?? this.prisma;
    const built = buildFulltextQuery(raw);
    if (!built) return { ids: [] };
    const limit = Math.min(Math.max(opts.limit ?? FULLTEXT_LIMIT, 1), FULLTEXT_LIMIT);
    const scope = resolveProjectScope(opts);
    if (scope && scope.length === 0) return { ids: [] };
    const projectFilter = scope
      ? Prisma.sql`AND i."projectId" = ANY(${scope}::text[])`
      : Prisma.empty;
    try {
      try {
        return await this.attempt(tx, () =>
          this.ranked(db, built, workspaceId, projectFilter, limit),
        );
      } catch (err) {
        // Phòng thủ: tsquery vẫn bị từ chối (42601) ⇒ chạy lại chỉ bằng nhánh ILIKE/trigram thay vì 500.
        if (!isSyntaxError(err) || !built.tsquery) throw err;
        const now = Date.now();
        if (now - this.lastSyntaxWarnAt >= SYNTAX_WARN_INTERVAL_MS) {
          this.lastSyntaxWarnAt = now;
          this.logger.warn(
            `to_tsquery bị từ chối (42601) — chạy lại bằng nhánh ILIKE/trigram. Có ký tự lạ lọt qua searchTokens; hãy bổ sung bộ lọc nếu lặp lại (nội dung tìm không được ghi vào log).`,
          );
        }
        return await this.attempt(tx, () =>
          this.ranked(db, { ...built, tsquery: '' }, workspaceId, projectFilter, limit),
        );
      }
    } catch (err) {
      if (!isMissingSearchObject(err)) throw err;
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          'Issue.searchVector / immutable_unaccent chưa có — tìm kiếm văn bản tạm dùng translate()+LIKE (bỏ dấu nhưng không tiền tố/gõ sai/xếp hạng, chậm hơn). Hãy chạy `pnpm --filter @tirapro/api db:raw` để bật full-text.',
        );
      }
      // Không cần extension/cột sinh: translate() là hàm có sẵn. Lỗi lạ ở đây được ném lại (không nuốt).
      const rows = await db.$queryRaw<{ id: string }[]>`
        SELECT i."id" FROM "Issue" i
        JOIN "Project" p ON p."id" = i."projectId"
        WHERE i."workspaceId" = ${workspaceId}
          AND i."deletedAt" IS NULL
          AND p."deletedAt" IS NULL
          ${projectFilter}
          AND (lower(translate(i."summary", ${VI_TRANSLATE_FROM}, ${VI_TRANSLATE_TO})) LIKE ${built.likeNorm}
            OR lower(translate(coalesce(i."description", ''), ${VI_TRANSLATE_FROM}, ${VI_TRANSLATE_TO})) LIKE ${built.likeNorm}
            OR i."key" ILIKE ${built.like})
        ORDER BY i."updatedAt" DESC
        LIMIT ${limit}`;
      return { ids: rows.map((r) => r.id) };
    }
  }

  /**
   * Trong GIAO DỊCH (`tx`): một câu lỗi làm cả giao dịch "aborted" nên các đường lui (42601, thiếu searchVector) sẽ hỏng
   * theo. Bọc từng lần thử trong SAVEPOINT để lỗi chỉ hoàn lại chính nó rồi ném lên (đường lui chạy tiếp được).
   * Ngoài giao dịch: chạy thẳng như cũ.
   */
  private async attempt<T>(tx: TxClient | undefined, run: () => Promise<T>): Promise<T> {
    if (!tx) return run();
    await tx.$executeRaw`SAVEPOINT ft_attempt`;
    try {
      const out = await run();
      await tx.$executeRaw`RELEASE SAVEPOINT ft_attempt`;
      return out;
    } catch (e) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT ft_attempt`;
      throw e;
    }
  }

  private async ranked(
    db: Pick<PrismaClient, '$queryRaw'>,
    built: FulltextQuery,
    workspaceId: string,
    projectFilter: Prisma.Sql,
    limit: number,
  ): Promise<{ ids: string[] }> {
    const rows = await db.$queryRaw<{ id: string; rank: number }[]>`
        WITH q AS (
          SELECT to_tsquery('simple', immutable_unaccent(${built.tsquery})) AS tsq, ${built.qn}::text AS qn
        )
        SELECT i."id",
          ( ts_rank(i."searchVector", q.tsq)
            + CASE WHEN lower(immutable_unaccent(i."summary")) LIKE ${built.likeNorm} THEN 0.5 ELSE 0 END
            + CASE WHEN i."key" ILIKE ${built.like} THEN 0.8 ELSE 0 END
            + word_similarity(q.qn, lower(immutable_unaccent(i."summary"))) * 0.3 ) AS rank
        FROM "Issue" i
        JOIN "Project" p ON p."id" = i."projectId"
        CROSS JOIN q
        WHERE i."workspaceId" = ${workspaceId}
          AND i."deletedAt" IS NULL
          AND p."deletedAt" IS NULL
          ${projectFilter}
          AND ${buildTextMatchSql(built)}
        ORDER BY rank DESC, i."updatedAt" DESC
        LIMIT ${limit}`;
    return { ids: rows.map((r) => r.id) };
  }
}
