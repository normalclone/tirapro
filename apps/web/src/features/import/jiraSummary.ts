import type { JiraImportSummary } from './api';

/**
 * Câu báo khi có việc được nhập nhưng chưa có người phụ trách (null khi không có) — để "Cảnh báo" của báo cáo không
 * im lặng. Hai nhóm: người đã nhớ email (L28: tự gán khi họ được thêm vào workspace — không phải cảnh báo mất người)
 * và người không khớp thành viên nào, không có email (cần thêm họ vào workspace rồi gán lại).
 */
export function unmatchedAssigneesNotice(
  s: Pick<
    JiraImportSummary,
    'skippedAssignees' | 'unmatchedAssignees' | 'unmatchedAssigneesMore' | 'rememberedAssignees'
  > & {
    /** Email do trình duyệt tự giữ (server không trả email trong kết quả job). */
    rememberedEmails?: string[];
    rememberedEmailsMore?: number;
  },
): string | null {
  const remembered = s.rememberedAssignees ?? 0;
  // `skippedAssignees` gồm cả việc đã nhớ email — phần còn lại mới là việc thật sự không có hướng gán.
  const skipped = Math.max(0, (s.skippedAssignees ?? 0) - remembered);
  const parts: string[] = [];
  if (skipped > 0) {
    const names = (s.unmatchedAssignees ?? []).map((u) => u.name);
    const more = s.unmatchedAssigneesMore ?? 0;
    const who = names.length
      ? `: ${names.join(', ')}${more > 0 ? ` và ${more} người khác` : ''}`
      : '';
    parts.push(
      `${skipped} việc đã nhập nhưng chưa có người phụ trách vì người phụ trách trong Jira không khớp thành viên nào${who}. Hãy thêm họ vào không gian làm việc rồi gán lại.`,
    );
  }
  if (remembered > 0) {
    const emails = s.rememberedEmails ?? [];
    const moreEmails = s.rememberedEmailsMore ?? 0;
    const who = emails.length
      ? `${emails.join(', ')}${moreEmails > 0 ? ` và ${moreEmails} email khác` : ''}`
      : 'họ';
    parts.push(
      `${remembered} việc chưa có người phụ trách — sẽ tự gán khi ${who} được thêm vào không gian làm việc.`,
    );
  }
  return parts.length ? parts.join(' ') : null;
}
