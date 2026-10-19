export type IssueViewState = 'not-found' | 'error' | 'loading' | 'ready';

/**
 * Nhánh hiển thị của màn công việc theo trạng thái `useIssue`. `isError` của React Query v5 vẫn true khi refetch NỀN
 * thất bại dù `data` đã có — lỗi tạm thời (mạng) khi đó KHÔNG được gỡ nội dung đang hiện (mất bản nháp bình luận,
 * ô đang sửa). Chỉ NOT_FOUND mới thay nội dung (việc đã bị xoá); lỗi khác chỉ chặn khi chưa có dữ liệu.
 */
export function issueViewState(s: {
  isError: boolean;
  isLoading: boolean;
  hasData: boolean;
  notFound: boolean;
}): IssueViewState {
  if (s.isError && (!s.hasData || s.notFound)) return s.notFound ? 'not-found' : 'error';
  if (s.isLoading || !s.hasData) return 'loading';
  return 'ready';
}
