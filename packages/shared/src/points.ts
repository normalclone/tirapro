import { z } from 'zod';
import { vnTodayUtc } from './vn-date';

/**
 * Điểm việc tự tính: Điểm = Điểm gốc theo loại × Hệ số độ khó × Hệ số ưu tiên, làm tròn half-up.
 * Epic không áp công thức (điểm = tổng việc con, tính ở server). MỘT nơi định nghĩa cho API + web.
 */

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD' | 'VERY_HARD';
export const DIFFICULTIES: readonly Difficulty[] = ['EASY', 'MEDIUM', 'HARD', 'VERY_HARD'];
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  EASY: 'Dễ',
  MEDIUM: 'Trung bình',
  HARD: 'Khó',
  VERY_HARD: 'Rất khó',
};

export type PointsBaseKey = 'SUBTASK' | 'TASK' | 'BUG' | 'STORY';
export type PointsPriorityName = 'Lowest' | 'Low' | 'Medium' | 'High' | 'Highest';

export interface PointsFormula {
  base: Record<PointsBaseKey, number>;
  difficulty: Record<Difficulty, number>;
  /** Khoá theo TÊN ưu tiên hệ thống; tên khác hoặc không có ưu tiên → ×1. */
  priority: Record<PointsPriorityName, number>;
}

export const DEFAULT_POINTS_FORMULA: PointsFormula = {
  base: { SUBTASK: 1, TASK: 2, BUG: 2, STORY: 3 },
  difficulty: { EASY: 1, MEDIUM: 2, HARD: 3, VERY_HARD: 5 },
  priority: { Lowest: 1, Low: 1, Medium: 1, High: 1.5, Highest: 2 },
};

const coef = z.number().gt(0).max(100);
export const pointsFormulaSchema = z.object({
  base: z.object({ SUBTASK: coef, TASK: coef, BUG: coef, STORY: coef }),
  difficulty: z.object({ EASY: coef, MEDIUM: coef, HARD: coef, VERY_HARD: coef }),
  priority: z.object({ Lowest: coef, Low: coef, Medium: coef, High: coef, Highest: coef }),
});

function has<T extends object>(o: T, k: string): k is Extract<keyof T, string> {
  return Object.prototype.hasOwnProperty.call(o, k);
}

/** Điểm gốc: loại tuỳ chỉnh (key null/lạ) dùng gốc của Task. */
function baseFor(f: PointsFormula, typeKey: string | null): number {
  return typeKey && has(f.base, typeKey) ? f.base[typeKey] : f.base.TASK;
}

/** Hệ số ưu tiên: tên không thuộc 5 tên hệ thống hoặc không có ưu tiên → 1. */
function priorityFactor(f: PointsFormula, priorityName: string | null): number {
  return priorityName && has(f.priority, priorityName) ? f.priority[priorityName] : 1;
}

/** Làm tròn half-up thành số nguyên (hệ số dương nên floor(x + 0.5) đủ). */
function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

/** `null` cho Epic (điểm = tổng việc con). */
export function computePoints(
  f: PointsFormula,
  typeKey: string | null,
  difficulty: Difficulty,
  priorityName: string | null,
): number | null {
  if (typeKey === 'EPIC') return null;
  return roundHalfUp(
    baseFor(f, typeKey) * f.difficulty[difficulty] * priorityFactor(f, priorityName),
  );
}

/** Giải thích cách ra điểm, vd "Bug · Khó · High = 2×3×1.5 = 9". */
export function explainPoints(
  f: PointsFormula,
  typeKey: string | null,
  typeName: string,
  difficulty: Difficulty,
  priorityName: string | null,
): string {
  const pts = computePoints(f, typeKey, difficulty, priorityName);
  if (pts === null) return `${typeName} = tổng điểm các việc con`;
  const labels = [typeName, DIFFICULTY_LABELS[difficulty], ...(priorityName ? [priorityName] : [])];
  const factors = [baseFor(f, typeKey), f.difficulty[difficulty], priorityFactor(f, priorityName)];
  return `${labels.join(' · ')} = ${factors.join('×')} = ${pts}`;
}

/** Hạn mặc định = NGÀY LỊCH Việt Nam của `createdAt` + 1, lưu `YYYY-MM-DDT00:00:00.000Z` (ngày lịch). */
export function defaultDueDate(createdAt: Date): string {
  return new Date(vnTodayUtc(createdAt).getTime() + 86_400_000).toISOString();
}
