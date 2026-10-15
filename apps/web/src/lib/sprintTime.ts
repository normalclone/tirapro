import type { SprintDto } from '@tirapro/types';
import { differenceInCalendarDays, format } from 'date-fns';
import { calendarDate } from './calendarDate';

export type SprintTone = 'muted' | 'warning' | 'danger';

export interface SprintTimeInfo {
  /** "15/10 – 29/10" (đủ năm nếu khác năm hiện tại), "đến 29/10" khi thiếu ngày bắt đầu, null khi chưa có ngày kết thúc. */
  range: string | null;
  /** Số ngày lịch tới ngày kết thúc (0 = hết hôm nay, âm = trễ). Chỉ sprint đang chạy có ngày kết thúc. */
  daysLeft: number | null;
  label: string;
  tone: SprintTone;
}

/** Màu chữ theo tone (token của DESIGN.md) — dùng chung cho Board và Backlog. */
export const SPRINT_TONE_CLASS: Record<SprintTone, string> = {
  muted: 'text-muted',
  warning: 'text-warning',
  danger: 'text-danger',
};

function rangeOf(startDate: string | null, endDate: string | null, now: Date): string | null {
  if (!endDate) return null;
  // Một trong hai ngày khác năm hiện tại → cả hai hiện đủ năm để khỏi mơ hồ.
  const dates = [startDate, endDate].filter((x): x is string => !!x).map(calendarDate);
  const pattern = dates.every((d) => d.getFullYear() === now.getFullYear())
    ? 'dd/MM'
    : 'dd/MM/yyyy';
  const fmt = (iso: string) => format(calendarDate(iso), pattern);
  return startDate ? `${fmt(startDate)} – ${fmt(endDate)}` : `đến ${fmt(endDate)}`;
}

/** Khoảng ngày + đếm ngược của một sprint, để hiện ở header Board và Backlog. */
export function sprintTimeInfo(
  sprint: Pick<SprintDto, 'state' | 'startDate' | 'endDate'>,
  now: Date = new Date(),
): SprintTimeInfo {
  const range = rangeOf(sprint.startDate, sprint.endDate, now);
  if (sprint.state === 'CLOSED')
    return { range, daysLeft: null, label: 'đã kết thúc', tone: 'muted' };
  if (sprint.state === 'FUTURE')
    return { range, daysLeft: null, label: 'chưa bắt đầu', tone: 'muted' };
  if (!sprint.endDate) {
    return { range, daysLeft: null, label: 'chưa đặt ngày kết thúc', tone: 'warning' };
  }
  const daysLeft = differenceInCalendarDays(calendarDate(sprint.endDate), now);
  if (daysLeft < 0) return { range, daysLeft, label: `trễ ${-daysLeft} ngày`, tone: 'danger' };
  if (daysLeft === 0) return { range, daysLeft, label: 'hết hôm nay', tone: 'warning' };
  return {
    range,
    daysLeft,
    label: `còn ${daysLeft} ngày`,
    tone: daysLeft <= 2 ? 'warning' : 'muted',
  };
}
