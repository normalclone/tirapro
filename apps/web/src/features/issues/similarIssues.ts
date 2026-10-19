/**
 * Gợi ý "Có phải bạn muốn" ở trang công việc không tìm thấy: tối đa 3, loại chính `issueKey`. Dữ liệu giữ chỗ
 * (`isPlaceholder` — react-query giữ kết quả của mã TRƯỚC trong lúc tải mã mới) thì bỏ đi để không thoáng hiện gợi ý sai.
 */
export function similarIssues<T extends { key: string }>(
  data: readonly T[] | undefined,
  issueKey: string,
  isPlaceholder: boolean,
): T[] {
  if (isPlaceholder) return [];
  return (data ?? []).filter((i) => i.key !== issueKey).slice(0, 3);
}
