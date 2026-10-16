import { jqlLiteral, type JqlSuggestion, type JqlSuggestResult } from '@tirapro/shared';

/**
 * Áp một gợi ý vào văn bản: thay `[from, to)` bằng `insert`; nếu ký tự ngay sau `to` không phải khoảng trắng
 * (kể cả hết chuỗi) thì thêm đúng 1 khoảng trắng để gõ tiếp ngay; con trỏ đặt sau phần đã chèn.
 * Ngoại lệ: "(" (mở danh sách IN) không thêm khoảng trắng.
 */
export function applySuggestion(
  text: string,
  result: JqlSuggestResult,
  item: JqlSuggestion,
): { text: string; caret: number } {
  const after = text.slice(result.to);
  const needSpace = item.insert !== '(' && !/^\s/.test(after);
  const head = text.slice(0, result.from) + item.insert + (needSpace ? ' ' : '');
  return { text: head + after, caret: head.length };
}

interface Span {
  start: number;
  end: number;
  value: string;
}

const isWordChar = (c: string | undefined): boolean => c !== undefined && /\w/.test(c);

/** Vị trí ngay sau nháy đóng của chuỗi mở ở `i` (hết chuỗi nếu chưa đóng). */
function skipString(text: string, i: number): number {
  const q = text[i]!;
  let j = i + 1;
  while (j < text.length && text[j] !== q) j += text[j] === '\\' ? 2 : 1;
  return Math.min(j + 1, text.length);
}

/** Một giá trị (chuỗi nháy hoặc từ trần) bắt đầu ở `from` (bỏ khoảng trắng đầu); null nếu không có. */
function readValue(text: string, from: number): Span | null {
  let i = from;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  if (i >= text.length) return null;
  if (text[i] === '"' || text[i] === "'") {
    const end = skipString(text, i);
    const closed = end - 1 > i && text[end - 1] === text[i];
    return { start: i, end, value: text.slice(i + 1, closed ? end - 1 : end) };
  }
  const m = /^[^\s(),=<>!~"']+/.exec(text.slice(i));
  return m ? { start: i, end: i + m[0].length, value: m[0] } : null;
}

/**
 * Mọi giá trị của điều kiện `field (=|!=|IN|NOT IN) …` trong `text` (bỏ qua chữ nằm trong chuỗi nháy),
 * gồm cả từng phần tử của danh sách `IN (…)`. Không dùng regex lookbehind (Safari < 16.4).
 */
function valuesOfField(text: string, field: string): Span[] {
  const out: Span[] = [];
  const f = field.toLowerCase();
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"' || c === "'") {
      i = skipString(text, i);
      continue;
    }
    if (
      !isWordChar(text[i - 1]) &&
      text.slice(i, i + f.length).toLowerCase() === f &&
      !isWordChar(text[i + f.length])
    ) {
      const op = /^\s*(!=|=|NOT\s+IN\b|IN\b)\s*/i.exec(text.slice(i + f.length));
      if (op) {
        let j = i + f.length + op[0].length;
        if (/in$/i.test(op[1]!)) {
          if (text[j] === '(') {
            j++;
            for (;;) {
              const v = readValue(text, j);
              if (!v) break;
              out.push(v);
              j = v.end;
              while (j < text.length && /\s/.test(text[j]!)) j++;
              if (text[j] !== ',') break;
              j++;
            }
          }
        } else {
          const v = readValue(text, j);
          if (v) out.push(v);
        }
      }
      i += f.length;
      continue;
    }
    i++;
  }
  return out;
}

/**
 * Thay MỌI giá trị sai `wrong` (bare hoặc trong nháy, không phân biệt hoa thường) của trường `field`
 * bằng `right` (bọc nháy khi cần): cùng trường + cùng giá trị thì lần nào cũng sai, nên không chỉ lần đầu
 * (`status = Done OR status = Dne`). Không đụng giá trị trùng ở trường khác hay chữ trong chuỗi nháy.
 * Không tìm thấy → trả nguyên văn bản.
 */
export function applyDidYouMean(text: string, field: string, wrong: string, right: string): string {
  const w = wrong.toLowerCase();
  const hits = valuesOfField(text, field).filter((v) => v.value.toLowerCase() === w);
  let out = text;
  for (const h of hits.reverse())
    out = out.slice(0, h.start) + jqlLiteral(right) + out.slice(h.end);
  return out;
}
