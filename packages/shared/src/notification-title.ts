import { z } from 'zod';
import type { NotificationType } from '@tirapro/types';

/**
 * Dữ liệu trong `Notification.payload`. Mọi trường đều tuỳ chọn: payload cũ (chỉ có key/summary)
 * vẫn dựng được câu, nên không cần migration dữ liệu.
 */
export interface NotificationPayload {
  key?: string;
  summary?: string;
  /** Người thực hiện — ảnh chụp tên lúc sự việc xảy ra. */
  actorName?: string;
  /** Khi gộp nhiều lần: danh sách người (khử trùng theo id). */
  actors?: { id: string; name: string }[];
  /** Số lần đã gộp, mặc định 1. */
  count?: number;
  /** ≤ 80 ký tự, thuần văn bản. */
  excerpt?: string;
  /** MENTIONED: nhắc ở bình luận hay mô tả. */
  where?: 'comment' | 'description';
  /** ISSUE_ASSIGNED gộp: nhiều việc được giao một lượt từ cùng một nguồn (vd nhập Jira) — một thông báo duy nhất. */
  bulk?: 'jira-import';
  /** JQL mở danh sách các việc của thông báo gộp (bấm thông báo → bộ lọc). */
  listJql?: string;
  /** STATUS_CHANGED. */
  statusName?: string;
  fromStatusName?: string;
}

const ANON = 'Hệ thống';

function who(p: NotificationPayload): string {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const a of p.actors ?? []) {
    if (seen.has(a.id) || !a.name) continue;
    seen.add(a.id);
    names.push(a.name);
  }
  if (names.length === 0) return p.actorName || ANON;
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} và ${names[1]}`;
  return `${names[0]}, ${names[1]} và ${names.length - 2} người khác`;
}

function distinctActors(p: NotificationPayload): number {
  return new Set((p.actors ?? []).map((a) => a.id)).size;
}

/** " 3 lần" khi đã gộp nhiều lần của (gần như) cùng một người; chuỗi rỗng nếu chỉ một lần hoặc nhiều người. */
function times(p: NotificationPayload): string {
  const count = p.count ?? 1;
  return count > 1 && distinctActors(p) <= 1 ? ` ${count} lần` : '';
}

/** Câu tiêu đề thông báo — nguồn chung cho chuông, trang /notifications và email. */
export function buildNotificationTitle(type: NotificationType, p: NotificationPayload): string {
  const key = p.key || 'một công việc';
  switch (type) {
    case 'STATUS_CHANGED': {
      const to = p.statusName;
      // Đã gộp nhiều lần mà về lại đúng trạng thái đầu (hoặc thiếu dữ liệu): ghi số lần thay vì "A → A".
      if ((p.count ?? 1) > 1 && (!to || p.fromStatusName === to))
        return `${who(p)} đổi trạng thái ${key} ${p.count} lần`;
      if (!to) return `${who(p)} đổi trạng thái ${key}`;
      return p.fromStatusName
        ? `${who(p)} chuyển ${key}: ${p.fromStatusName} → ${to}`
        : `${who(p)} chuyển ${key} sang ${to}`;
    }
    case 'COMMENT_ADDED':
      return `${who(p)} bình luận${times(p)} trong ${key}`;
    case 'MENTIONED':
      return p.where === 'description'
        ? `${who(p)} nhắc đến bạn trong mô tả của ${key}`
        : `${who(p)} nhắc đến bạn trong ${key}`;
    case 'ISSUE_ASSIGNED':
      if (p.bulk === 'jira-import') return `Bạn được giao ${p.count ?? 1} việc từ nhập Jira`;
      return `${who(p)} giao ${key} cho bạn`;
    case 'ISSUE_UPDATED':
      return `${who(p)} cập nhật ${key}${times(p)}`;
    case 'WATCHING_UPDATE':
      return `${who(p)} cập nhật ${key}${times(p)} (bạn đang theo dõi)`;
    default:
      return 'Có thông báo mới';
  }
}

/** Dòng phụ: trích đoạn nếu có, không thì tiêu đề công việc. */
export function notificationBody(_type: NotificationType, p: NotificationPayload): string {
  return p.excerpt || p.summary || '';
}

/** Bộ lọc danh sách thông báo (`GET /notifications?filter=`). Giá trị lạ hoặc thiếu → `all`. */
export const notificationFilterSchema = z
  .enum(['all', 'unread', 'mentioned', 'assigned'])
  .catch('all');
export type NotificationFilter = z.infer<typeof notificationFilterSchema>;
