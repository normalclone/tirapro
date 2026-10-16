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
  for (const m of goal.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
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
 * Các từ của mục tiêu xuất hiện trong tiêu đề việc (so khớp không dấu, tại ĐẦU một từ để "hàng" không
 * khớp nhầm "tháng"). Trả dạng gốc có dấu, theo thứ tự trong mục tiêu.
 */
export function matchedGoalWords(words: GoalWord[], summary: string): string[] {
  const hay = normalizeVi(summary);
  return words
    .filter((w) => {
      let from = hay.indexOf(w.norm);
      while (from !== -1) {
        if (from === 0 || !/[\p{L}\p{N}]/u.test(hay[from - 1]!)) return true;
        from = hay.indexOf(w.norm, from + 1);
      }
      return false;
    })
    .map((w) => w.raw);
}
