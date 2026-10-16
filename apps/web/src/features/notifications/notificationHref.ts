import type { NotificationPayload } from '@tirapro/shared';

/**
 * Đích khi bấm một thông báo: thông báo gộp nhiều việc (vd "Bạn được giao N việc từ nhập Jira") mở DANH SÁCH các việc
 * (bộ lọc theo JQL của thông báo); còn lại mở công việc liên quan. null = không có đích.
 */
export function notificationHref(payload: NotificationPayload | null | undefined): string | null {
  if (payload?.bulk && payload.listJql)
    return `/filters?jql=${encodeURIComponent(payload.listJql)}`;
  return payload?.key ? `/issue/${payload.key}` : null;
}
