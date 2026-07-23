import type { SubtreeProgress } from '@/lib/issueTree';
import { cn } from '@/lib/utils';

/**
 * Thanh tiến trình của cây task con: 3 đoạn (Hoàn thành / Đang làm / Cần làm) theo tỉ lệ số lượng,
 * cho task cha "nhìn" được trạng thái toàn bộ con cháu trong một liếc mắt.
 * - compact: chỉ thanh mảnh (cho card/dòng list).
 * - mặc định: thanh + "done/total".
 */
export function TaskProgress({
  progress,
  compact,
  className,
}: {
  progress: SubtreeProgress;
  compact?: boolean;
  className?: string;
}) {
  if (progress.total === 0) return null;
  const title = `Hoàn thành ${progress.done}/${progress.total} (${progress.pct}%) · Đang làm ${progress.inProgress} · Cần làm ${progress.todo}`;

  const bar = (
    <div
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
      title={title}
      role="progressbar"
      aria-valuenow={progress.pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Tiến trình task con: ${progress.pct}%`}
    >
      {progress.done > 0 && <span style={{ flexGrow: progress.done, background: 'var(--status-done)' }} />}
      {progress.inProgress > 0 && (
        <span style={{ flexGrow: progress.inProgress, background: 'var(--status-progress)' }} />
      )}
      {progress.todo > 0 && <span style={{ flexGrow: progress.todo, background: 'var(--status-todo)' }} />}
    </div>
  );

  if (compact) return <div className={cn('w-full', className)}>{bar}</div>;

  return (
    <div className={cn('flex items-center gap-2', className)} title={title}>
      <div className="min-w-[72px] flex-1">{bar}</div>
      <span className="tabular shrink-0 text-xs text-muted">
        {progress.done}/{progress.total}
      </span>
    </div>
  );
}
