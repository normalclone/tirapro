import type { InfiniteData } from '@tanstack/react-query';
import type { NotificationItem } from './api';

/** Một trang của danh sách thông báo phân trang cursor (chỉ phần mà hàm vá cache cần). */
type Page = { data: NotificationItem[] };

function mapItems<P extends Page>(
  data: InfiniteData<P> | undefined,
  fn: (n: NotificationItem) => NotificationItem,
): InfiniteData<P> | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((p) => ({ ...p, data: p.data.map(fn) })) };
}

/** Đánh dấu đã đọc một dòng (chỉ khi đang chưa đọc — không ghi đè thời điểm đã có). */
export function markReadInPages<P extends Page>(
  data: InfiniteData<P> | undefined,
  id: string,
  at: string,
): InfiniteData<P> | undefined {
  return mapItems(data, (n) => (n.id === id && n.readAt === null ? { ...n, readAt: at } : n));
}

/** Đánh dấu đã đọc mọi dòng chưa đọc đang có trong cache. */
export function markAllReadInPages<P extends Page>(
  data: InfiniteData<P> | undefined,
  at: string,
): InfiniteData<P> | undefined {
  return mapItems(data, (n) => (n.readAt === null ? { ...n, readAt: at } : n));
}

/** Dòng `id` có đang nằm trong cache và còn chưa đọc không (để giảm huy hiệu đúng một lần). */
export function isUnreadInPages<P extends Page>(
  data: InfiniteData<P> | undefined,
  id: string,
): boolean {
  return data?.pages.some((p) => p.data.some((n) => n.id === id && n.readAt === null)) ?? false;
}

/** Danh sách phẳng của popover chuông: đánh dấu đã đọc một dòng (chỉ khi đang chưa đọc). */
export function markReadInList(
  items: NotificationItem[] | undefined,
  id: string,
  at: string,
): NotificationItem[] | undefined {
  return items?.map((n) => (n.id === id && n.readAt === null ? { ...n, readAt: at } : n));
}

/** Danh sách phẳng của popover: đánh dấu đã đọc mọi dòng chưa đọc. */
export function markAllReadInList(
  items: NotificationItem[] | undefined,
  at: string,
): NotificationItem[] | undefined {
  return items?.map((n) => (n.readAt === null ? { ...n, readAt: at } : n));
}

/** Dòng `id` có trong danh sách phẳng và còn chưa đọc không. */
export function isUnreadInList(items: NotificationItem[] | undefined, id: string): boolean {
  return items?.some((n) => n.id === id && n.readAt === null) ?? false;
}
