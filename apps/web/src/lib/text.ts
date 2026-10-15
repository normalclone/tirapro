/**
 * Chuẩn hoá để so khớp tìm kiếm: hạ chữ thường TRƯỚC khi bỏ dấu (để `Đ` hoa thành `d`), bỏ dấu tiếng Việt,
 * và coi `-`, `_`, `/` như khoảng trắng (gõ "psl 3" khớp `PSL-TASK-3`).
 * `titleTokens.normalize` giữ bản riêng: token `^10/8` cần giữ dấu `/`.
 */
export const normalizeVi = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/[-_/]+/g, ' ');

/** Mọi từ trong `q` (tách khoảng trắng) phải là chuỗi con của chuỗi ghép các `fields` đã chuẩn hoá. Chuỗi tìm rỗng → khớp hết. */
export function matchesQuery(q: string, ...fields: (string | undefined)[]): boolean {
  const terms = normalizeVi(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = normalizeVi(fields.filter(Boolean).join(' '));
  return terms.every((t) => hay.includes(t));
}
