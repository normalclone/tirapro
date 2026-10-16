/** So sánh hai văn bản theo DÒNG (LCS động) — đủ cho Markdown, không cần thư viện diff. */

export type DiffRow = { type: 'same' | 'add' | 'del'; text: string };

/** `n * m` dòng tối đa được so sánh (≈ 2000 × 2000); vượt thì trả `null` để giao diện chỉ cho xem nội dung. */
const MAX_CELLS = 4_000_000;

/** `''` là KHÔNG có dòng nào (khác một dòng trống); `\r\n` coi như `\n`. */
function toLines(text: string): string[] {
  return text === '' ? [] : text.replace(/\r\n/g, '\n').split('\n');
}

/**
 * Diff từ `a` (bản cũ) sang `b` (bản mới): `add` = chỉ có ở `b`, `del` = chỉ có ở `a`.
 * Dòng khác nhau ưu tiên `del` trước `add`. `null` = quá dài để so sánh.
 */
export function diffLines(a: string, b: string): DiffRow[] | null {
  const x = toLines(a);
  const y = toLines(b);
  const n = x.length;
  const m = y.length;
  if (n * m > MAX_CELLS) return null;

  // lcs[i][j] = độ dài chuỗi con chung dài nhất của x[i:] và y[j:]; min(n, m) ≤ 2000 nên vừa Uint16.
  const w = m + 1;
  const lcs = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] =
        x[i] === y[j]
          ? lcs[(i + 1) * w + j + 1]! + 1
          : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }

  const out: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ type: 'same', text: x[i]! });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) {
      out.push({ type: 'del', text: x[i++]! });
    } else {
      out.push({ type: 'add', text: y[j++]! });
    }
  }
  while (i < n) out.push({ type: 'del', text: x[i++]! });
  while (j < m) out.push({ type: 'add', text: y[j++]! });
  return out;
}

export type CollapsedRow = DiffRow | { type: 'skip'; count: number };

/** Số dòng giống nhau liên tiếp tối đa còn hiện; dài hơn thì thu gọn thành một mục "N dòng không đổi". */
const MAX_SAME_RUN = 6;

/** Thu gọn các đoạn dòng không đổi dài để người xem thấy ngay phần khác biệt. */
export function collapseSame(rows: DiffRow[]): CollapsedRow[] {
  const out: CollapsedRow[] = [];
  let run: DiffRow[] = [];
  const flush = () => {
    if (run.length > MAX_SAME_RUN) out.push({ type: 'skip', count: run.length });
    else out.push(...run);
    run = [];
  };
  for (const r of rows) {
    if (r.type === 'same') run.push(r);
    else {
      flush();
      out.push(r);
    }
  }
  flush();
  return out;
}
