import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { isModifiedClick } from '@/lib/rowOpen';
import { cn } from '@/lib/utils';
import { LINK_TOUCH_HIT } from '@/lib/touchHit';

export function IssueKeyLink({
  issueKey,
  onPeek,
  className,
  children,
}: {
  issueKey: string;
  onPeek: (key: string) => void;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Link
      to={`/issue/${issueKey}`}
      draggable={false}
      title={`Mã công việc ${issueKey} — bấm để xem nhanh, Cmd/Ctrl+bấm để mở tab mới`}
      className={cn(
        'shrink-0 font-mono text-xs text-muted hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        LINK_TOUCH_HIT,
        className,
      )}
      onClick={(e) => {
        if (isModifiedClick(e)) return; // Link tự xử lý (tab mới)
        e.preventDefault();
        e.stopPropagation();
        onPeek(issueKey);
      }}
    >
      {children ?? issueKey}
    </Link>
  );
}
