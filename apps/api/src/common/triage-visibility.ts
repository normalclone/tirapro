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

/**
 * Việc còn ở hàng đợi duyệt / bị tạm hoãn / bị từ chối (`triageState` khác null và khác ACCEPTED): chưa "chính thức" vào
 * backlog nên chưa kích hoạt thông báo "được giao" và automation "khi tạo việc" — chúng chạy khi việc được Nhận.
 */
export function isUnreviewed(triageState: string | null | undefined): boolean {
  return !!triageState && triageState !== 'ACCEPTED';
}
