import { History, MessageSquare } from 'lucide-react';
import type { IssueDto } from '@tirapro/types';
import { ActivityPanel } from '@/features/activity/ActivityPanel';
import { CommentsSection } from '@/features/issue-edit/CommentsSection';
import { cn } from '@/lib/utils';

/** Khu hoạt động với tab Bình luận / Lịch sử (controlled). */
export function ActivityTabs({
  issue,
  tab,
  onTab,
}: {
  issue: IssueDto;
  tab: 'comments' | 'history';
  onTab: (t: 'comments' | 'history') => void;
}) {
  const tabCls = (active: boolean) =>
    cn(
      'flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm font-medium transition-colors',
      active ? 'border-primary text-ink-strong' : 'border-transparent text-muted hover:text-ink',
    );
  return (
    <div>
      <div className="mb-4 flex items-center gap-5 border-b border-border">
        <button
          type="button"
          className={tabCls(tab === 'comments')}
          onClick={() => onTab('comments')}
        >
          <MessageSquare className="h-4 w-4" /> Bình luận
        </button>
        <button
          type="button"
          className={tabCls(tab === 'history')}
          onClick={() => onTab('history')}
        >
          <History className="h-4 w-4" /> Lịch sử
        </button>
      </div>
      {tab === 'comments' ? (
        <CommentsSection issue={issue} />
      ) : (
        <ActivityPanel issueId={issue.id} />
      )}
    </div>
  );
}
