import { useMemo } from 'react';
import type { IssueDto } from '@tirapro/types';
import { useWatchers } from '@/features/issue-widgets/api';
import { useAuth } from '@/stores/auth';
import { commentAudience, type AudienceEntry, type AudiencePerson } from './commentAudience';

/**
 * Người sẽ nhận thông báo khi gửi `draft`. Watcher lấy một lần theo công việc (cache), phần còn lại tính thuần từ
 * `draft` — memo theo draft nên mỗi lần gõ chỉ chạy `extractMentionIds` trên chuỗi ngắn.
 */
export function useCommentAudience(
  issue: Pick<IssueDto, 'id' | 'assignee'>,
  draft: string,
  people: readonly AudiencePerson[],
  enabled = true,
): AudienceEntry[] {
  const meId = useAuth((s) => s.user?.id);
  const watchers = useWatchers(issue.id, enabled).data?.watchers;
  const assignee = issue.assignee;
  return useMemo(
    () => (enabled ? commentAudience({ draft, people, assignee, watchers, meId }) : []),
    [enabled, draft, people, assignee, watchers, meId],
  );
}
