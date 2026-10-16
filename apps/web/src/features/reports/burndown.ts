import type { BurndownPoint, BurndownReport, VelocityReport } from '@tirapro/shared';
import type { SprintState } from '@tirapro/types';
import { fmtDate } from '@/lib/dateFormat';
import { fmtPoints } from './sprintSummary';

/** Phần tối thiểu của sprint mà các hàm thuần ở đây cần (khớp một phần `SprintDto`). */
export interface SprintLike {
  id: string;
  name: string;
  state: SprintState;
  sequence: number;
}

/**
 * Ngày để vạch "Hôm nay" trên biểu đồ burndown: chỉ khi `today` nằm trong chuỗi ngày của sprint
 * (vạch đặt ở một giá trị trục X không có trong dữ liệu thì recharts không vẽ gì, nên trả null cho rõ).
 */
export function todayMarker(series: BurndownPoint[], today: string): string | null {
  return series.some((p) => p.date === today) ? today : null;
}

/** Nhãn trạng thái ngắn của sprint (dùng chung cho danh sách chọn). */
export const SPRINT_STATE_LABEL: Record<SprintState, string> = {
  ACTIVE: 'đang chạy',
  CLOSED: 'đã kết thúc',
  FUTURE: 'chưa bắt đầu',
};

/**
 * Thứ tự trong danh sách chọn: Đang chạy → Đã kết thúc (mới nhất trước) → Chưa bắt đầu (sớm nhất trước,
 * vì sprint tới gần nhất là cái người ta hay xem). Không đổi mảng gốc.
 */
export function orderSprints<T extends SprintLike>(sprints: T[]): T[] {
  const rank: Record<SprintState, number> = { ACTIVE: 0, CLOSED: 1, FUTURE: 2 };
  return [...sprints].sort((a, b) => {
    if (a.state !== b.state) return rank[a.state] - rank[b.state];
    return a.state === 'FUTURE' ? a.sequence - b.sequence : b.sequence - a.sequence;
  });
}

/**
 * Sprint mở mặc định: đang chạy → đã kết thúc mới nhất (`sequence` lớn nhất) → chưa bắt đầu mới nhất.
 * (Khác `orderSprints` ở nhánh FUTURE: mặc định lấy sprint lập sau cùng.)
 */
export function pickDefaultSprint<T extends SprintLike>(sprints: T[]): T | undefined {
  const newest = (list: T[]) =>
    list.reduce<T | undefined>((m, s) => (!m || s.sequence > m.sequence ? s : m), undefined);
  return (
    sprints.find((s) => s.state === 'ACTIVE') ??
    newest(sprints.filter((s) => s.state === 'CLOSED')) ??
    newest(sprints.filter((s) => s.state === 'FUTURE'))
  );
}

/** Sprint theo `?sprint=` nếu còn tồn tại, không thì mặc định (sprint đã xoá / link cũ không làm trống trang). */
export function resolveSprint<T extends SprintLike>(
  sprints: T[],
  wantedId: string | null | undefined,
): T | undefined {
  return sprints.find((s) => s.id === wantedId) ?? pickDefaultSprint(sprints);
}

/** Mô tả văn bản của biểu đồ Burndown cho trình đọc màn hình (`aria-label` của `role="img"`). */
export function burndownSummary(report: BurndownReport): string {
  const head = `Burndown ${report.sprintName}: cam kết ${fmtPoints(report.committedPoints)} điểm.`;
  const last = [...report.series].reverse().find((p) => p.remaining !== null);
  if (!last) return `${head} Chưa có số liệu điểm còn lại.`;
  return `${head} Đến ${fmtDate(last.date)} còn ${fmtPoints(last.remaining ?? 0)} điểm, đường lý tưởng ${fmtPoints(last.ideal)} điểm.`;
}

/** Mô tả văn bản của biểu đồ Velocity: trung bình và từng sprint đã đóng. */
export function velocitySummary(report: VelocityReport): string {
  if (report.sprints.length === 0) return 'Velocity: chưa có sprint nào đã đóng.';
  const rows = report.sprints
    .map(
      (s) => `${s.sprintName} hoàn thành ${fmtPoints(s.completed)}/${fmtPoints(s.committed)} điểm`,
    )
    .join('; ');
  return `Velocity: trung bình hoàn thành ${fmtPoints(report.averageCompleted)} điểm. ${rows}.`;
}
