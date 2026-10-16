import { normalizeVi } from '../search/vi-text';

/** Từ dừng (đã bỏ dấu) — không mang nghĩa để khớp việc: "Hoàn thiện luồng thanh toán" → luồng, thanh, toán. */
const STOP_WORDS = new Set([
  'va',
  'cac',
  'nhung',
  'cua',
  'cho',
  'de',
  'la',
  'voi',
  'hoan',
  'thien',
  'xay',
  'dung',
  'sprint',
  'muc',
  'tieu',
  'can',
  'duoc',
  'trong',
  'mot',
  'nay',
]);

const MIN_LEN = 3;
const MAX_WORDS = 12;

export interface GoalWord {
  /** Dạng gốc (có dấu, chữ thường) để hiển thị trong lý do. */
  raw: string;
  /** Dạng đã bỏ dấu để so khớp. */
  norm: string;
}

/** Tách mục tiêu sprint thành các từ có nghĩa (bỏ từ dừng, từ < 3 ký tự sau khi bỏ dấu, trùng). */
export function goalWords(goal: string): GoalWord[] {
  const out: GoalWord[] = [];
  const seen = new Set<string>();
  for (const m of goal
    .normalize('NFC')
    .toLowerCase()
    .matchAll(/[\p{L}\p{N}]+/gu)) {
    const raw = m[0];
    const norm = normalizeVi(raw);
    if (norm.length < MIN_LEN || STOP_WORDS.has(norm) || seen.has(norm)) continue;
    seen.add(norm);
    out.push({ raw, norm });
    if (out.length >= MAX_WORDS) break;
  }
  return out;
}

/**
 * Hai ký tự (đã hạ chữ thường) tương thích khi giống nhau hoặc MỘT bên gõ không dấu (`base` = dạng bỏ dấu).
 * Cả hai cùng có dấu mà khác nhau ("á" vs "ả") thì KHÔNG tương thích — "bán" không được khớp "bản".
 */
function charCompatible(goalChar: string, summaryChar: string, base: string): boolean {
  return goalChar === summaryChar || goalChar === base || summaryChar === base;
}

/**
 * Các từ của mục tiêu xuất hiện trong tiêu đề việc: so khớp không dấu tại ĐẦU một từ ("hàng" không khớp nhầm
 * "tháng"), nhưng nếu cả hai bên đều có dấu thì dấu phải trùng. Trả dạng gốc có dấu, theo thứ tự trong mục tiêu.
 */
export function matchedGoalWords(words: GoalWord[], summary: string): string[] {
  const lower = summary.normalize('NFC').toLowerCase();
  const hay = normalizeVi(lower);
  // Ánh xạ vị trí 1-1 giữa chuỗi có dấu và không dấu; nếu lệch độ dài thì chỉ so không dấu.
  const aligned = [...lower].length === [...hay].length && lower.length === hay.length;
  return words
    .filter((w) => {
      let from = hay.indexOf(w.norm);
      while (from !== -1) {
        const atWordStart = from === 0 || !/[\p{L}\p{N}]/u.test(hay[from - 1]!);
        if (atWordStart && (!aligned || accentsAgree(w, lower, hay, from))) return true;
        from = hay.indexOf(w.norm, from + 1);
      }
      return false;
    })
    .map((w) => w.raw);
}

function accentsAgree(w: GoalWord, lower: string, hay: string, from: number): boolean {
  if (w.raw.length !== w.norm.length) return true; // không ánh xạ 1-1 được → chỉ dựa vào so khớp không dấu
  for (let i = 0; i < w.norm.length; i++) {
    if (!charCompatible(w.raw[i]!, lower[from + i]!, hay[from + i]!)) return false;
  }
  return true;
}
