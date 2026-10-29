import { format } from 'date-fns';

/** Ngày yyyy-MM-dd (giá trị của `DateInput`) → ISO UTC 00:00 — ngày lịch, khớp cách máy chủ/burndown tính theo UTC. */
export const toDayIso = (day: string): string => `${day}T00:00:00.000Z`;

/** ISO → ngày yyyy-MM-dd cho `DateInput` ('' khi không có). */
export const dayOf = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : '');

/** Ngày bắt đầu mặc định: HÔM NAY theo giờ địa phương (không để UTC làm lệch sang hôm qua/mai). */
export function defaultStart(now: Date): string {
  return toDayIso(format(now, 'yyyy-MM-dd'));
}

/**
 * Ngày kết thúc gợi ý = bắt đầu + 7×`weeks` − 1 ngày (ISO UTC 00:00 vào, ISO UTC 00:00 ra): khoảng ngày được đếm cả
 * hai đầu (`inclusiveDayCount`) nên "2 tuần" là đúng 14 ngày (20/10 → 02/11), không phải 15.
 */
export function suggestEnd(startISO: string, weeks: number): string {
  const d = new Date(startISO);
  d.setUTCDate(d.getUTCDate() + weeks * 7 - 1);
  return d.toISOString().slice(0, 10) + 'T00:00:00.000Z';
}

export interface StartWarningInput {
  issueCount: number;
  totalPoints: number;
  hasGoal: boolean;
  hasEnd: boolean;
  /** Số việc trong sprint chưa có điểm ước lượng; không truyền thì coi cả sprint chưa ước lượng khi tổng điểm = 0. */
  unestimatedCount?: number;
}

/**
 * Cảnh báo KHÔNG chặn trước khi bắt đầu sprint, theo thứ tự cố định: ngày kết thúc → mục tiêu → việc.
 * (Chỉ end < start mới chặn — việc đó do hộp thoại kiểm riêng.)
 */
export function startWarnings(input: StartWarningInput): string[] {
  const out: string[] = [];
  if (!input.hasEnd) out.push('Chưa có ngày kết thúc — burndown và “còn N ngày” sẽ trống.');
  if (!input.hasGoal) out.push('Chưa có mục tiêu sprint.');
  if (input.issueCount === 0) out.push('Sprint chưa có việc nào.');
  else {
    const unestimated = input.unestimatedCount ?? (input.totalPoints === 0 ? input.issueCount : 0);
    if (unestimated > 0) out.push(`Có việc chưa ước lượng điểm: ${unestimated}.`);
  }
  return out;
}
