import { skipToken, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

/** Một mục lịch sử thay đổi của issue. */
export interface ActivityItem {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  /** Nhãn đã phân giải ở máy chủ (người phụ trách → tên, sprint → tên); mô tả → bản xem trước. */
  oldLabel: string | null;
  newLabel: string | null;
  oldCategory: string | null;
  newCategory: string | null;
  pointsDelta: number | null;
  actor: { id: string; displayName: string; avatarUrl: string | null } | null;
  occurredAt: string;
  /** `true` (mô tả): oldValue/newValue chỉ là bản xem trước; bản đầy đủ lấy qua `useActivityDetail`. */
  hasDiff: boolean;
}

/** Một dòng lịch sử với giá trị đầy đủ (GET /issues/:id/activity/:activityId). */
export interface ActivityDetail {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  occurredAt: string;
  actor: ActivityItem['actor'];
}

/**
 * Lịch sử hoạt động của issue (mới nhất trước — API trả desc). `fields` = CSV `HistoryField` (lọc ở máy chủ vì
 * danh sách bị cắt 100 dòng); không truyền = tất cả. Khoá mở rộng từ `activity(issueId)` nên invalidate theo tiền tố vẫn trúng.
 */
export function useIssueActivity(issueId?: string, fields?: string) {
  return useQuery({
    queryKey: fields
      ? keys.issues.activityFiltered(issueId ?? '', fields)
      : keys.issues.activity(issueId ?? ''),
    queryFn: issueId
      ? async () =>
          (
            await api.get<ActivityItem[]>(`/issues/${issueId}/activity`, {
              params: fields ? { fields } : undefined,
            })
          ).data
      : skipToken,
    // Đổi chip lọc: giữ danh sách cũ (cùng công việc) cho tới khi bản lọc về — khỏi nháy "Chưa có hoạt động".
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[2] === issueId ? prev : undefined),
  });
}

/** Bản đầy đủ của một dòng lịch sử — chỉ tải khi `enabled` (mở hộp so sánh mô tả). */
export function useActivityDetail(
  issueId: string,
  activityId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: keys.issues.activityDetail(issueId, activityId ?? ''),
    queryFn:
      enabled && activityId
        ? async () =>
            (await api.get<ActivityDetail>(`/issues/${issueId}/activity/${activityId}`)).data
        : skipToken,
    // Dòng lịch sử bất biến → giữ lâu, mở lại hộp không tải lại.
    staleTime: Infinity,
  });
}
