import type { PermissionKey } from '@tirapro/types';

/** Khớp `RETRACT_WINDOW_MS` của API (10 phút). Chỉ để ước lượng hiển thị — server luôn là bên quyết. */
const RETRACT_WINDOW_MIN = 10;

/** Số phút còn lại để thu hồi (làm tròn lên); 0 khi quá hạn hoặc `createdAt` không hợp lệ. */
export function retractMinutesLeft(createdAt: string, now: Date = new Date()): number {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return 0;
  const left = RETRACT_WINDOW_MIN * 60_000 - (now.getTime() - created);
  return left > 0 ? Math.ceil(left / 60_000) : 0;
}

/**
 * Hiện mục "Thu hồi công việc" khi: là người báo/tạo (assignee thì không), còn trong hạn, và KHÔNG có `issue:delete`
 * (đã có mục "Xoá công việc" không giới hạn thời gian).
 */
export function canRetract(
  issue: { reporterId: string | null; createdById: string | null; createdAt: string },
  meId: string | undefined,
  can: (perm: PermissionKey) => boolean,
  now: Date = new Date(),
): boolean {
  if (!meId) return false;
  if (issue.reporterId !== meId && issue.createdById !== meId) return false;
  if (can('issue:delete')) return false;
  return retractMinutesLeft(issue.createdAt, now) > 0;
}
