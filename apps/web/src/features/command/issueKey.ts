import { isIssueKey } from '@tirapro/shared';

/**
 * Nhận dạng mã công việc người dùng gõ vào Cmd+K để nhảy thẳng tới `/issue/:key`. Dùng chung regex với chip
 * markdown/`issueRefs` (`ISSUE_KEY_RE` của shared): mã Tirapro `DEMO-BUG-1` và mã Jira gốc `JRA-1`, `MY_APP-12`.
 */
export function guessIssueKey(raw: string): string | null {
  const key = raw.trim().toUpperCase();
  return isIssueKey(key) ? key : null;
}
