import type { JiraImportSummary } from './api';

/**
 * Câu báo khi có việc được nhập nhưng bị bỏ gán vì người phụ trách trong Jira không khớp thành viên nào
 * (null khi không có) — để "Cảnh báo" của báo cáo không im lặng.
 */
export function unmatchedAssigneesNotice(
  s: Pick<JiraImportSummary, 'skippedAssignees' | 'unmatchedAssignees' | 'unmatchedAssigneesMore'>,
): string | null {
  const skipped = s.skippedAssignees ?? 0;
  if (skipped <= 0) return null;
  const names = (s.unmatchedAssignees ?? []).map((u) => u.name);
  const more = s.unmatchedAssigneesMore ?? 0;
  const who = names.length
    ? `: ${names.join(', ')}${more > 0 ? ` và ${more} người khác` : ''}`
    : '';
  return `${skipped} việc đã nhập nhưng chưa có người phụ trách vì người phụ trách trong Jira không khớp thành viên nào${who}. Hãy mời họ vào không gian làm việc rồi gán lại.`;
}
