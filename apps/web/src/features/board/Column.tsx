import { memo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { BoardColumnDto, IssueDto } from '@tirapro/types';
import { QuickAddRow } from '@/components/ui/QuickAddRow';
import { categoryColor } from '@/lib/statusColor';
import { cn } from '@/lib/utils';
import { sameProgress, type SubtreeProgress } from '@/lib/issueTree';
import { Card } from './Card';

export interface ColumnProps {
  col: BoardColumnDto;
  issues: IssueDto[];
  progressMap: Map<string, SubtreeProgress>;
  onOpen: (key: string) => void;
  projectKey: string;
  projectId: string;
  canCreate: boolean;
  droppableId?: string;
  laneIdx?: number;
  colIdx?: number;
  grouped?: boolean;
  /** Số việc tính vào WIP của cột (toàn bảng, chưa lọc) — chỉ dùng khi cột có giới hạn. */
  wipUsed?: number;
}

function ColumnImpl({
  col, issues, progressMap, onOpen, projectKey, projectId, canCreate, droppableId, laneIdx = 0, colIdx = 0, grouped = false, wipUsed = 0,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId ?? col.id });
  const dot = issues[0] ? categoryColor(issues[0].status.category) : 'var(--status-todo)';
  const columnStatusId = col.statusIds[0];
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-[21.6rem] shrink-0 flex-col rounded-lg bg-surface-3 transition-colors',
        grouped && 'self-start',
        isOver && 'ring-2 ring-[var(--ring)]',
      )}
    >
      <div className="sticky top-0 flex items-center gap-2 px-3 py-2.5">
        <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
        <span className="text-sm font-medium text-ink">{col.name}</span>
        <span className="tabular ml-auto text-xs text-muted" title={`${issues.length} việc đang hiển thị ở cột này`}>
          {issues.length}
        </span>
        {col.wipLimit != null && (
          <span
            className={cn(
              'tabular rounded-full px-1.5 py-px text-[11px] font-medium',
              wipUsed >= col.wipLimit ? 'bg-danger/10 text-danger' : 'bg-surface-2 text-muted',
            )}
            title={wipUsed >= col.wipLimit
              ? `Cột đã đầy: ${wipUsed}/${col.wipLimit} việc đang làm. Hoàn thành bớt việc trước khi kéo thêm vào (quản trị dự án có thể chọn “Vẫn chuyển”).`
              : `Giới hạn việc đang làm (WIP): ${wipUsed}/${col.wipLimit}`}
          >
            WIP {wipUsed}/{col.wipLimit}
          </span>
        )}
      </div>
      <div className={cn('flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2', grouped && 'min-h-[3rem]')}>
        {issues.map((issue, rowIdx) => (
          <Card key={issue.id} issue={issue} progress={progressMap.get(issue.id)} onOpen={onOpen} laneIdx={laneIdx} colIdx={colIdx} rowIdx={rowIdx} />
        ))}
        {issues.length === 0 && <p className="px-2 py-6 text-center text-xs text-faint">Chưa có việc nào. Kéo việc vào đây hoặc thêm mới bên dưới.</p>}
      </div>
      {canCreate && columnStatusId && projectId && (
        <QuickAddRow projectKey={projectKey} projectId={projectId} extra={{ statusId: columnStatusId }} placeholder="+ Thêm việc…" compact />
      )}
    </div>
  );
}

/**
 * Cột chỉ vẽ lại khi dữ liệu của chính nó đổi. `progressMap` là Map dựng lại mỗi lần cache đổi nên so theo giá trị
 * của các việc trong cột thay vì so tham chiếu.
 */
export const Column = memo(ColumnImpl, (p, n) => {
  if (
    p.col !== n.col || p.issues !== n.issues || p.onOpen !== n.onOpen || p.projectKey !== n.projectKey
    || p.projectId !== n.projectId || p.canCreate !== n.canCreate || p.droppableId !== n.droppableId
    || p.laneIdx !== n.laneIdx || p.colIdx !== n.colIdx || p.grouped !== n.grouped || p.wipUsed !== n.wipUsed
  ) return false;
  if (p.progressMap === n.progressMap) return true;
  return n.issues.every((i) => sameProgress(p.progressMap.get(i.id), n.progressMap.get(i.id)));
});
