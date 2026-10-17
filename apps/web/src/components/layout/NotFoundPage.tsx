import { Link, useLocation } from 'react-router-dom';
import { StatusPanel } from '@/components/ui/StatusPanel';
import { buttonVariants } from '@/components/ui/Button';
import { suggestRoutes } from '@/lib/routeSuggest';
import { canSeeNav, NAV_RULES } from '@/lib/navAccess';
import { guessIssueKey } from '@/features/command/issueKey';
import { useAuth } from '@/stores/auth';

const SUGGEST_ROW =
  'flex min-h-11 items-center justify-between gap-3 rounded-md px-3 py-2 text-sm text-ink transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:fine)]:min-h-9';

/** Route `*` trong khung app (có sidebar/topbar): URL lạ → báo rõ + gợi ý trang gần đúng thay vì màn "Có lỗi". */
export function NotFoundPage() {
  const { pathname } = useLocation();
  const user = useAuth((s) => s.user);
  const permissions = useAuth((s) => s.permissions);
  const ctx = { isSystemAdmin: user?.isSystemAdmin === true, permissions };
  // `/connect` có luật quyền ở sidebar — không gợi ý trang người dùng không thấy trong menu.
  const suggestions = suggestRoutes(pathname).filter(
    (r) => r.path !== '/connect' || canSeeNav(NAV_RULES.connect, ctx),
  );
  const issueKey = guessIssueKey(pathname.replace(/^\/+/, ''));

  return (
    <StatusPanel
      variant="not-found"
      title="Không tìm thấy trang"
      description={
        <>
          Đường dẫn{' '}
          <code className="break-all rounded bg-surface-2 px-1 py-0.5 font-mono text-xs text-ink">
            {pathname}
          </code>{' '}
          không tồn tại hoặc đã được đổi.
        </>
      }
      actions={
        <Link to="/" className={buttonVariants({ variant: 'primary' })}>
          Về Tổng quan
        </Link>
      }
    >
      {(suggestions.length > 0 || issueKey) && (
        <div className="mt-6 text-left">
          <p className="px-3 text-sm font-medium text-ink-strong">Có phải bạn muốn:</p>
          <ul className="mt-1">
            {issueKey && (
              <li>
                <Link to={`/issue/${issueKey}`} className={SUGGEST_ROW}>
                  <span>
                    Mở công việc <span className="font-mono">{issueKey}</span>
                  </span>
                  <span className="font-mono text-xs text-faint">/issue/{issueKey}</span>
                </Link>
              </li>
            )}
            {suggestions.map((r) => (
              <li key={r.path}>
                <Link to={r.path} className={SUGGEST_ROW}>
                  <span>{r.label}</span>
                  <span className="font-mono text-xs text-faint">{r.path}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </StatusPanel>
  );
}
