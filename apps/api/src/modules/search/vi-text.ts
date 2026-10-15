const MARKS = /\p{M}/gu;

/** Bỏ dấu tiếng Việt (đ/Đ → d/D) và hạ chữ thường. */
export function normalizeVi(s: string): string {
  return s.normalize('NFD').replace(MARKS, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

/**
 * Token chữ/số Unicode của chuỗi gõ (giữ dấu — SQL bỏ dấu sau), tối đa 8 token × 40 ký tự.
 * NFKC (gộp NFD của macOS về NFC + dạng tương thích, vd ⑴ → (1)) rồi loại chữ "modifier" (\p{Lm}: ʼ ˈ ː …) và số
 * dạng khác (\p{No}): `unaccent` đổi các ký tự đó thành `'`, `:`, `(`… — làm `to_tsquery` lỗi 42601 (HTTP 500).
 */
export function searchTokens(s: string): string[] {
  const tokens = s.normalize('NFKC').match(/(?:(?![\p{Lm}\p{No}])[\p{L}\p{N}])+/gu) ?? [];
  return tokens.slice(0, 8).map((t) => t.slice(0, 40));
}

const VI_ACCENTED = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';
/** Cho `translate(col, FROM, TO)` ở fallback: cả chữ thường lẫn HOA (không phụ thuộc `lower()` của locale DB). */
export const VI_TRANSLATE_FROM = VI_ACCENTED + VI_ACCENTED.toUpperCase();
export const VI_TRANSLATE_TO = [...VI_TRANSLATE_FROM]
  .map((c) => c.normalize('NFD').replace(MARKS, '').replace('đ', 'd').replace('Đ', 'D'))
  .join('');
