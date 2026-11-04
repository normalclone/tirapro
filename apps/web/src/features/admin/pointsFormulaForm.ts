import {
  DEFAULT_POINTS_FORMULA,
  DIFFICULTIES,
  pointsFormulaSchema,
  type PointsFormula,
} from '@tirapro/shared';

/** Ba bảng của công thức: điểm gốc theo loại × hệ số độ khó × hệ số ưu tiên. */
export type FormulaGroup = 'base' | 'difficulty' | 'priority';

/** Khoá ô nhập, vd `base.TASK`, `difficulty.HARD`, `priority.High`. */
export type FormulaKey = `${FormulaGroup}.${string}`;

/** Trạng thái đang gõ: giữ CHUỖI (để gõ dở "1." hay xoá hết vẫn được), kiểm khi lưu. */
export type FormulaDraft = Record<FormulaKey, string>;

export const BASE_KEYS = ['SUBTASK', 'TASK', 'BUG', 'STORY'] as const;
export const PRIORITY_NAMES = ['Lowest', 'Low', 'Medium', 'High', 'Highest'] as const;

export const BASE_LABELS: Record<(typeof BASE_KEYS)[number], string> = {
  SUBTASK: 'Sub-task',
  TASK: 'Task',
  BUG: 'Bug',
  STORY: 'Story',
};

/** Giới hạn hệ số — khớp `pointsFormulaSchema` (> 0, ≤ 100). */
export const COEF_MAX = 100;

export const fieldKey = (group: FormulaGroup, name: string): FormulaKey => `${group}.${name}`;

export function toDraft(f: PointsFormula): FormulaDraft {
  const out: FormulaDraft = {};
  for (const [g, table] of Object.entries(f) as [FormulaGroup, Record<string, number>][])
    for (const [k, v] of Object.entries(table)) out[fieldKey(g, k)] = String(v);
  return out;
}

/** Lời lỗi của MỘT ô; `null` = hợp lệ. Chấp nhận dấu phẩy thập phân ("1,5"). */
export function coefError(raw: string): string | null {
  const s = raw.trim().replace(',', '.');
  if (s === '') return 'Nhập hệ số';
  const n = Number(s);
  if (!Number.isFinite(n)) return 'Phải là một số';
  if (n <= 0) return 'Phải lớn hơn 0';
  if (n > COEF_MAX) return `Tối đa ${COEF_MAX}`;
  return null;
}

/** Mọi ô sai (theo khoá) — rỗng khi bảng hợp lệ. */
export function draftErrors(draft: FormulaDraft): Partial<Record<FormulaKey, string>> {
  const out: Partial<Record<FormulaKey, string>> = {};
  for (const [k, v] of Object.entries(draft) as [FormulaKey, string][]) {
    const e = coefError(v);
    if (e) out[k] = e;
  }
  return out;
}

/** Dựng bảng hệ số từ bản nháp; `null` khi có ô sai (hoặc schema chung từ chối). */
export function draftToFormula(draft: FormulaDraft): PointsFormula | null {
  if (Object.keys(draftErrors(draft)).length > 0) return null;
  const num = (g: FormulaGroup, k: string) =>
    Number(draft[fieldKey(g, k)]?.trim().replace(',', '.'));
  const r = pointsFormulaSchema.safeParse({
    base: Object.fromEntries(BASE_KEYS.map((k) => [k, num('base', k)])),
    difficulty: Object.fromEntries(DIFFICULTIES.map((k) => [k, num('difficulty', k)])),
    priority: Object.fromEntries(PRIORITY_NAMES.map((k) => [k, num('priority', k)])),
  });
  return r.success ? r.data : null;
}

/** Bản nháp có khác bảng đã lưu không (so theo số, "1.0" = "1"). */
export function isDraftDirty(draft: FormulaDraft, saved: PointsFormula): boolean {
  const savedDraft = toDraft(saved);
  return Object.entries(savedDraft).some(([k, v]) => {
    const cur = draft[k as FormulaKey];
    return cur === undefined || cur.trim().replace(',', '.') !== v;
  });
}

export const DEFAULT_DRAFT: FormulaDraft = toDraft(DEFAULT_POINTS_FORMULA);
