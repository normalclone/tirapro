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
    .replace(/[-_/]+/g, ' ')
    .trim();

/** Mọi từ trong `q` (tách khoảng trắng) phải là chuỗi con của chuỗi ghép các `fields` đã chuẩn hoá. Chuỗi tìm rỗng → khớp hết. */
export function matchesQuery(q: string, ...fields: (string | undefined)[]): boolean {
  const terms = normalizeVi(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = normalizeVi(fields.filter(Boolean).join(' '));
  return terms.every((t) => hay.includes(t));
}

/**
 * Lọc lựa chọn của ô chọn có tìm kiếm: chỉ khớp chữ NGƯỜI DÙNG THẤY — nhãn và mã (`hint`). Không khớp `value` (thường là
 * id nội bộ như CUID: số/chữ ngẫu nhiên làm "psl 3" khớp gần hết) và không khớp `hint` của lựa chọn bị vô hiệu
 * (đó là câu giải thích vì sao không chọn được, không phải mã).
 */
export function filterByQuery<T extends { label: string; hint?: string; disabled?: boolean }>(
  options: T[],
  q: string,
): T[] {
  if (!q.trim()) return options;
  return options.filter((o) => matchesQuery(q, o.label, o.disabled ? undefined : o.hint));
}
