/**
 * Escape `\`, `%`, `_` cho giá trị đưa vào `contains`/`startsWith`/`endsWith` của Prisma — Prisma KHÔNG tự escape
 * (ghép thẳng vào LIKE; `\` là ký tự escape mặc định của Postgres), nên `q="_"` sẽ khớp mọi dòng nếu bỏ sót.
 */
export function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Bộ lọc chuỗi con không phân biệt hoa thường, đã escape ký tự đại diện. */
export function insensitiveContains(v: string): { contains: string; mode: 'insensitive' } {
  return { contains: escapeLike(v), mode: 'insensitive' };
}
