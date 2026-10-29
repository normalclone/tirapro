import type { IssueDto } from '@tirapro/types';

/**
 * Bảng có bộ lọc JQL lấy TẬP việc từ máy chủ (`byBoard`) nhưng kéo-thả chỉ vá/ghi cache dự án (`byProject`).
 * Nên lấy bản MỚI NHẤT của từng việc (rank, trạng thái, sprint…) từ cache dự án — thứ tự trong cột là sắp theo rank
 * của bản này, không theo thứ tự (cũ) của danh sách lọc. Việc không còn trong cache dự án giữ bản của bảng.
 */
export function freshenBoardIssues(
  filtered: IssueDto[],
  project: IssueDto[] | undefined,
): IssueDto[] {
  const fresh = new Map((project ?? []).map((i) => [i.id, i]));
  return filtered.map((i) => fresh.get(i.id) ?? i);
}
