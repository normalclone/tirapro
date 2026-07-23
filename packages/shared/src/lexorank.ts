/**
 * LexoRank tối giản: rank là chuỗi base-36 ([0-9a-z]). Sinh rank nằm giữa hai
 * rank để chèn item mà không phải đánh số lại. Dùng cho ordering board/backlog,
 * chạy được cả ở FE (optimistic) lẫn BE.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = ALPHABET.length;
const MIN_CHAR = ALPHABET[0]; // '0'
const MAX_CHAR = ALPHABET[BASE - 1]; // 'z'

function charToVal(c: string): number {
  const v = ALPHABET.indexOf(c);
  return v < 0 ? 0 : v;
}

/** Sinh rank nằm giữa `prev` và `next` (một trong hai có thể null). */
export function rankBetween(prev: string | null, next: string | null): string {
  const a = prev && prev.length ? prev : '';
  const b = next && next.length ? next : '';

  if (!a && !b) return 'n'; // điểm giữa khoảng trống
  if (!a) return rankBefore(b);
  if (!b) return rankAfter(a);
  if (a >= b) {
    // dữ liệu không nhất quán: nối thêm để vẫn lớn hơn a
    return a + 'n';
  }
  return midpoint(a, b);
}

function rankBefore(next: string): string {
  // tìm rank < next
  const first = next[0] ?? MAX_CHAR;
  if (charToVal(first) > 0) {
    return ALPHABET[Math.floor(charToVal(first) / 2)];
  }
  // first là '0' -> đi sâu hơn
  return MIN_CHAR + rankBefore(next.slice(1) || MAX_CHAR);
}

function rankAfter(prev: string): string {
  const first = prev[0] ?? MIN_CHAR;
  const v = charToVal(first);
  if (v < BASE - 1) {
    return ALPHABET[v + Math.max(1, Math.floor((BASE - v) / 2))];
  }
  // first là 'z' -> giữ và nối thêm
  return MAX_CHAR + rankAfter(prev.slice(1));
}

function midpoint(a: string, b: string): string {
  let i = 0;
  let result = '';
  for (;;) {
    const ca = a[i] ?? MIN_CHAR;
    const cb = b[i] ?? MAX_CHAR;
    if (ca === cb) {
      result += ca;
      i++;
      continue;
    }
    const va = charToVal(ca);
    const vb = charToVal(cb);
    if (vb - va > 1) {
      const mid = Math.floor((va + vb) / 2);
      return result + ALPHABET[mid];
    }
    // sát nhau: giữ ca rồi tìm rank sau phần đuôi của a
    result += ca;
    return result + rankAfter(a.slice(i + 1));
  }
}

/** Sinh dãy n rank cách đều cho seed/khởi tạo cột. */
export function initialRanks(n: number): string[] {
  const ranks: string[] = [];
  let prev: string | null = null;
  for (let k = 0; k < n; k++) {
    const r = rankBetween(prev, null);
    ranks.push(r);
    prev = r;
  }
  return ranks;
}
