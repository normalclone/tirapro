import { memo, type CSSProperties, type HTMLAttributes, type Ref } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import type { IssueDto } from '@tirapro/types';
import { DueBadge, dueBorderClass } from '@/components/ui/DueBadge';
import { AcceptanceBadge } from '@/components/ui/AcceptanceBadge';
import { TaskProgress } from '@/components/ui/TaskProgress';
import { IssueTypeBadge } from '@/components/ui/IssueTypeBadge';
import { Avatar } from '@/components/ui/primitives';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { isBugType } from '@/features/issue-edit/severity';
import { cn } from '@/lib/utils';
import { useDropEdge } from '@/lib/dropHint';
import { SORT_TRANSITION } from '@/lib/sortableDnd';
import { sameProgress, type SubtreeProgress } from '@/lib/issueTree';
import { openOnRowKey } from '@/lib/rowOpen';
import { rowPeekProps } from '@/features/issues/peek/rowPeekProps';
import { IssueKeyLink } from '@/features/issues/peek/IssueKeyLink';

/** Roving focus giữa các card bằng phím mũi tên (theo data-lane/col/row). */
function focusCard(lane: number, col: number, row: number): boolean {
  const el = document.querySelector<HTMLElement>(
    `[data-board-card][data-lane="${lane}"][data-col="${col}"][data-row="${row}"]`,
  );
  if (el) {
    el.focus();
    return true;
  }
  return false;
}

/** Chip nhãn nhỏ trên card. */
const LabelChip = memo(function LabelChip({ name, color }: { name: string; color: string | null }) {
  const c = color || 'var(--faint)';
  return (
    <span
      className="max-w-[8rem] truncate rounded px-1.5 py-px text-[10px] font-medium"
      style={{ backgroundColor: `color-mix(in oklch, ${c} 16%, transparent)`, color: c }}
      title={`Nhãn: ${name}`}
    >
      {name}
    </span>
  );
});

/**
 * Phần giao diện thuần của thẻ — dùng cho cả thẻ kéo được (`Card`) lẫn bản trôi theo chuột (`DragOverlay`).
 * Bản overlay KHÔNG gọi `useSortable` để không đăng ký trùng id với thẻ gốc trong dnd-kit.
 */
export function CardBody({
  issue,
  progress,
  overlay,
  isDragging,
  canDrag = true,
  style,
  dropEdge,
  rootRef,
  rootProps,
  onOpenKey,
}: {
  issue: IssueDto;
  progress?: SubtreeProgress;
  overlay?: boolean;
  isDragging?: boolean;
  /** false = không có quyền chuyển cột: không hiện con trỏ nắm/kéo, cuộn cảm ứng bình thường. */
  canDrag?: boolean;
  /** Dịch chỗ khi các thẻ khác tránh đường (transform/transition của sortable). */
  style?: CSSProperties;
  /** Đường kẻ chèn khi một thẻ từ cột khác đang rê tới: ngay trước/sau thẻ này. */
  dropEdge?: 'before' | 'after' | null;
  rootRef?: Ref<HTMLDivElement>;
  rootProps?: HTMLAttributes<HTMLDivElement>;
  /** Có → mã công việc là link thật (bấm = xem nhanh, Cmd/Ctrl+bấm = tab mới). Bản overlay không truyền. */
  onOpenKey?: (key: string) => void;
}) {
  const labels = issue.labels ?? [];
  return (
    <div
      ref={rootRef}
      {...rootProps}
      style={style}
      className={cn(
        'relative rounded-md border bg-surface p-2.5 shadow-sm transition-shadow',
        canDrag ? 'cursor-grab touch-none active:cursor-grabbing' : 'cursor-pointer',
        dueBorderClass(issue) || 'border-border',
        'hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        isDragging && 'opacity-40',
        overlay && 'shadow-lg',
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <IssueTypeBadge name={issue.type.name} color={issue.type.color} />
        <div className="ml-auto flex items-center gap-2">
          <DueBadge issue={issue} warnOnly />
          {issue.storyPoints != null && (
            <span
              className="tabular grid h-5 min-w-5 place-items-center rounded-full bg-surface-2 px-1 text-[10px] font-medium text-muted"
              title={`${issue.storyPoints} điểm ước lượng — mức độ lớn của việc này`}
            >
              {issue.storyPoints}
            </span>
          )}
        </div>
      </div>

      <p className="mb-1.5 line-clamp-2 text-sm text-ink-strong">{issue.summary}</p>

      {labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1">
          {labels.slice(0, 3).map((l) => (
            <LabelChip key={l.id} name={l.name} color={l.color} />
          ))}
          {labels.length > 3 && (
            <span className="text-[10px] text-faint">+{labels.length - 3}</span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        {onOpenKey && !overlay ? (
          <IssueKeyLink issueKey={issue.key} onPeek={onOpenKey} className="whitespace-nowrap" />
        ) : (
          <span
            className="shrink-0 whitespace-nowrap font-mono text-xs text-muted"
            title={`Mã công việc ${issue.key}`}
          >
            {issue.key}
          </span>
        )}
        {issue.priority && (
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: issue.priority.color ?? 'var(--faint)' }}
            title={`Mức ưu tiên: ${issue.priority.name}`}
          />
        )}
        <AcceptanceBadge progress={issue.acceptanceProgress} />
        {issue.severity && isBugType(issue.type) && (
          <SeverityBadge severity={issue.severity} compact />
        )}
        <div className="ml-auto flex min-w-0 items-center">
          {issue.assignee ? (
            <span
              className="flex min-w-0 items-center gap-1"
              title={`Người phụ trách: ${issue.assignee.displayName}`}
            >
              <Avatar name={issue.assignee.displayName} src={issue.assignee.avatarUrl} size={18} />
              <span className="max-w-[6.5rem] truncate text-xs text-muted">
                {issue.assignee.displayName}
              </span>
            </span>
          ) : (
            <span
              className="whitespace-nowrap text-[11px] text-faint"
              title="Chưa có ai nhận việc này"
            >
              Chưa gán
            </span>
          )}
        </div>
      </div>

      {progress && progress.total > 0 && (
        <div
          className="mt-2 flex items-center gap-1.5"
          title={`Việc con: đã xong ${progress.done}/${progress.total}`}
        >
          <TaskProgress progress={progress} compact className="flex-1" />
          <span className="tabular shrink-0 text-[10px] text-faint">
            {progress.done}/{progress.total}
          </span>
        </div>
      )}

      {dropEdge && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-primary',
            dropEdge === 'before' ? '-top-[5px]' : '-bottom-[5px]',
          )}
        />
      )}
    </div>
  );
}

interface CardProps {
  issue: IssueDto;
  progress?: SubtreeProgress;
  onOpen: (key: string) => void;
  laneIdx?: number;
  colIdx?: number;
  rowIdx?: number;
  /** Có quyền chuyển cột (`issue:transition`) không — false thì thẻ chỉ mở chi tiết, không kéo được. */
  canDrag: boolean;
}

/**
 * Thẻ công việc kéo được. `memo` với so sánh tiến độ theo giá trị: bản đồ tiến độ được dựng lại mỗi lần cache đổi
 * nhưng thẻ không có việc con đổi thì không cần vẽ lại.
 */
export const Card = memo(
  function Card({
    issue,
    progress,
    onOpen,
    laneIdx = 0,
    colIdx = 0,
    rowIdx = 0,
    canDrag,
  }: CardProps) {
    // Không quyền kéo: thẻ vẫn là droppable để người có quyền thả gần nó (chỉ tắt phần draggable).
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
      id: issue.id,
      disabled: { draggable: !canDrag },
      transition: SORT_TRANSITION,
      attributes: { roleDescription: canDrag ? 'thẻ việc có thể kéo' : 'thẻ việc' },
    });
    const dropEdge = useDropEdge(issue.id);
    const style: CSSProperties = {
      transform: transform
        ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
        : undefined,
      transition,
    };

    function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
      if (isDragging) return; // đang kéo bằng bàn phím: mũi tên thuộc về dnd-kit, không dời focus
      if (openOnRowKey(e, { key: issue.key, open: onOpen })) return; // Enter = xem nhanh, Cmd/Ctrl+Enter = tab mới
      if (e.key === ' ') {
        listeners?.onKeyDown?.(e);
        return;
      } // Space nhấc thẻ để kéo bằng bàn phím
      const map: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      };
      const d = map[e.key];
      if (!d) return;
      e.preventDefault();
      const [dc, dr] = d;
      if (!focusCard(laneIdx, colIdx + dc, rowIdx + dr) && dc !== 0)
        focusCard(laneIdx, colIdx + dc, 0);
    }

    return (
      <CardBody
        issue={issue}
        progress={progress}
        isDragging={isDragging}
        canDrag={canDrag}
        style={style}
        dropEdge={dropEdge}
        rootRef={setNodeRef}
        onOpenKey={onOpen}
        rootProps={{
          ...listeners,
          ...attributes,
          ...({
            'data-board-card': true,
            'data-lane': laneIdx,
            'data-col': colIdx,
            'data-row': rowIdx,
            'data-issue-key': issue.key,
          } as object),
          ...rowPeekProps(issue.key, onOpen),
          role: 'button',
          tabIndex: 0,
          onKeyDown,
        }}
      />
    );
  },
  (prev, next) =>
    prev.issue === next.issue &&
    prev.onOpen === next.onOpen &&
    prev.laneIdx === next.laneIdx &&
    prev.colIdx === next.colIdx &&
    prev.rowIdx === next.rowIdx &&
    prev.canDrag === next.canDrag &&
    sameProgress(prev.progress, next.progress),
);
