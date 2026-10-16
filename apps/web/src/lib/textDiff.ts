/**
 * So sánh văn bản theo DÒNG (LCS), tự viết — không thêm dependency. Dùng cho hộp "Xem thay đổi" của mô tả (lịch sử).
 */
export interface DiffLine {
  op: 'same' | 'add' | 'del';
  text: string;
}

const lines = (s: string) => (s === '' ? [] : s.split('\n'));

/**
 * Diff từng dòng: cắt tiền tố/hậu tố giống nhau rồi LCS phần giữa. Phần giữa vượt `maxCells` ô (x.length × y.length)
 * thì rơi về "xoá hết rồi thêm hết" để không treo trình duyệt với mô tả rất dài.
 */
export function diffLines(oldText: string, newText: string, maxCells = 4_000_000): DiffLine[] {
  const A = lines(oldText);
  const B = lines(newText);
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length;
  let eb = B.length;
  while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) {
    ea--;
    eb--;
  }
  const x = A.slice(s, ea);
  const y = B.slice(s, eb);
  const head = A.slice(0, s).map((text): DiffLine => ({ op: 'same', text }));
  const tail = A.slice(ea).map((text): DiffLine => ({ op: 'same', text }));
  const mid: DiffLine[] = [];
  if (x.length * y.length > maxCells) {
    for (const text of x) mid.push({ op: 'del', text });
    for (const text of y) mid.push({ op: 'add', text });
  } else {
    // Độ dài LCS của hậu tố (i, j) trong bảng phẳng, rồi lần xuôi theo bảng.
    const w = y.length + 1;
    const t = new Uint32Array((x.length + 1) * w);
    for (let i = x.length - 1; i >= 0; i--)
      for (let j = y.length - 1; j >= 0; j--)
        t[i * w + j] =
          x[i] === y[j]
            ? t[(i + 1) * w + j + 1]! + 1
            : Math.max(t[(i + 1) * w + j]!, t[i * w + j + 1]!);
    let i = 0;
    let j = 0;
    while (i < x.length && j < y.length) {
      if (x[i] === y[j]) {
        mid.push({ op: 'same', text: x[i]! });
        i++;
        j++;
      } else if (t[(i + 1) * w + j]! >= t[i * w + j + 1]!) mid.push({ op: 'del', text: x[i++]! });
      else mid.push({ op: 'add', text: y[j++]! });
    }
    while (i < x.length) mid.push({ op: 'del', text: x[i++]! });
    while (j < y.length) mid.push({ op: 'add', text: y[j++]! });
  }
  return [...head, ...mid, ...tail];
}

export type CollapsedLine = DiffLine | { op: 'skip'; count: number };

/** Giữ `context` dòng quanh mỗi thay đổi; đoạn "same" xa hơn gom thành một dòng `skip` (số dòng bị ẩn). */
export function collapseSame(all: DiffLine[], context = 2): CollapsedLine[] {
  const keep = new Array<boolean>(all.length).fill(false);
  all.forEach((l, i) => {
    if (l.op === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(all.length - 1, i + context); k++)
      keep[k] = true;
  });
  const out: CollapsedLine[] = [];
  let skipped = 0;
  all.forEach((l, i) => {
    if (keep[i]) {
      if (skipped) {
        out.push({ op: 'skip', count: skipped });
        skipped = 0;
      }
      out.push(l);
    } else skipped++;
  });
  if (skipped) out.push({ op: 'skip', count: skipped });
  return out;
}
