import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type { NotificationFilter, NotificationPayload } from '@tirapro/shared';
import type { ListResponse } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { isUnreadInPages, markAllReadInPages, markReadInPages } from './pages';

/** Loại thông báo trả về từ API. */
export type NotificationType =
  | 'ISSUE_ASSIGNED'
  | 'ISSUE_UPDATED'
  | 'MENTIONED'
  | 'COMMENT_ADDED'
  | 'STATUS_CHANGED'
  | 'SPRINT_STARTED'
  | 'SPRINT_COMPLETED'
  | 'WATCHING_UPDATE';

/** Một dòng thông báo (DTO từ `GET /notifications`). */
export interface NotificationItem {
  id: string;
  type: NotificationType;
  issueId: string | null;
  commentId: string | null;
  actorId: string | null;
  payload: NotificationPayload;
  readAt: string | null;
  createdAt: string;
}

// Thông báo mới đến qua WebSocket (`notification:new` → useNotificationRealtime ở AppShell).
// Poll 5 phút chỉ là lưới an toàn khi WS đứt. refetchIntervalInBackground=false → KHÔNG fetch khi tab nền.
const POLL_MS = 5 * 60_000;

/** Danh sách thông báo gần đây (bọc envelope → `.data.data`), lưới an toàn 5 phút (chỉ khi tab hiển thị). */
export function useNotifications() {
  return useQuery({
    queryKey: keys.notifications.list,
    queryFn: async () =>
      (await api.get<ListResponse<NotificationItem>>('/notifications?limit=20')).data.data,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });
}

type NotificationsPage = ListResponse<NotificationItem>;
const PAGE_SIZE = 30;

/** Trang /notifications: danh sách lọc phía API, phân trang cursor ("Tải thêm"). */
export function useNotificationsPage(filter: NotificationFilter) {
  return useInfiniteQuery({
    queryKey: keys.notifications.page(filter),
    queryFn: async ({ pageParam }) =>
      (
        await api.get<NotificationsPage>('/notifications', {
          params: { filter, limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) },
        })
      ).data,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      'hasNextPage' in last.pageInfo && last.pageInfo.hasNextPage
        ? (last.pageInfo.endCursor ?? undefined)
        : undefined,
  });
}

/** Số thông báo chưa đọc (raw `{ count }`), lưới an toàn 5 phút (chỉ khi tab hiển thị). */
export function useUnreadCount() {
  return useQuery({
    queryKey: keys.notifications.unread,
    queryFn: async () =>
      (await api.get<{ count: number }>('/notifications/unread-count')).data.count,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });
}

/** Đánh dấu một thông báo là đã đọc — cập nhật lạc quan, rollback nếu lỗi. */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onMutate: async (id: string) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: keys.notifications.list }),
        qc.cancelQueries({ queryKey: keys.notifications.unread }),
        qc.cancelQueries({ queryKey: keys.notifications.pageRoot }),
      ]);
      const prevList = qc.getQueryData<NotificationItem[]>(keys.notifications.list);
      const prevUnread = qc.getQueryData<number>(keys.notifications.unread);
      const prevPages = qc.getQueriesData<InfiniteData<NotificationsPage>>({
        queryKey: keys.notifications.pageRoot,
      });
      const now = new Date().toISOString();
      // Chỉ giảm số chưa đọc nếu item này trước đó thực sự chưa đọc (ở chuông hoặc ở trang đầy đủ).
      const wasUnread =
        (prevList?.some((n) => n.id === id && n.readAt === null) ?? false) ||
        prevPages.some(([, d]) => isUnreadInPages(d, id));
      qc.setQueryData<NotificationItem[]>(keys.notifications.list, (old) =>
        old?.map((n) => (n.id === id && n.readAt === null ? { ...n, readAt: now } : n)),
      );
      qc.setQueriesData<InfiniteData<NotificationsPage>>(
        { queryKey: keys.notifications.pageRoot },
        (old) => markReadInPages(old, id, now),
      );
      if (wasUnread) {
        qc.setQueryData<number>(keys.notifications.unread, (c) => Math.max(0, (c ?? 0) - 1));
      }
      return { prevList, prevUnread, prevPages };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prevList !== undefined) qc.setQueryData(keys.notifications.list, ctx.prevList);
      if (ctx?.prevUnread !== undefined) qc.setQueryData(keys.notifications.unread, ctx.prevUnread);
      ctx?.prevPages.forEach(([key, d]) => qc.setQueryData(key, d));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.notifications.list });
      void qc.invalidateQueries({ queryKey: keys.notifications.unread });
      void qc.invalidateQueries({ queryKey: keys.notifications.pageRoot });
    },
  });
}

/** Đánh dấu tất cả là đã đọc — cập nhật lạc quan, rollback nếu lỗi. */
export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onMutate: async () => {
      await Promise.all([
        qc.cancelQueries({ queryKey: keys.notifications.list }),
        qc.cancelQueries({ queryKey: keys.notifications.unread }),
        qc.cancelQueries({ queryKey: keys.notifications.pageRoot }),
      ]);
      const prevList = qc.getQueryData<NotificationItem[]>(keys.notifications.list);
      const prevUnread = qc.getQueryData<number>(keys.notifications.unread);
      const prevPages = qc.getQueriesData<InfiniteData<NotificationsPage>>({
        queryKey: keys.notifications.pageRoot,
      });
      const now = new Date().toISOString();
      qc.setQueryData<NotificationItem[]>(keys.notifications.list, (old) =>
        old?.map((n) => (n.readAt === null ? { ...n, readAt: now } : n)),
      );
      qc.setQueriesData<InfiniteData<NotificationsPage>>(
        { queryKey: keys.notifications.pageRoot },
        (old) => markAllReadInPages(old, now),
      );
      qc.setQueryData<number>(keys.notifications.unread, 0);
      return { prevList, prevUnread, prevPages };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevList !== undefined) qc.setQueryData(keys.notifications.list, ctx.prevList);
      if (ctx?.prevUnread !== undefined) qc.setQueryData(keys.notifications.unread, ctx.prevUnread);
      ctx?.prevPages.forEach(([key, d]) => qc.setQueryData(key, d));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.notifications.list });
      void qc.invalidateQueries({ queryKey: keys.notifications.unread });
      void qc.invalidateQueries({ queryKey: keys.notifications.pageRoot });
    },
  });
}
