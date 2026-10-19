/** Chuẩn hoá để so khớp mờ: bỏ dấu tiếng Việt, không phân biệt hoa thường, cắt khoảng trắng đầu/cuối. */
export function foldForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .trim();
}

/** Khoảng cách Levenshtein (hai hàng). */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * Giá trị gần `input` nhất trong `options` ("ý bạn là …"), so khớp bỏ dấu + không phân biệt hoa thường.
 * Ngưỡng `max(1, floor(len/3))`; quá xa → null; hoà → phần tử đứng trước.
 */
export function closestMatch(input: string, options: readonly string[]): string | null {
  const needle = foldForMatch(input);
  const limit = Math.max(1, Math.floor(needle.length / 3));
  let best: string | null = null;
  let bestDist = Infinity;
  for (const opt of options) {
    const d = editDistance(needle, foldForMatch(opt));
    if (d <= limit && d < bestDist) {
      best = opt;
      bestDist = d;
    }
  }
  return best;
}
