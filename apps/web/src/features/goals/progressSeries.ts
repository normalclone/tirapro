import type { KeyResultSource, KeyResultUnit } from '@tirapro/types';
import type { GoalProgressHistory } from './api';

const DAY_MS = 86_400_000;
const toMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const toDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export interface SeriesLine {
  id: string;
  name: string;
  unit: KeyResultUnit;
  unitLabel: string | null;
  source: KeyResultSource;
  /** Có ít nhất một điểm dữ liệu (KR ẩn do dự án riêng tư thì không). */
  hasData: boolean;
  scopeNote: string | null;
}

export interface SeriesRow {
  date: string;
  /** Trung bình tiến độ mục tiêu (null ngoài khoảng có dữ liệu). */
  objective: number | null;
  /** Mốc kỳ vọng theo thời gian (null với kỳ tự do). */
  expected: number | null;
  /** % tiến độ của từng KR theo thứ tự `lines` (null trước điểm đầu / sau hôm nay). */
  progress: Array<number | null>;
  /** Giá trị thật của từng KR (cho tooltip) theo thứ tự `lines`. */
  value: Array<number | null>;
}

/**
 * Gộp lịch sử từ BE thành các dòng theo ngày cho biểu đồ nhiều đường: ngày tăng dần, không trùng; KR không có
 * điểm trước dòng dữ liệu đầu của nó. `extendToPeriodEnd` (mặc định bật): kéo trục tới hết quý để thấy mốc kỳ
 * vọng đi tiếp trong khi đường KR dừng ở hôm nay.
 */
export function buildSeries(
  history: GoalProgressHistory,
  opts: { extendToPeriodEnd?: boolean } = {},
): { rows: SeriesRow[]; lines: SeriesLine[] } {
  const extend = opts.extendToPeriodEnd ?? true;
  const lines: SeriesLine[] = history.keyResults.map((kr) => ({
    id: kr.id,
    name: kr.name,
    unit: kr.unit,
    unitLabel: kr.unitLabel,
    source: kr.source,
    hasData: kr.points.length > 0,
    scopeNote: kr.scopeNote,
  }));

  const start = toMs(history.from);
  const dataEnd = toMs(history.to);
  // `expected` (từ BE — một công thức duy nhất) đi tới hết quý; kéo trục theo nó để thấy mốc kỳ vọng đi tiếp.
  const lastExpected = history.expected?.at(-1)?.date;
  const end = extend && lastExpected ? Math.max(dataEnd, toMs(lastExpected)) : dataEnd;

  const dates: string[] = [];
  for (let t = start; t <= end; t += DAY_MS) dates.push(toDate(t));
  const expected = new Map(history.expected?.map((p) => [p.date, p.progress]));
  const objective = new Map(history.objective.map((p) => [p.date, p.progress]));
  const perKr = history.keyResults.map((kr) => new Map(kr.points.map((p) => [p.date, p])));

  const rows = dates.map<SeriesRow>((date) => ({
    date,
    objective: objective.get(date) ?? null,
    expected: expected.get(date) ?? null,
    progress: perKr.map((m) => m.get(date)?.progress ?? null),
    value: perKr.map((m) => m.get(date)?.value ?? null),
  }));
  return { rows, lines };
}
