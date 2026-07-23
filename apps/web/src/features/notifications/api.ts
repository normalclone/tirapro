import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListResponse } from '@tirapro/types';
import { api } from '@/lib/api';

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
  payload: { key?: string; summary?: string };
  readAt: string | null;
  createdAt: string;
}

const listKey = ['notifications', 'list'] as const;
const unreadKey = ['notifications', 'unread'] as const;

// Poll 30s. refetchIntervalInBackground=false → KHÔNG fetch khi tab nền, nhưng timer vẫn sống
// và tự chạy lại khi quay lại tab (tránh bug refetchInterval=false xoá timer vĩnh viễn).
const POLL_MS = 30_000;

/** Danh sách thông báo gần đây (bọc envelope → `.data.data`), poll 30s (chỉ khi tab hiển thị). */
export function useNotifications() {
  return useQuery({
    queryKey: listKey,
    queryFn: async () =>
      (await api.get<ListResponse<NotificationItem>>('/notifications?limit=20')).data.data,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });
}

/** Số thông báo chưa đọc (raw `{ count }`), poll 30s (chỉ khi tab hiển thị). */
export function useUnreadCount() {
  return useQuery({
    queryKey: unreadKey,
    queryFn: async () => (await api.get<{ count: number }>('/notifications/unread-count')).data.count,
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
        qc.cancelQueries({ queryKey: listKey }),
        qc.cancelQueries({ queryKey: unreadKey }),
      ]);
      const prevList = qc.getQueryData<NotificationItem[]>(listKey);
      const prevUnread = qc.getQueryData<number>(unreadKey);
      const now = new Date().toISOString();
      // Chỉ giảm số chưa đọc nếu item này trước đó thực sự chưa đọc.
      const wasUnread = prevList?.some((n) => n.id === id && n.readAt === null) ?? false;
      qc.setQueryData<NotificationItem[]>(listKey, (old) =>
        old?.map((n) => (n.id === id && n.readAt === null ? { ...n, readAt: now } : n)),
      );
      if (wasUnread) {
        qc.setQueryData<number>(unreadKey, (c) => Math.max(0, (c ?? 0) - 1));
      }
      return { prevList, prevUnread };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prevList !== undefined) qc.setQueryData(listKey, ctx.prevList);
      if (ctx?.prevUnread !== undefined) qc.setQueryData(unreadKey, ctx.prevUnread);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: listKey });
      void qc.invalidateQueries({ queryKey: unreadKey });
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
        qc.cancelQueries({ queryKey: listKey }),
        qc.cancelQueries({ queryKey: unreadKey }),
      ]);
      const prevList = qc.getQueryData<NotificationItem[]>(listKey);
      const prevUnread = qc.getQueryData<number>(unreadKey);
      const now = new Date().toISOString();
      qc.setQueryData<NotificationItem[]>(listKey, (old) =>
        old?.map((n) => (n.readAt === null ? { ...n, readAt: now } : n)),
      );
      qc.setQueryData<number>(unreadKey, 0);
      return { prevList, prevUnread };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevList !== undefined) qc.setQueryData(listKey, ctx.prevList);
      if (ctx?.prevUnread !== undefined) qc.setQueryData(unreadKey, ctx.prevUnread);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: listKey });
      void qc.invalidateQueries({ queryKey: unreadKey });
    },
  });
}
