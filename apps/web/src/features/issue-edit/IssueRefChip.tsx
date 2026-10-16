import { Link } from 'react-router-dom';
import { categoryColor } from '@/lib/statusColor';
import type { IssueRef } from './issueRefs';

/**
 * Chip công việc trong trang wiki: chấm nhóm trạng thái + mã + tiêu đề (tiêu đề ẩn ở màn hẹp), bấm mở công việc.
 * Chỉ dựng cho mã mà máy chủ đã xác nhận có thật và người đọc xem được.
 */
export function IssueRefChip({ issue }: { issue: IssueRef }) {
  return (
    <Link
      to={`/issue/${issue.key}`}
      title={`${issue.key} — ${issue.summary} · ${issue.statusName}`}
      className="inline-flex max-w-full items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 align-baseline text-[0.92em] text-ink transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: categoryColor(issue.statusCategory) }}
        aria-hidden
      />
      <span className="font-mono">{issue.key}</span>
      <span className="hidden max-w-[22ch] truncate text-muted sm:inline">{issue.summary}</span>
    </Link>
  );
}
