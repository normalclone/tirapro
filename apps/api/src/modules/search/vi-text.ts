const MARKS = /\p{M}/gu;

/** Bỏ dấu tiếng Việt (đ/Đ → d/D) và hạ chữ thường. */
export function normalizeVi(s: string): string {
  return s.normalize('NFD').replace(MARKS, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

/** Token chữ/số Unicode của chuỗi gõ (giữ dấu — SQL bỏ dấu sau), tối đa 8 token × 40 ký tự. */
export function searchTokens(s: string): string[] {
  return (s.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8).map((t) => t.slice(0, 40));
}

const VI_ACCENTED = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';
/** Cho `translate(col, FROM, TO)` ở fallback: cả chữ thường lẫn HOA (không phụ thuộc `lower()` của locale DB). */
export const VI_TRANSLATE_FROM = VI_ACCENTED + VI_ACCENTED.toUpperCase();
export const VI_TRANSLATE_TO = [...VI_TRANSLATE_FROM]
  .map((c) => c.normalize('NFD').replace(MARKS, '').replace('đ', 'd').replace('Đ', 'D'))
  .join('');
