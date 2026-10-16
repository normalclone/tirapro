/**
 * Tiền tố mã issue theo LOẠI: BUG, TASK, STORY, EPIC, SUB.
 * Key = `${prefix}-${số thứ tự theo loại}` (vd BUG-1, TASK-3). Fallback từ tên nếu loại
 * không phải hệ thống (không có IssueTypeKey chuẩn).
 */
const PREFIX_BY_KEY: Record<string, string> = {
  EPIC: 'EPIC',
  STORY: 'STORY',
  TASK: 'TASK',
  BUG: 'BUG',
  SUBTASK: 'SUB',
};

export function issueTypePrefix(typeKey: string | null | undefined, typeName: string): string {
  if (typeKey && PREFIX_BY_KEY[typeKey]) return PREFIX_BY_KEY[typeKey];
  const fromName = (typeName || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 4)
    .toUpperCase();
  return fromName || 'ISSUE';
}

/**
 * Hai kiểu mã công việc cùng tồn tại (L27) và tách nhau về cấu trúc:
 * - Mã Tirapro `PROJ-TYPE-N`: luôn có ĐÚNG HAI dấu gạch ngang (khoá dự án và tiền tố loại không có `-`).
 * - Mã Jira `KEY-N` (nhập từ Jira, giữ nguyên mã gốc): ĐÚNG MỘT dấu gạch ngang. Khoá dự án Jira cho phép `_`.
 */
export const JIRA_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
export const TIRAPRO_KEY_RE = /^[A-Z][A-Z0-9]*-[A-Z0-9]+-\d+$/;
/** Cột `Issue.key` là text không giới hạn; đặt trần để mã nhập bất thường (rác) không thành mã công việc. */
export const MAX_JIRA_KEY_LENGTH = 40;

export function isJiraKey(s: string): boolean {
  return JIRA_KEY_RE.test(s);
}

export function isTiraproKey(s: string): boolean {
  return TIRAPRO_KEY_RE.test(s);
}

/** Chuẩn hoá mã Jira thô (trim, HOA); `null` nếu sai dạng `KEY-123` hoặc dài quá giới hạn. */
export function normalizeJiraKey(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toUpperCase();
  if (!key || key.length > MAX_JIRA_KEY_LENGTH) return null;
  return isJiraKey(key) ? key : null;
}
