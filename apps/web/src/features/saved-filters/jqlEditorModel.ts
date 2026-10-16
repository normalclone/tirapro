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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Thay giá trị sai `wrong` (bare hoặc trong nháy, không phân biệt hoa thường) của điều kiện thuộc `field`
 * bằng `right` (bọc nháy khi cần). Chỉ tìm trong điều kiện đó (từ tên trường tới AND/OR/ORDER kế tiếp);
 * không tìm thấy → trả nguyên văn bản.
 */
export function applyDidYouMean(text: string, field: string, wrong: string, right: string): string {
  const fieldAt = new RegExp(`(?<![\\w])${escapeRe(field)}(?![\\w])`, 'i').exec(text);
  const start = fieldAt ? fieldAt.index : 0;
  const tail = text.slice(start);
  const boundary = /\s(?:AND|OR|ORDER)\s/i.exec(tail);
  const clause = boundary ? tail.slice(0, boundary.index) : tail;
  const value = new RegExp(`(?<![^\\s(,=!<>~])(["']?)${escapeRe(wrong)}\\1(?![^\\s),])`, 'i').exec(
    clause,
  );
  if (!value) return text;
  const at = start + value.index;
  return text.slice(0, at) + jqlLiteral(right) + text.slice(at + value[0].length);
}
