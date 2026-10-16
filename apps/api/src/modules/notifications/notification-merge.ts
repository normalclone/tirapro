import type { NotificationType } from '@prisma/client';
import type { NotificationPayload } from '@tirapro/shared';

/** Các thông báo cùng (người nhận, công việc, loại) chưa đọc trong cửa sổ này được gộp thành một dòng. */
export const COALESCE_WINDOW_MS = 60_000;

/** Chỉ gộp loại "ồn"; MENTIONED/ISSUE_ASSIGNED là tín hiệu riêng, mỗi lần trỏ đúng một nơi. */
export const COALESCE_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'COMMENT_ADDED',
  'STATUS_CHANGED',
  'ISSUE_UPDATED',
  'WATCHING_UPDATE',
]);

const MAX_ACTORS = 20;

/** Gộp payload mới vào dòng đang có: cộng `count`, khử trùng người, lấy giá trị mới nhất, giữ "từ" đầu tiên. */
export function mergeNotificationPayload(
  prev: NotificationPayload,
  next: NotificationPayload,
): NotificationPayload {
  const seen = new Set((prev.actors ?? []).map((a) => a.id));
  const actors = [...(prev.actors ?? [])];
  for (const a of next.actors ?? []) {
    if (!seen.has(a.id) && actors.length < MAX_ACTORS) {
      seen.add(a.id);
      actors.push(a);
    }
  }
  return {
    ...prev,
    ...next,
    count: (prev.count ?? 1) + (next.count ?? 1),
    actors,
    excerpt: next.excerpt ?? prev.excerpt,
    fromStatusName: prev.fromStatusName ?? next.fromStatusName,
  };
}
