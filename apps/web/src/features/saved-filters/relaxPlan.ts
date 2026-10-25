import { flattenAnd, parseJql } from '@tirapro/shared';
import type { RelaxClauseCount, RelaxCounts } from './api';

export type RelaxCountsDto = RelaxCounts;
type RelaxRow = RelaxClauseCount & { count: number };

/** Số dòng gợi ý tối đa hiện ra. */
export const RELAX_MAX_ROWS = 5;

export interface RelaxPlan {
  rows: RelaxRow[];
  /** Số điều kiện máy chủ đếm không kịp (count = null). */
  timedOut: number;
  /** Số điều kiện máy chủ không thử vì vượt giới hạn. */
  remaining: number;
  /** Số điều kiện đã được thử. */
  counted: number;
}

/**
 * Dòng gợi ý: chỉ điều kiện bỏ đi sẽ ra ít nhất 1 việc (count > 0), nhiều việc nhất trước (ổn định theo thứ tự gốc),
 * tối đa `RELAX_MAX_ROWS`. Điều kiện đếm không kịp không thành dòng mà được tính riêng cho ghi chú.
 */
export function planRelax(data: RelaxCountsDto | undefined): RelaxPlan {
  if (!data) return { rows: [], timedOut: 0, remaining: 0, counted: 0 };
  const rows = data.clauses
    .map((c, index) => ({ c, index }))
    .filter((x): x is { c: RelaxRow; index: number } => x.c.count !== null && x.c.count > 0)
    .sort((a, b) => b.c.count - a.c.count || a.index - b.index)
    .slice(0, RELAX_MAX_ROWS)
    .map((x) => x.c);
  return {
    rows,
    timedOut: data.clauses.filter((c) => c.count === null).length,
    remaining: data.remaining,
    counted: data.clauses.length,
  };
}

/**
 * Có đáng hỏi máy chủ không: JQL hợp lệ và có từ 2 điều kiện AND ở gốc (OR ở gốc / NOT / nhóm lồng đếm là MỘT điều kiện).
 * Một điều kiện thì không có gì để nới → khỏi gọi API.
 */
export function shouldRequestRelax(jql: string): boolean {
  try {
    return flattenAnd(parseJql(jql).where).length >= 2;
  } catch {
    return false;
  }
}
