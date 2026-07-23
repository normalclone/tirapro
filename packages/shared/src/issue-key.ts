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
  const fromName = (typeName || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();
  return fromName || 'ISSUE';
}
