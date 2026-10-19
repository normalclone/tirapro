import { Link } from 'react-router-dom';
import { StatusPanel } from '@/components/ui/StatusPanel';
import { buttonVariants } from '@/components/ui/Button';
import { useQuickSearch } from '@/features/command/api';
import { similarIssues } from './similarIssues';

/**
 * Trang công việc khi máy chủ trả NOT_FOUND (mã không có / đã xoá / không đủ quyền xem — API không phân biệt).
 * Gợi ý lấy từ tìm nhanh (server đã lọc theo quyền), tối đa 3, loại chính `issueKey`; không có kết quả thì không hiện khối gợi ý.
 */
export function IssueNotFound({ issueKey }: { issueKey: string }) {
  const { data, isPlaceholderData } = useQuickSearch(issueKey);
  const similar = similarIssues(data, issueKey, isPlaceholderData);
  return (
    <StatusPanel
      variant="not-found"
      title={`Không tìm thấy công việc ${issueKey}`}
      description="Mã này không tồn tại, đã bị xoá, hoặc bạn chưa được cấp quyền xem."
      actions={
        <Link to="/" className={buttonVariants({ variant: 'primary' })}>
          Về Tổng quan
        </Link>
      }
    >
      {similar.length > 0 && (
        <div className="mt-6 text-left">
          <p className="px-3 text-sm font-medium text-ink-strong">Có phải bạn muốn:</p>
          <ul className="mt-1">
            {similar.map((i) => (
              <li key={i.id}>
                <Link
                  to={`/issue/${i.key}`}
                  className="flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm text-ink transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:fine)]:min-h-9"
                >
                  <span className="shrink-0 font-mono text-xs text-faint">{i.key}</span>
                  <span className="truncate">{i.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </StatusPanel>
  );
}
