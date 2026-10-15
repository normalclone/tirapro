import { memo, type CSSProperties, type HTMLAttributes, type Ref } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { IssueDto } from '@tirapro/types';
import { DueBadge, dueBorderClass } from '@/components/ui/DueBadge';
import { TaskProgress } from '@/components/ui/TaskProgress';
import { Avatar } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { sameProgress, type SubtreeProgress } from '@/lib/issueTree';

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
  rootRef,
  style,
  rootProps,
}: {
  issue: IssueDto;
  overlay?: boolean;
  progress?: SubtreeProgress;
  readOnly?: boolean;
  selectable?: boolean;
  checked?: boolean;
  onToggleSelect?: (id: string) => void;
  isDragging?: boolean;
  rootRef?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  rootProps?: HTMLAttributes<HTMLDivElement>;
}) {
  const warn = dueBorderClass(issue);
  return (
    <div
      ref={rootRef}
      style={style}
      {...rootProps}
      className={cn(
        'flex items-center gap-3 rounded-md border bg-surface px-2.5 py-2 transition-colors',
        readOnly ? 'cursor-default' : 'cursor-grab touch-none active:cursor-grabbing',
        warn || 'border-transparent hover:border-border',
        'hover:bg-surface-2',
        checked && 'border-primary bg-primary-subtle',
        isDragging && 'opacity-40',
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
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: issue.priority?.color ?? 'var(--faint)' }}
        title={issue.priority ? `Mức ưu tiên: ${issue.priority.name}` : 'Chưa đặt mức ưu tiên'}
      />
      <span className="shrink-0 font-mono text-xs text-muted" title={`Mã công việc ${issue.key}`}>
        {issue.key}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{issue.summary}</span>
      {issue.labels && issue.labels.length > 0 && (
        <span className="hidden shrink-0 items-center gap-1 lg:flex">
          {issue.labels.slice(0, 2).map((l) => (
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
          {issue.labels.length > 2 && (
            <span className="text-[10px] text-faint">+{issue.labels.length - 2}</span>
          )}
        </span>
      )}
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
      {issue.storyPoints != null && (
        <span
          className="tabular grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-surface-2 px-1 text-[10px] font-medium text-muted"
          title={`${issue.storyPoints} điểm ước lượng — mức độ lớn của việc này`}
        >
          {issue.storyPoints}
        </span>
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
    </div>
  );
}

interface IssueRowProps {
  issue: IssueDto;
  progress?: SubtreeProgress;
  readOnly?: boolean;
  selectable?: boolean;
  checked?: boolean;
  onToggleSelect?: (id: string) => void;
}

/**
 * Dòng backlog kéo được. `memo` + so sánh tiến độ theo giá trị: chọn một dòng hay kéo một dòng chỉ vẽ lại dòng đó
 * (`onToggleSelect` phải ổn định — useCallback ở trang).
 */
export const IssueRow = memo(
  function IssueRow({
    issue,
    progress,
    readOnly,
    selectable,
    checked,
    onToggleSelect,
  }: IssueRowProps) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
      id: issue.id,
      disabled: readOnly,
    });
    const style = transform
      ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
      : undefined;
    return (
      <IssueRowBody
        issue={issue}
        progress={progress}
        readOnly={readOnly}
        selectable={selectable}
        checked={checked}
        onToggleSelect={onToggleSelect}
        isDragging={isDragging}
        rootRef={readOnly ? undefined : setNodeRef}
        style={style}
        rootProps={readOnly ? undefined : { ...listeners, ...attributes }}
      />
    );
  },
  (p, n) =>
    p.issue === n.issue &&
    p.readOnly === n.readOnly &&
    p.selectable === n.selectable &&
    p.checked === n.checked &&
    p.onToggleSelect === n.onToggleSelect &&
    sameProgress(p.progress, n.progress),
);
