import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, ExternalLink, Hash, Link2, X } from 'lucide-react';
import type { IssueDto } from '@tirapro/types';
import { DelayedSpinner } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { StatusPanel } from '@/components/ui/StatusPanel';
import { apiErrorCode } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { useCanEditIssue, useCanIn } from '@/features/projects/permissions';
import {
  IssuePeoplePanel,
  IssuePrioritySelect,
  IssueResolutionSelect,
  IssueSeveritySelect,
  IssueSprintSubtitle,
  IssueStoryPointsInline,
  IssueTypeSelect,
} from '@/features/issue-edit/IssueProperties';
import { EpicParentField } from '@/features/issue-meta/EpicParentField';
import { IssueComponentsPicker } from '@/features/issue-meta/IssueComponentsPicker';
import { IssueDescription } from '@/features/issue-edit/DescriptionEditor';
import { ChecklistPanel } from '@/features/issue-extras/ChecklistPanel';
import { LinksPanel } from '@/features/issue-widgets/LinksPanel';
import { IssueRelations } from '@/features/tree/IssueRelations';
import { activeDrag } from '@/lib/activeDrag';
import { moveNavFocus } from '@/lib/listNav';
import { hasDraftText, isOverlayOpen, shouldClosePeekOnEscape } from '@/lib/hotkeys';
import { useIssue } from '../api';
import { useIssueCopy } from '../useIssueCopy';
import { issueViewState } from '../issueViewState';
import { ActivityTabs } from '../ActivityTabs';
import { LazyPanel } from '../LazyPanel';
import { useIssueTransitions } from '../useIssueTransitions';
import { IssueSummaryEdit } from '../IssueSummaryEdit';
import { PeekNavControls } from './PeekNavControls';
import { usePeekContext } from './PeekOrderContext';
import { usePeekPosition } from './usePeekPosition';
import { resolvePendingMore } from '@/lib/peekPosition';
import { PeekSheet } from './PeekSheet';
import { findPeekSource } from './peekSheetLogic';

const CATEGORY_COLOR: Record<string, string> = {
  TODO: 'var(--status-todo)',
  IN_PROGRESS: 'var(--status-progress)',
  DONE: 'var(--status-done)',
};

/**
 * Xem nhanh công việc. Từ `md` (768px): cột phải KHÔNG modal (không focus-trap, không lớp phủ) để bấm hết dòng này sang dòng
 * khác — cột tĩnh 30rem ở `lg+`, ngăn kéo phủ phải ở 768–1023px (cùng một `<aside>` bằng CSS). Dưới `md`: sheet đáy MODAL
 * 2 nấc (`PeekSheet`) — cùng nội dung/điều hướng ‹ ›; vì modal nên phím j/k tắt ở điện thoại.
 */
export function IssuePeekPanel({
  issueKey,
  onClose,
  onNavigate,
  sheet = false,
  open = true,
}: {
  issueKey: string;
  onClose: () => void;
  /** Dưới md (`PeekShell` quyết định theo `PEEK_DESKTOP_QUERY`): hiện sheet đáy modal thay cho `<aside>`. */
  sheet?: boolean;
  /** Chỉ sheet: `false` = đang chạy hiệu ứng đóng (cây còn giữ khoá cuối cùng). Panel phi-modal luôn được gỡ ngay khi đóng. */
  open?: boolean;
  /** Đổi sang việc khác (`useIssuePeek().open` — cùng hàm phím j/k gọi). Không truyền → không có nút ‹ › và "n/N". */
  onNavigate?: (key: string) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const keyRef = useRef(issueKey);
  keyRef.current = issueKey;
  const { listRef, order } = usePeekContext();
  const position = usePeekPosition(issueKey);
  // "Việc sau" ở dòng cuối phần đã nạp: nạp thêm rồi tự bước khi có dòng mới (khoá việc đang xem lúc bấm).
  const [awaiting, setAwaiting] = useState<string | null>(null);

  // Esc đóng panel (nghe ở `window`, sau `document`): lớp phủ mở → nhường; Esc đã có người dùng (bỏ chọn hàng loạt,
  // huỷ sửa tại chỗ) → bỏ qua; Esc từ ô nhập TRONG panel đang có chữ chưa gửi (bình luận, bước checklist, liên kết…)
  // → chỉ rời ô (nháp còn nguyên vì panel không bị gỡ), Esc kế tiếp mới đóng.
  useEffect(() => {
    // Sheet là modal: Esc do Radix xử lý (đóng/giữ nháp/nhường ô sửa tại chỗ), listener này không được đóng thêm lần nữa.
    if (sheet) return;
    function onKey(e: KeyboardEvent) {
      // Đang gõ bằng bộ gõ (IME Telex/VNI): Esc thuộc về bộ gõ, không blur ô/đóng panel.
      if (e.isComposing) return;
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
  }, [onClose, sheet]);

  // Việc đang xem đổi (bấm dòng, j/k, ‹ ›, quay lại): cuộn dòng/thẻ của nó vào khung CHỈ khi đang ngoài tầm nhìn (`nearest` không
  // làm gì nếu đã thấy; `scroll-behavior` do CSS reduced-motion quản, không ép cuộn mượt). Tìm TRONG khung danh sách của trang
  // (không phải mọi `[data-issue-key]` của tài liệu). Dòng chưa vẽ (ảo hoá, trang khác) → `reveal` của trang đưa nó vào.
  useEffect(() => {
    setAwaiting(null);
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-issue-key="${CSS.escape(issueKey)}"]`,
    );
    if (el) el.scrollIntoView({ block: 'nearest' });
    else order?.reveal?.(issueKey);
    // `order` chỉ để lấy `reveal` mới nhất; đổi thứ tự không được cuộn lại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey, listRef]);

  // Đã nạp thêm sau "Việc sau" ở cuối: bước sang dòng đầu của phần mới; nạp xong mà không thêm dòng (lỗi) → bỏ chờ để lần nạp
  // thủ công sau đó không tự bước. Chỉ đường bấm "Việc sau" mới đặt `awaiting`.
  useEffect(() => {
    if (!order || !onNavigate) return;
    const r = resolvePendingMore(awaiting, {
      peekKey: issueKey,
      keys: order.keys,
      loading: !!order.loadingMore,
    });
    if (r.action === 'step') {
      setAwaiting(null);
      onNavigate(r.next);
    } else if (r.action === 'cancel') setAwaiting(null);
  }, [order, issueKey, onNavigate, awaiting]);

  // Focus: mở → vào khung panel; đóng → về dòng đang xem nếu còn trong DOM (dòng ảo hoá đã gỡ thì thôi).
  // Chỉ lúc mount/unmount, không mỗi lần đổi `issueKey`.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    const list = listRef.current; // khung danh sách sống lâu hơn panel
    return () => {
      list
        ?.querySelector<HTMLElement>(`[data-issue-key="${CSS.escape(keyRef.current)}"]`)
        ?.focus({ preventScroll: true });
    };
  }, [listRef]);

  const nav = onNavigate && (
    <PeekNavControls
      position={position}
      busyNext={awaiting === issueKey}
      // CÙNG hàm với phím j/k (`useGlobalHotkeys`): đi từ việc đang xem, kẹp ở hai đầu, panel theo qua `onPeek`;
      // trang có thứ tự thật → bước theo nó (kể cả dòng chưa vẽ), cùng khung danh sách.
      onStep={(dir) => {
        if (dir === 1 && position?.needsLoadMore && order?.loadMore) {
          setAwaiting(issueKey);
          order.loadMore();
          return;
        }
        moveNavFocus(
          dir,
          {
            peekKey: issueKey,
            onPeek: onNavigate,
            fromPeek: true,
            focus: false,
            order: order ?? undefined,
          },
          listRef.current ?? document,
        );
      }}
    />
  );
  if (sheet)
    return (
      <PeekSheet
        issueKey={issueKey}
        open={open}
        onClose={onClose}
        returnFocus={() =>
          findPeekSource(listRef.current, keyRef.current)?.focus({ preventScroll: true })
        }
        header={<PeekHeader issueKey={issueKey} onClose={onClose} nav={nav} hideClose />}
      >
        <PeekBody key={issueKey} issueKey={issueKey} onClose={onClose} />
      </PeekSheet>
    );

  return (
    <aside
      ref={ref}
      tabIndex={-1}
      data-peek-panel
      role="complementary"
      aria-label={`Xem nhanh ${issueKey}`}
      className="fixed inset-y-0 right-0 z-sticky flex w-full max-w-[30rem] flex-col border-l border-border bg-surface shadow-lg outline-none duration-base animate-in slide-in-from-right lg:static lg:z-auto lg:w-[min(30rem,40vw)] lg:min-w-[20rem] lg:max-w-none lg:shrink-0 lg:shadow-none"
    >
      <PeekHeader issueKey={issueKey} onClose={onClose} nav={nav} />
      <PeekBody key={issueKey} issueKey={issueKey} onClose={onClose} />
    </aside>
  );
}

function PeekHeader({
  issueKey,
  onClose,
  nav,
  hideClose = false,
}: {
  issueKey: string;
  onClose: () => void;
  nav?: ReactNode;
  /** Sheet đáy có nút đóng riêng ở tay nắm (44px) — không lặp lại ở đây. */
  hideClose?: boolean;
}) {
  const { copyKey, copyLink, keyCopied, linkCopied } = useIssueCopy(issueKey);
  const copyBtn =
    'grid h-6 w-6 shrink-0 place-items-center rounded text-faint transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9';
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2">
      <span className="whitespace-nowrap font-mono text-xs text-muted">{issueKey}</span>
      <button
        type="button"
        onClick={copyKey}
        title={`Sao chép mã công việc (${issueKey})`}
        aria-label="Sao chép mã công việc"
        className={copyBtn}
      >
        {keyCopied ? (
          <Check className="h-3.5 w-3.5 text-success" aria-hidden />
        ) : (
          <Hash className="h-3.5 w-3.5" />
        )}
      </button>
      <button
        type="button"
        onClick={copyLink}
        title="Sao chép liên kết công việc. Dán vào chat hoặc email để chia sẻ."
        aria-label="Sao chép liên kết"
        className={copyBtn}
      >
        {linkCopied ? (
          <Check className="h-3.5 w-3.5 text-success" aria-hidden />
        ) : (
          <Link2 className="h-3.5 w-3.5" />
        )}
      </button>
      <span className="flex-1" aria-hidden />
      {nav}
      <Link
        to={`/issue/${issueKey}`}
        title="Mở trang đầy đủ của công việc này. Phím tắt (1-9, i, y, w) chỉ có trên trang đầy đủ."
        className="inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium text-primary [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 transition-colors hover:bg-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        {/* Màn hẹp (< sm): chỉ biểu tượng, nhường chỗ cho ‹ n/N ›; tên truy cập vẫn là "Mở trang". */}
        <span className="max-sm:sr-only">Mở trang</span>
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      </Link>
      {!hideClose && (
        <button
          type="button"
          onClick={onClose}
          title="Đóng (Esc)"
          aria-label="Đóng xem nhanh"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function PeekBody({ issueKey, onClose }: { issueKey: string; onClose: () => void }) {
  const { data: issue, isLoading, isError, error, refetch } = useIssue(issueKey);
  const view = issueViewState({
    isError,
    isLoading,
    hasData: !!issue,
    notFound: apiErrorCode(error) === 'NOT_FOUND',
  });
  if (view === 'not-found')
    return (
      <StatusPanel
        variant="not-found"
        headingLevel={2}
        title={`Không tìm thấy công việc ${issueKey}`}
        description="Mã này không còn tồn tại, hoặc bạn chưa được cấp quyền xem."
        className="py-10"
        actions={
          <Button variant="secondary" size="sm" onClick={onClose}>
            Đóng
          </Button>
        }
      />
    );
  if (view === 'error')
    return (
      <div className="p-4">
        <QueryError error={error} onRetry={() => void refetch()} />
      </div>
    );
  if (view === 'loading' || !issue) return <DelayedSpinner />;
  return <PeekContent issue={issue} />;
}

function PeekContent({ issue }: { issue: IssueDto }) {
  const can = useCanIn(issue.projectId);
  const canEditThis = useCanEditIssue(issue.projectId)(issue);
  const { nextStatuses, requestTransition, dialog, isPending } = useIssueTransitions(issue);
  const [tab, setTab] = useState<'comments' | 'history'>('comments');
  const canTransition = can('issue:transition');

  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-6 pt-4 lg:pb-24">
      <div className="flex items-start gap-2">
        <div className="mt-1 flex shrink-0 items-center gap-1.5">
          <IssueTypeSelect issue={issue} />
          <IssuePrioritySelect issue={issue} />
        </div>
        <IssueSummaryEdit
          key={issue.id}
          issue={issue}
          canEdit={canEditThis}
          as="h2"
          className="flex-1"
          textClassName="text-lg font-semibold leading-snug tracking-tight text-ink-strong"
          inputClassName="h-9 text-lg font-semibold tracking-tight"
          title="Bấm để sửa tiêu đề"
        />
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
                title={o.label !== o.name ? `${o.label} → “${o.name}”` : `Chuyển sang “${o.name}”`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-sm font-medium text-ink transition-colors hover:border-primary hover:bg-primary-subtle hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:border-transparent disabled:bg-disabled-bg disabled:text-disabled-fg"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: CATEGORY_COLOR[o.category] ?? 'var(--faint)' }}
                  aria-hidden
                />
                {o.label}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Như trang công việc: Mức nghiêm trọng (chỉ Bug) và Cách giải quyết (khi ở nhóm Done); không có gì thì không chiếm chỗ. */}
      <div className="flex flex-wrap items-center gap-1.5 empty:hidden">
        <IssueSeveritySelect issue={issue} />
        <IssueResolutionSelect issue={issue} />
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

      <IssueComponentsPicker issue={issue} />

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
