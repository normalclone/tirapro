import { memo, type CSSProperties, type HTMLAttributes, type Ref } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import type { IssueDto, PriorityDto, SprintDto } from '@tirapro/types';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  InlinePoints,
  InlinePriority,
  NO_EDIT_TIP,
  PointsChip,
  PriorityDot,
  type PriorityChoice,
} from './InlineEdits';
import { DueBadge, dueBorderClass } from '@/components/ui/DueBadge';
import { TaskProgress } from '@/components/ui/TaskProgress';
import { Avatar } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { useDropEdge } from '@/lib/dropHint';
import { SORT_TRANSITION } from '@/lib/sortableDnd';
import { sameProgress, type SubtreeProgress } from '@/lib/issueTree';
import { openOnRowKey, rowRootProps } from '@/lib/rowOpen';
import { rowPeekProps } from '@/features/issues/peek/rowPeekProps';
import { IssueKeyLink } from '@/features/issues/peek/IssueKeyLink';

/** Tối đa 2 nhãn đầu của dòng (chỉ từ `lg`), phần còn lại gộp "+N". */
function RowLabels({ labels }: { labels: IssueDto['labels'] }) {
  if (!labels || labels.length === 0) return null;
  return (
    <span className="hidden shrink-0 items-center gap-1 lg:flex">
      {labels.slice(0, 2).map((l) => (
        <span
          key={l.id}
          className="max-w-[7rem] truncate rounded px-1.5 py-px text-[10px] font-medium"
          style={{
            backgroundColor: `color-mix(in oklch, ${l.color || 'var(--faint)'} 16%, transparent)`,
            color: l.color || 'var(--faint)',
          }}
          title={`Nhãn: ${l.name}`}
        >
          {l.name}
        </span>
      ))}
      {labels.length > 2 && <span className="text-[10px] text-faint">+{labels.length - 2}</span>}
    </span>
  );
}

/**
 * Phần giao diện thuần của một dòng backlog — dùng cho dòng kéo được (`IssueRow`) lẫn bản trôi theo chuột (`DragOverlay`).
 * Bản overlay KHÔNG gọi `useDraggable` để không đăng ký trùng id với dòng gốc trong dnd-kit.
 */
export function IssueRowBody({
  issue,
  overlay,
  progress,
  readOnly,
  selectable,
  checked,
  onToggleSelect,
  isDragging,
  dropEdge,
  rootRef,
  style,
  rootProps,
  onOpen,
  peeked,
  edit,
  canEdit,
}: {
  issue: IssueDto;
  overlay?: boolean;
  progress?: SubtreeProgress;
  readOnly?: boolean;
  selectable?: boolean;
  checked?: boolean;
  onToggleSelect?: (id: string) => void;
  isDragging?: boolean;
  /** Đường kẻ chèn khi kéo từ khu khác sang (cùng `dropHint` với Board). */
  dropEdge?: 'before' | 'after' | null;
  rootRef?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  rootProps?: HTMLAttributes<HTMLDivElement>;
  /** Bấm mã công việc → xem nhanh (bản overlay không truyền: mã vẫn là chữ thường). */
  onOpen?: (key: string) => void;
  /** Dòng đang được xem nhanh ở panel bên phải. */
  peeked?: boolean;
  /** Sửa tại chỗ (điểm/ưu tiên). Không truyền (sprint đã đóng, bản overlay) → dòng hiển thị tĩnh. */
  edit?: RowEdit;
  /** Người dùng sửa được công việc này (`canEditIssue`) — một cờ cho cả điểm lẫn ưu tiên. */
  canEdit?: boolean;
}) {
  const warn = dueBorderClass(issue);
  return (
    <div
      ref={rootRef}
      style={style}
      {...rootProps}
      className={cn(
        'relative flex items-center gap-3 rounded-md border bg-surface px-2.5 py-2 transition-colors',
        readOnly ? 'cursor-default' : 'cursor-grab touch-none active:cursor-grabbing',
        warn || 'border-transparent hover:border-border',
        'hover:bg-surface-2',
        checked && 'border-primary bg-primary-subtle',
        isDragging && 'opacity-40',
        peeked && 'bg-primary-subtle/60 ring-1 ring-primary/40',
        overlay && 'rotate-1 border-border bg-surface shadow-lg',
      )}
    >
      {selectable && !overlay && (
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          checked={checked}
          // Không cho pointer-down/click lan sang draggable của hàng.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleSelect?.(issue.id)}
          aria-label={`Chọn việc ${issue.key} để thao tác hàng loạt`}
        />
      )}
      {edit && canEdit ? (
        <InlinePriority issue={issue} priorities={edit.priorities} onPick={edit.onEditPriority} />
      ) : (
        <PriorityDot priority={issue.priority} />
      )}
      <IssueTypeIcon type={issue.type} />
      {onOpen && !overlay ? (
        <IssueKeyLink issueKey={issue.key} onPeek={onOpen} />
      ) : (
        <span className="shrink-0 font-mono text-xs text-muted" title={`Mã công việc ${issue.key}`}>
          {issue.key}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{issue.summary}</span>
      <RowLabels labels={issue.labels} />
      {progress && progress.total > 0 && (
        <span
          className="hidden shrink-0 items-center gap-1.5 sm:flex"
          title={`Việc con: đã xong ${progress.done}/${progress.total} (${progress.pct}%)`}
        >
          <TaskProgress progress={progress} compact className="w-16" />
          <span className="tabular text-[10px] text-faint">
            {progress.done}/{progress.total}
          </span>
        </span>
      )}
      <DueBadge issue={issue} warnOnly className="shrink-0" />
      <StatusPill status={issue.status} />
      {edit ? (
        <InlinePoints
          issue={issue}
          canEdit={!!canEdit}
          sprints={edit.sprints}
          onSave={edit.onEditPoints}
          lockedTip={NO_EDIT_TIP}
        />
      ) : (
        issue.storyPoints != null && <PointsChip points={issue.storyPoints} />
      )}
      {issue.assignee ? (
        <span
          className="flex shrink-0 items-center gap-1.5"
          title={`Người phụ trách: ${issue.assignee.displayName}`}
        >
          <Avatar name={issue.assignee.displayName} src={issue.assignee.avatarUrl} size={20} />
          <span className="hidden max-w-[9rem] truncate text-xs text-muted md:inline">
            {issue.assignee.displayName}
          </span>
        </span>
      ) : (
        <span
          className="hidden shrink-0 text-[11px] text-faint sm:inline"
          title="Chưa có ai nhận việc này"
        >
          Chưa gán
        </span>
      )}
      {dropEdge && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-primary',
            dropEdge === 'before' ? '-top-[4px]' : '-bottom-[4px]',
          )}
        />
      )}
    </div>
  );
}

/**
 * Ngữ cảnh sửa tại chỗ do trang truyền xuống: MỘT đối tượng ổn định (`useMemo`) + hai callback `useCallback`, để dòng `memo`
 * không vẽ lại khi trang vẽ lại. Quyền theo dòng đi riêng qua `canEdit` (boolean).
 */
export interface RowEdit {
  priorities: PriorityChoice[];
  sprints: SprintDto[] | undefined;
  onEditPoints: (issue: IssueDto, value: number | null) => void;
  onEditPriority: (issue: IssueDto, priority: PriorityDto | null) => void;
}

interface IssueRowProps {
  issue: IssueDto;
  progress?: SubtreeProgress;
  /** Cả khu chỉ đọc (sprint đã đóng): không kéo, không là điểm thả. */
  readOnly?: boolean;
  /** Dòng này không kéo được (thiếu quyền) nhưng vẫn là điểm thả hợp lệ. */
  dragDisabled?: boolean;
  selectable?: boolean;
  checked?: boolean;
  onToggleSelect?: (id: string) => void;
  onOpen?: (key: string) => void;
  peeked?: boolean;
  edit?: RowEdit;
  canEdit?: boolean;
}

/**
 * Dòng backlog kéo-sắp xếp được. `memo` + so sánh tiến độ theo giá trị: chọn một dòng hay kéo một dòng chỉ vẽ lại dòng đó
 * (`onToggleSelect` phải ổn định — useCallback ở trang).
 */
export const IssueRow = memo(
  function IssueRow({
    issue,
    progress,
    readOnly,
    dragDisabled,
    selectable,
    checked,
    onToggleSelect,
    onOpen,
    peeked,
    edit,
    canEdit,
  }: IssueRowProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
      id: issue.id,
      disabled: { draggable: !!readOnly || !!dragDisabled, droppable: !!readOnly },
      transition: SORT_TRANSITION,
      attributes: { roleDescription: 'dòng việc có thể kéo' },
    });
    const draggable = !readOnly && !dragDisabled;
    const dropEdge = useDropEdge(issue.id);
    const style = {
      transform: transform
        ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
        : undefined,
      transition,
    };
    const key = issue.key;
    const openProps = onOpen ? rowPeekProps(key, onOpen) : undefined;
    const rowKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (openProps && openOnRowKey(e, { key, open: onOpen, isDragging })) return;
      // Space + mọi phím khác (và mọi phím khi đang kéo) vẫn về dnd-kit như cũ.
      if (draggable) listeners?.onKeyDown?.(e);
    };
    return (
      <IssueRowBody
        issue={issue}
        progress={progress}
        readOnly={readOnly || dragDisabled}
        selectable={selectable}
        checked={checked}
        onToggleSelect={onToggleSelect}
        isDragging={isDragging}
        dropEdge={dropEdge}
        // LUÔN gắn: dòng không kéo được vẫn là điểm thả hợp lệ (khu chỉ đọc đã tắt droppable).
        rootRef={setNodeRef}
        style={style}
        onOpen={onOpen}
        peeked={peeked}
        edit={edit}
        canEdit={canEdit}
        // `onKeyDown` đứng SAU spread listeners: ghi đè có chủ đích, `rowKeyDown` tự chuyển tiếp cho dnd-kit.
        rootProps={
          {
            ...(draggable ? { ...listeners, ...attributes } : {}),
            ...rowRootProps({ draggable, hasOpen: !!onOpen }),
            'data-issue-key': key,
            onClick: openProps?.onClick,
            onAuxClick: openProps?.onAuxClick,
            onKeyDown: rowKeyDown,
          } as HTMLAttributes<HTMLDivElement>
        }
      />
    );
  },
  (p, n) =>
    p.issue === n.issue &&
    p.readOnly === n.readOnly &&
    p.dragDisabled === n.dragDisabled &&
    p.selectable === n.selectable &&
    p.checked === n.checked &&
    p.onToggleSelect === n.onToggleSelect &&
    p.onOpen === n.onOpen &&
    p.peeked === n.peeked &&
    p.edit === n.edit &&
    p.canEdit === n.canEdit &&
    sameProgress(p.progress, n.progress),
);
