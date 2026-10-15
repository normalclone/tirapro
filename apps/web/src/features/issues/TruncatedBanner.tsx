import { ISSUE_LIST_HARD_CAP, useIssueListTruncated } from './api';

/** Báo khi danh sách việc của dự án chạm trần nạp — phần còn lại không hiện trên Board/Backlog. */
export function TruncatedBanner({ projectId }: { projectId: string | undefined }) {
  const meta = useIssueListTruncated(projectId);
  if (!meta) return null;
  return (
    <div role="status" className="shrink-0 border-b border-border bg-warning/10 px-4 py-2 text-sm text-ink">
      Danh sách đã bị cắt ở {meta.loaded.toLocaleString('vi-VN')} việc (tối đa {ISSUE_LIST_HARD_CAP.toLocaleString('vi-VN')}) — hãy dùng bộ lọc để thu hẹp.
    </div>
  );
}
