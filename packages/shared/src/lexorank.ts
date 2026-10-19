/**
 * LexoRank (fractional indexing, base-36): rank là phần thập phân `0.xxx` viết bằng
 * [0-9a-z], so sánh bằng so sánh chuỗi thông thường. `rankBetween(prev, next)` luôn
 * trả rank r thoả prev < r < next và r không kết thúc bằng '0' (để luôn còn chỗ chèn
 * phía dưới). Hết chỗ thì ném `RankGapError` — nơi gọi phải đánh số lại (rebalance).
 * Chạy được cả ở FE (optimistic) lẫn BE.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = ALPHABET.length;
export const RANK_MAX_LEN = 48;

export class RankGapError extends Error {
  constructor(a: string, b: string) {
    super(`Không có rank giữa "${a}" và "${b}" — cần đánh số lại`);
    this.name = 'RankGapError';
  }
}

const val = (c: string | undefined): number => (c === undefined ? 0 : ALPHABET.indexOf(c));

/** midpoint(a, b): a < b, a và b không kết thúc bằng '0' (a rỗng = 0, b rỗng = 1). */
function midpoint(a: string, b: string): string {
  if (b !== '' && a >= b) throw new RankGapError(a, b);
  const cbAt = (i: number): number => (b === '' ? BASE : i < b.length ? val(b[i]) : BASE);
  let i = 0;
  // Bỏ tiền tố chung (a coi như được đệm '0' bên phải)
  while (i < a.length || i < b.length) {
    if (val(a[i]) !== cbAt(i)) break;
    i++;
  }
  const prefix = a.padEnd(i, '0').slice(0, i);
  const ca = val(a[i]);
  const cb = cbAt(i);
  if (cb - ca > 1) {
    // Thêm vào cuối (b rỗng) mà a còn ký tự: tăng đúng 1 để rank không dài nhanh khi thêm tuần tự
    const mid = b === '' && i < a.length ? ca + 1 : Math.floor((ca + cb) / 2);
    return prefix + ALPHABET[mid];
  }
  // Sát nhau: giữ ca, đi tiếp giữa phần đuôi của a và "vô cùng"
  const rest = midpoint(a.slice(i + 1), '');
  return prefix + ALPHABET[ca] + rest;
}

export function rankBetween(prev: string | null, next: string | null): string {
  const a = (prev ?? '').replace(/0+$/, '');
  const b = (next ?? '').replace(/0+$/, '');
  if (next !== null && next !== '' && b === '') throw new RankGapError(a, next); // next = "0…": không có gì nhỏ hơn
  const r = midpoint(a, b);
  if (r === '' || r.endsWith('0')) throw new RankGapError(a, b);
  if (r.length > RANK_MAX_LEN) throw new RankGapError(a, b);
  return r;
}

/** Sinh dãy n rank cách đều, tăng dần (dùng khi seed và khi rebalance). */
export function initialRanks(n: number): string[] {
  // Chia đều đoạn (0,1): rank k = (k+1)/(n+1) biểu diễn base-36. Đủ chữ số để mọi rank khác nhau.
  const digits = Math.max(2, Math.ceil(Math.log(n + 1) / Math.log(BASE)) + 1);
  const out: string[] = [];
  for (let k = 0; k < n; k++) {
    // Số nguyên k' = floor((k+1) * BASE^digits / (n+1)) -> viết base-36 đủ `digits` chữ số
    let x = Math.floor(((k + 1) * BASE ** digits) / (n + 1));
    let s = '';
    for (let d = 0; d < digits; d++) {
      s = ALPHABET[x % BASE]! + s;
      x = Math.floor(x / BASE);
    }
    out.push(s.replace(/0+$/, '') || '1');
  }
  return out;
}
