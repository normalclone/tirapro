/** Gộp dãy ngày liên tiếp theo tháng dương lịch để vẽ dải tháng ở header Gantt. */
export interface MonthGroup {
  /** Ngày đầu tiên của nhóm (không nhất thiết mùng 1). */
  start: Date;
  /** Số ngày thuộc tháng đó trong khoảng đang vẽ. */
  span: number;
}

export function groupDaysByMonth(days: readonly Date[]): MonthGroup[] {
  const out: MonthGroup[] = [];
  let i = 0;
  while (i < days.length) {
    const m = days[i]!;
    let j = i;
    while (
      j < days.length &&
      days[j]!.getMonth() === m.getMonth() &&
      days[j]!.getFullYear() === m.getFullYear()
    )
      j++;
    out.push({ start: m, span: j - i });
    i = j;
  }
  return out;
}
