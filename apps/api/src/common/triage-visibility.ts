import type { Prisma } from '@prisma/client';

/**
 * Việc chưa duyệt (chờ/tạm hoãn/đã từ chối ở "Việc mới vào") không lẫn vào Board / Việc chờ / số đếm sprint:
 * chỉ lấy việc không đi qua Triage (null) hoặc đã được Nhận. MỘT điểm chung cho `IssuesService.list`, board có
 * `filterJql` (qua `SearchService.search` + `excludeUntriaged`) và đếm sprint. JQL/Cmd+K thông thường KHÔNG dùng
 * bộ lọc này: người báo vẫn tìm lại được việc của mình (Q15).
 */
export const TRIAGE_VISIBLE: Prisma.IssueWhereInput = {
  OR: [{ triageState: null }, { triageState: 'ACCEPTED' }],
};
