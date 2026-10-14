import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';


/** Một mục lịch sử thay đổi của issue. */
export interface ActivityItem {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  oldCategory: string | null;
  newCategory: string | null;
  pointsDelta: number | null;
  actor: { id: string; displayName: string; avatarUrl: string | null } | null;
  occurredAt: string;
}

/** Lịch sử hoạt động của issue (mới nhất trước — API trả desc). */
export function useIssueActivity(issueId?: string) {
  return useQuery({
    queryKey: keys.issues.activity(issueId ?? ''),
    queryFn: async () => (await api.get<ActivityItem[]>(`/issues/${issueId}/activity`)).data,
    enabled: !!issueId,
  });
}
