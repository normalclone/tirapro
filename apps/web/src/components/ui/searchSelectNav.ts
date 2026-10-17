import { matchesQuery, normalizeVi } from '@/lib/text';

export interface NavItem {
  disabled?: boolean;
  label: string;
}

const PAGE = 8;
const NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp']);

/** Số mục tối đa để ô chọn còn tự ẩn ô tìm (nhiều hơn thì hiện). */
const SEARCH_THRESHOLD = 6;

/**
 * Chỉ số mục kế tiếp theo phím (ArrowDown/ArrowUp vòng tròn, Home, End, PageDown/PageUp ±8 kẹp ở hai đầu), bỏ qua mục
 * disabled. `current = -1` nghĩa là chưa trỏ mục nào. Trả -1 nếu không có mục bật nào; `null` nếu phím không điều hướng.
 */
export function nextActiveIndex(
  items: readonly NavItem[],
  current: number,
  key: string,
): number | null {
  if (!NAV_KEYS.has(key)) return null;
  const enabled: number[] = [];
  items.forEach((it, i) => {
    if (!it.disabled) enabled.push(i);
  });
  if (enabled.length === 0) return -1;
  const first = enabled[0] as number;
  const last = enabled[enabled.length - 1] as number;
  const base = Math.max(current, 0);
  switch (key) {
    case 'Home':
      return first;
    case 'End':
      return last;
    case 'ArrowDown':
      return enabled.find((i) => i > current) ?? first;
    case 'ArrowUp':
      return [...enabled].reverse().find((i) => i < current) ?? last;
    case 'PageDown': {
      const target = Math.min(items.length - 1, base + PAGE);
      return [...enabled].reverse().find((i) => i <= target) ?? first;
    }
    default: {
      const target = Math.max(0, base - PAGE);
      return enabled.find((i) => i >= target) ?? last;
    }
  }
}

/**
 * Nhảy theo chữ cái khi KHÔNG có ô tìm: mục bật đầu tiên SAU `from` có nhãn (bỏ dấu, không phân biệt hoa thường)
 * bắt đầu bằng `typed`; vòng lại từ đầu (kể cả chính `from` ở lượt cuối); -1 nếu không có.
 */
export function typeaheadIndex(items: readonly NavItem[], typed: string, from: number): number {
  const needle = normalizeVi(typed);
  const n = items.length;
  if (!needle || n === 0) return -1;
  for (let k = 1; k <= n; k++) {
    const i = (((from + k) % n) + n) % n;
    const it = items[i] as NavItem;
    if (!it.disabled && normalizeVi(it.label).startsWith(needle)) return i;
  }
  return -1;
}

/** Có hiện ô tìm không: luôn hiện khi có tìm phía server; ngược lại chỉ khi > 6 mục. */
export function shouldShowSearch(optionCount: number, serverSearch: boolean): boolean {
  return serverSearch || optionCount > SEARCH_THRESHOLD;
}

/**
 * Lọc tại chỗ theo nhãn, mã (`hint`) và mô tả (`description`). Mục disabled chỉ khớp theo nhãn: `hint`/`description` của nó
 * là câu giải thích vì sao không chọn được, không phải thứ người dùng tìm. Chuỗi tìm rỗng → trả nguyên mảng.
 */
export function filterOptions<
  T extends { label: string; hint?: string; description?: string; disabled?: boolean },
>(options: T[], q: string): T[] {
  if (!q.trim()) return options;
  return options.filter((o) =>
    o.disabled ? matchesQuery(q, o.label) : matchesQuery(q, o.label, o.hint, o.description),
  );
}
