import type { NotificationFilter } from '@tirapro/shared';
import type { NotificationItem } from './api';

/** Ba tab của popover chuông — id là bộ lọc `GET /notifications?filter=`. ("Chưa đọc" chỉ có ở trang đầy đủ.) */
export type BellTab = Extract<NotificationFilter, 'all' | 'mentioned' | 'assigned'>;

export const BELL_TABS: readonly { id: BellTab; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'mentioned', label: 'Nhắc đến' },
  { id: 'assigned', label: 'Được giao' },
];

const EMPTY: Record<BellTab, string> = {
  all: 'Chưa có thông báo nào',
  mentioned: 'Chưa có ai nhắc đến bạn',
  assigned: 'Chưa có việc nào được giao cho bạn',
};

/** Câu cho trạng thái rỗng riêng của từng tab. */
export function bellEmptyText(tab: BellTab): string {
  return EMPTY[tab];
}

/** `/notifications?tab=<tab>` — "Xem tất cả" giữ ngữ cảnh tab đang chọn. */
export function notificationsHref(tab: BellTab): string {
  return `/notifications?tab=${tab}`;
}

/** Giá trị tab nhớ được → tab hợp lệ; lạ/thiếu → `all`. */
export function parseBellTab(raw: string | null | undefined): BellTab {
  return BELL_TABS.some((t) => t.id === raw) ? (raw as BellTab) : 'all';
}

/** Khoá theo người dùng — hai tài khoản dùng chung trình duyệt không lẫn tab (như rail/swimlane). */
export const bellTabKey = (userId: string) => `tirapro:bellTab:v1:${userId}`;

/** Tab dùng lần cuối (chưa biết người dùng / localStorage bị chặn hoặc ném lỗi → `all`). */
export function readBellTab(userId: string | null | undefined): BellTab {
  if (!userId) return 'all';
  try {
    return parseBellTab(window.localStorage.getItem(bellTabKey(userId)));
  } catch {
    return 'all';
  }
}

export function writeBellTab(userId: string | null | undefined, tab: BellTab): void {
  if (!userId) return;
  try {
    window.localStorage.setItem(bellTabKey(userId), tab);
  } catch {
    // trình duyệt chặn dữ liệu site: bỏ qua, tab chỉ không được nhớ
  }
}

/**
 * Người làm để vẽ avatar: cần `actorId` VÀ tên (đã được máy chủ điền khi đọc). Người đã xoá/không tên/hệ thống → null
 * (dùng ô icon). `avatarUrl` null khi chưa có ảnh hoặc API chưa trả trường `actorAvatarUrl` — Avatar tự rơi về chữ cái đầu.
 */
export function actorDisplay(
  item: Pick<NotificationItem, 'actorId' | 'payload' | 'actorAvatarUrl'>,
): { name: string; avatarUrl: string | null } | null {
  const name = item.payload?.actorName;
  if (!item.actorId || typeof name !== 'string' || !name.trim()) return null;
  return { name, avatarUrl: item.actorAvatarUrl ?? null };
}
