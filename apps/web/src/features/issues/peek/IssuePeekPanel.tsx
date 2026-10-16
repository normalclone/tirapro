import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ExternalLink, Hash, X } from 'lucide-react';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { DelayedSpinner, EmptyState } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { useCanEditIssue, useCanIn } from '@/features/projects/permissions';
import {
  IssuePeoplePanel,
  IssuePrioritySelect,
  IssueSprintSubtitle,
  IssueStoryPointsInline,
  IssueTypeSelect,
} from '@/features/issue-edit/IssueProperties';
import { EpicParentField } from '@/features/issue-meta/EpicParentField';
import { IssueDescription } from '@/features/issue-edit/DescriptionEditor';
import { ChecklistPanel } from '@/features/issue-extras/ChecklistPanel';
import { LinksPanel } from '@/features/issue-widgets/LinksPanel';
import { IssueRelations } from '@/features/tree/IssueRelations';
import { activeDrag } from '@/lib/activeDrag';
import { hasDraftText, isOverlayOpen, shouldClosePeekOnEscape } from '@/lib/hotkeys';
import { useIssue } from '../api';
import { ActivityTabs } from '../ActivityTabs';
import { LazyPanel } from '../LazyPanel';
import { useIssueTransitions } from '../useIssueTransitions';
import { InlineSummary } from './InlineSummary';

const CATEGORY_COLOR: Record<string, string> = {
  TODO: 'var(--status-todo)',
  IN_PROGRESS: 'var(--status-progress)',
  DONE: 'var(--status-done)',
};

/**
 * Xem nhanh công việc ở cột phải — KHÔNG modal (không focus-trap, không lớp phủ) để bấm hết dòng này sang dòng khác.
 * Cột tĩnh 30rem ở `lg+`; ngăn kéo phủ phải ở màn nhỏ — cùng một `<aside>` bằng CSS.
 */
export function IssuePeekPanel({ issueKey, onClose }: { issueKey: string; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const keyRef = useRef(issueKey);
  keyRef.current = issueKey;

  // Esc đóng panel (nghe ở `window`, sau `document`): lớp phủ mở → nhường; Esc đã có người dùng (bỏ chọn hàng loạt,
  // huỷ sửa tại chỗ) → bỏ qua; Esc từ ô nhập TRONG panel đang có chữ chưa gửi (bình luận, bước checklist, liên kết…)
  // → chỉ rời ô (nháp còn nguyên vì panel không bị gỡ), Esc kế tiếp mới đóng.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const draftFocused = !!t?.closest?.('[data-peek-panel]') && hasDraftText(t);
      const dragging = activeDrag.get() !== null;
      const overlayOpen = isOverlayOpen();
      if (shouldClosePeekOnEscape(e, { overlayOpen, draftFocused, dragging })) {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Escape' && draftFocused && !e.defaultPrevented && !overlayOpen) {
        e.preventDefault();
        t?.blur();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Focus: mở → vào khung panel; đóng → về dòng đang xem nếu còn trong DOM (dòng ảo hoá đã gỡ thì thôi).
  // Chỉ lúc mount/unmount, không mỗi lần đổi `issueKey`.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    return () => {
      document
        .querySelector<HTMLElement>(`[data-issue-key="${CSS.escape(keyRef.current)}"]`)
        ?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <aside
      ref={ref}
      tabIndex={-1}
      data-peek-panel
      role="complementary"
      aria-label={`Xem nhanh ${issueKey}`}
      className="fixed inset-y-0 right-0 z-sticky flex w-full max-w-[30rem] flex-col border-l border-border bg-surface shadow-lg outline-none duration-base animate-in slide-in-from-right lg:static lg:z-auto lg:w-[30rem] lg:max-w-none lg:shrink-0 lg:shadow-none"
    >
      <PeekHeader issueKey={issueKey} onClose={onClose} />
      <PeekBody key={issueKey} issueKey={issueKey} onClose={onClose} />
    </aside>
  );
}

function PeekHeader({ issueKey, onClose }: { issueKey: string; onClose: () => void }) {
  function copyKey() {
    navigator.clipboard
      ?.writeText(issueKey)
      .then(() => toast.success(`Đã sao chép mã ${issueKey}`))
      .catch(() => toast.error('Trình duyệt chặn sao chép — hãy chép thủ công mã công việc.'));
  }
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2">
      <span className="font-mono text-xs text-muted">{issueKey}</span>
      <button
        type="button"
        onClick={copyKey}
        title={`Sao chép mã công việc (${issueKey})`}
        aria-label="Sao chép mã công việc"
        className="grid h-6 w-6 shrink-0 place-items-center rounded text-faint transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        <Hash className="h-3.5 w-3.5" />
      </button>
      <Link
        to={`/issue/${issueKey}`}
        title="Mở trang đầy đủ của công việc này. Phím tắt (1-9, i, y, w) chỉ có trên trang đầy đủ."
        className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-primary transition-colors hover:bg-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        Mở trang <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      </Link>
      <button
        type="button"
        onClick={onClose}
        title="Đóng (Esc)"
        aria-label="Đóng xem nhanh"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function PeekBody({ issueKey, onClose }: { issueKey: string; onClose: () => void }) {
  const { data: issue, isLoading, isError } = useIssue(issueKey);
  if (isError)
    return (
      <div className="p-4">
        <EmptyState
          title={`Không mở được công việc ${issueKey}`}
          description="Công việc không còn tồn tại, hoặc bạn chưa được cấp quyền xem."
          action={
            <Button variant="secondary" size="sm" onClick={onClose}>
              Đóng
            </Button>
          }
        />
      </div>
    );
  if (isLoading || !issue) return <DelayedSpinner />;
  return <PeekContent issue={issue} />;
}

function PeekContent({ issue }: { issue: IssueDto }) {
  const can = useCanIn(issue.projectId);
  const canEditThis = useCanEditIssue(issue.projectId)(issue);
  const { nextStatuses, requestTransition, dialog, isPending } = useIssueTransitions(issue);
  const [tab, setTab] = useState<'comments' | 'history'>('comments');
  const canTransition = can('issue:transition');

  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-24 pt-4">
      <div className="flex items-start gap-2">
        <div className="mt-1 flex shrink-0 items-center gap-1.5">
          <IssueTypeSelect issue={issue} />
          <IssuePrioritySelect issue={issue} />
        </div>
        <InlineSummary issue={issue} />
      </div>

      {/* Trạng thái hiện tại + các bước kế tiếp theo quy trình */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-sm font-medium text-ink"
          title="Trạng thái hiện tại của công việc"
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: CATEGORY_COLOR[issue.status.category] ?? 'var(--faint)' }}
            aria-hidden
          />
          {issue.status.name}
        </span>
        {canTransition && nextStatuses.length > 0 && (
          <>
            <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
            {nextStatuses.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={isPending}
                onClick={() => requestTransition(o.id)}
                title={`Chuyển sang “${o.name}”`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-sm font-medium text-ink transition-colors hover:border-primary hover:bg-primary-subtle hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: CATEGORY_COLOR[o.category] ?? 'var(--faint)' }}
                  aria-hidden
                />
                {o.name}
              </button>
            ))}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <IssueSprintSubtitle issue={issue} />
        <span className="text-faint" aria-hidden>
          ·
        </span>
        <IssueStoryPointsInline issue={issue} canEdit={canEditThis} />
      </div>

      <EpicParentField issue={issue} />

      <IssuePeoplePanel issue={issue} />

      <div>
        <p className="mb-1.5 text-sm font-medium text-muted">Mô tả</p>
        <IssueDescription issue={issue} />
      </div>

      <LazyPanel>
        <ChecklistPanel issueId={issue.id} projectId={issue.projectId} owner={issue} />
      </LazyPanel>
      <IssueRelations issue={issue} />
      <LazyPanel minHeight={64}>
        <LinksPanel issueId={issue.id} canEdit={canEditThis} />
      </LazyPanel>
      <LazyPanel minHeight={160}>
        <ActivityTabs issue={issue} tab={tab} onTab={setTab} />
      </LazyPanel>
      {dialog}
    </div>
  );
}
