import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';

/** Khoảng ngày của một thanh Gantt (đều là đầu ngày địa phương). */
export interface DaySpan {
  start: Date;
  end: Date;
}

export type DragEdge = 'start' | 'end';

/** Px kéo ngang → số ngày nguyên (nhảy theo ngày). `-0` chuẩn hoá về `0`. */
export function pxToDays(dx: number, dayW: number): number {
  const n = Math.round(dx / dayW);
  return n === 0 ? 0 : n;
}

/** Dời cả hai đầu cùng `deltaDays` ngày. */
export function shiftSpan(span: DaySpan, deltaDays: number): DaySpan {
  return { start: addDays(span.start, deltaDays), end: addDays(span.end, deltaDays) };
}

/** Đổi một đầu; thanh tối thiểu 1 ngày (đầu bị kéo bị kẹp vào đầu kia). */
export function resizeSpan(span: DaySpan, edge: DragEdge, deltaDays: number): DaySpan {
  if (edge === 'end') {
    const end = addDays(span.end, deltaDays);
    return { start: span.start, end: end < span.start ? span.start : end };
  }
  const start = addDays(span.start, deltaDays);
  return { start: start > span.end ? span.end : start, end: span.end };
}

/** Áp kiểu kéo lên khoảng gốc: thân = dời, mép = co giãn. */
export function applyDrag(span: DaySpan, mode: 'move' | DragEdge, deltaDays: number): DaySpan {
  return mode === 'move' ? shiftSpan(span, deltaDays) : resizeSpan(span, mode, deltaDays);
}

interface IssueDates {
  startDate: string | null;
  dueDate: string | null;
}

/** Ngày `day` (đầu ngày địa phương) mang giờ-trong-ngày của `old`; chưa có `old` thì giờ mặc định. */
function withTimeOf(day: Date, old: string | null, fallback: [number, number]): Date {
  const d = new Date(day);
  if (old) {
    const o = new Date(old);
    d.setHours(o.getHours(), o.getMinutes(), 0, 0);
  } else {
    d.setHours(fallback[0], fallback[1], 0, 0);
  }
  return d;
}

/**
 * Phần vá gửi API sau khi kéo. Chỉ gửi đầu nào đổi NGÀY (so với ngày đang hiển thị trên thanh) hoặc chưa có giá trị
 * thật (thanh suy ra/một đầu trống → thành ngày thật). Giữ giờ-trong-ngày của giá trị cũ (hạn 17:00 vẫn là 17:00,
 * không bị tụt về 00:00 → "quá hạn" sớm); chưa có thì bắt đầu = 00:00, hạn = 23:59 địa phương.
 * `shown` = khoảng đang hiển thị trước khi kéo (mặc định suy từ `issue`).
 */
export function toIssuePatch(
  issue: IssueDates,
  next: DaySpan,
  shown?: DaySpan,
): { startDate?: string; dueDate?: string } {
  const before: DaySpan =
    shown ??
    (() => {
      const s = startOfDay(new Date(issue.startDate ?? issue.dueDate ?? next.start));
      const e = startOfDay(new Date(issue.dueDate ?? issue.startDate ?? next.end));
      return { start: s, end: e < s ? s : e };
    })();
  const patch: { startDate?: string; dueDate?: string } = {};
  const startChanged = !issue.startDate || differenceInCalendarDays(next.start, before.start) !== 0;
  const endChanged = !issue.dueDate || differenceInCalendarDays(next.end, before.end) !== 0;
  let start = withTimeOf(next.start, issue.startDate, [0, 0]);
  const end = withTimeOf(next.end, issue.dueDate, [23, 59]);
  // Cùng ngày mà giờ bắt đầu cũ muộn hơn giờ hạn → hạ bắt đầu về 00:00 để luôn "bắt đầu ≤ hạn".
  let startAdjusted = false;
  if (start > end) {
    start = startOfDay(next.start);
    startAdjusted = true;
  }
  if (startChanged || startAdjusted) patch.startDate = start.toISOString();
  if (endChanged) patch.dueDate = end.toISOString();
  return patch;
}

/** ISO `yyyy-MM-dd` → thời điểm trong ngày theo giờ địa phương (bắt đầu 00:00, hạn 23:59) rồi UTC ISO. */
function dayToIso(iso: string, edge: 'start' | 'end'): string {
  return new Date(`${iso}T${edge === 'start' ? '00:00:00' : '23:59:00'}`).toISOString();
}

export interface UnscheduledPatch {
  startDate?: string;
  dueDate?: string;
}

/** Ô trống một đầu = chỉ đặt đầu còn lại; cả hai trống = không có gì để lưu (null). */
export function buildUnscheduledPatch(start: string, due: string): UnscheduledPatch | null {
  if (!start && !due) return null;
  const patch: UnscheduledPatch = {};
  if (start) patch.startDate = dayToIso(start, 'start');
  if (due) patch.dueDate = dayToIso(due, 'end');
  return patch;
}
