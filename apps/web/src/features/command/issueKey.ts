/**
 * Nhận dạng mã công việc người dùng gõ vào Cmd+K để nhảy thẳng tới `/issue/:key`.
 * Chấp nhận cả hai kiểu mã: Tirapro `DEMO-BUG-1` và Jira gốc `JRA-1` — khoá dự án Jira được phép có `_` (`MY_APP-12`).
 */
export const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]*(?:-[A-Z0-9]+)+$/;

/** Mã chuẩn hoá (HOA) nếu `raw` đúng dạng mã công việc, ngược lại `null`. */
export function guessIssueKey(raw: string): string | null {
  const key = raw.trim().toUpperCase();
  return ISSUE_KEY_RE.test(key) ? key : null;
}
