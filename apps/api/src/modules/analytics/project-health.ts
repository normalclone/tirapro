import type { ProjectHealthLevel } from '@tirapro/shared';
import { raidLevel } from '../raid/raid.service';

/**
 * Luật tự tính sức khoẻ dự án (thuần, không đụng DB). Ngưỡng là hằng số có tên để test và để người đọc tìm được.
 *
 * ĐỎ  : (a) quá hạn ≥ 25% số việc chưa xong (và ≥ 2 việc) · (b) sprint đang chạy đã quá ngày kết thúc mà còn điểm ·
 *       (c) có rủi ro RAID mở mức Nghiêm trọng (điểm ≥ 20).
 * VÀNG: (a) có việc quá hạn · (b) sprint còn ≤ 2 ngày mà còn ≥ 40% điểm cam kết · (c) rủi ro mở mức Cao (13–19) ·
 *       (d) còn việc chưa xong nhưng 14 ngày qua không việc nào hoàn tất.
 * XANH: ngược lại. NONE: dự án chưa có công việc nào.
 */
export const HEALTH_RED_OVERDUE_RATIO = 0.25;
export const HEALTH_RED_OVERDUE_MIN = 2;
export const HEALTH_SPRINT_NEAR_DAYS = 2;
export const HEALTH_SPRINT_REMAINING_RATIO = 0.4;
export const HEALTH_STALL_DAYS = 14;

const DAY_MS = 86_400_000;

export interface ProjectHealthInput {
  /** Tổng số công việc (chưa xoá). */
  total: number;
  /** Số việc chưa ở nhóm trạng thái Hoàn thành. */
  open: number;
  /** Số việc chưa xong và đã quá hạn. */
  overdue: number;
  activeSprint: {
    name: string;
    endDate: Date | null;
    remainingPoints: number;
    committedPoints: number;
  } | null;
  /** Rủi ro/vướng mắc RAID đang mở (status OPEN). */
  openRisks: Array<{ title: string; probability: number; impact: number }>;
  /** Lần hoàn tất việc gần nhất (null = chưa từng). */
  lastResolvedAt: Date | null;
  now: Date;
  /** Ngày tạo dự án — dự án chưa đủ 14 ngày tuổi không bị coi là "đình trệ". Bỏ qua = luôn xét. */
  createdAt?: Date;
}

export interface ProjectHealthAuto {
  level: ProjectHealthLevel;
  reasons: string[];
}

const dayStart = (d: Date): number => Date.parse(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);

export function computeProjectHealth(input: ProjectHealthInput): ProjectHealthAuto {
  const { total, open, overdue, activeSprint, openRisks, lastResolvedAt, now, createdAt } = input;
  if (total === 0) return { level: 'NONE', reasons: ['Dự án chưa có công việc nào'] };

  const red: string[] = [];
  const yellow: string[] = [];

  if (overdue > 0) {
    const text = `${overdue}/${open} việc chưa xong đang quá hạn`;
    if (overdue >= HEALTH_RED_OVERDUE_MIN && overdue / open >= HEALTH_RED_OVERDUE_RATIO)
      red.push(text);
    else yellow.push(text);
  }

  if (activeSprint?.endDate) {
    const daysLeft = Math.round((dayStart(activeSprint.endDate) - dayStart(now)) / DAY_MS);
    if (daysLeft < 0 && activeSprint.remainingPoints > 0) {
      red.push(
        `${activeSprint.name} trễ ${-daysLeft} ngày, còn ${activeSprint.remainingPoints} điểm`,
      );
    } else if (
      daysLeft >= 0 &&
      daysLeft <= HEALTH_SPRINT_NEAR_DAYS &&
      activeSprint.committedPoints > 0 &&
      activeSprint.remainingPoints / activeSprint.committedPoints >= HEALTH_SPRINT_REMAINING_RATIO
    ) {
      yellow.push(
        `${activeSprint.name} còn ${daysLeft} ngày, còn ${activeSprint.remainingPoints}/${activeSprint.committedPoints} điểm chưa xong`,
      );
    }
  }

  for (const r of openRisks) {
    const { level, levelLabel } = raidLevel(r.probability * r.impact);
    if (level === 'CRITICAL') red.push(`Rủi ro '${r.title}' mức ${levelLabel}`);
    else if (level === 'HIGH') yellow.push(`Rủi ro '${r.title}' mức ${levelLabel}`);
  }

  const stallSince = now.getTime() - HEALTH_STALL_DAYS * DAY_MS;
  const youngProject = createdAt ? createdAt.getTime() > stallSince : false;
  if (open > 0 && !youngProject && (!lastResolvedAt || lastResolvedAt.getTime() <= stallSince)) {
    yellow.push(
      `${HEALTH_STALL_DAYS} ngày qua không có việc nào hoàn tất trong khi còn ${open} việc chưa xong`,
    );
  }

  if (red.length > 0) return { level: 'RED', reasons: [...red, ...yellow] };
  if (yellow.length > 0) return { level: 'YELLOW', reasons: yellow };
  return { level: 'GREEN', reasons: [] };
}
