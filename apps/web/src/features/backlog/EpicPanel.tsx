import { memo, useMemo, useState, type ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { PanelLeftClose } from 'lucide-react';
import type { IssueDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { epicDropId, epicProgress, epicProgressLabel, type PointsProgress } from '@/lib/epic';
import { cn } from '@/lib/utils';

/** Thanh tiến độ theo điểm: phần xong tô `--status-done` trên nền `surface-3`, luôn kèm nhãn chữ. */
function PointsBar({ progress, className }: { progress: PointsProgress; className?: string }) {
  const label = epicProgressLabel(progress);
  return (
    <div className={cn('space-y-1', className)}>
      <div
        role="progressbar"
        aria-label={`Tiến độ epic: ${label}`}
        aria-valuenow={progress.pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${progress.pct}%`, background: 'var(--status-done)' }}
        />
      </div>
      <p className="tabular text-xs text-muted">
        {progress.totalCount === 0 ? 'Chưa có việc' : label}
      </p>
    </div>
  );
}

const EMPTY_PROGRESS: PointsProgress = {
  donePoints: 0,
  totalPoints: 0,
  doneCount: 0,
  totalCount: 0,
  pct: 0,
};

const ITEM =
  'flex w-full flex-col gap-1 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]';

function PanelItem({
  dropId,
  dropEnabled,
  active,
  onClick,
  children,
}: {
  dropId?: string;
  dropEnabled: boolean;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  // Mục không nhận thả (vd "Tất cả việc") vẫn gọi hook với id riêng + `disabled` để giữ đúng quy tắc hook.
  const { setNodeRef, isOver } = useDroppable({
    id: dropId ?? 'epic-panel-noop',
    disabled: !dropEnabled || !dropId,
  });
  return (
    <li>
      <button
        ref={setNodeRef}
        type="button"
        aria-pressed={active}
        onClick={onClick}
        className={cn(ITEM, active && 'bg-surface-2', isOver && 'ring-2 ring-[var(--ring)]')}
      >
        {children}
      </button>
    </li>
  );
}

/**
 * Panel "Epic" bên trái Việc chờ: Tất cả việc · từng epic (tiến độ theo điểm) · Không thuộc epic.
 * `selected`: null = tất cả, 'none' = không thuộc epic, còn lại = id epic. Dựng hoàn toàn từ `issues` đã nạp.
 * Mục epic và "Không thuộc epic" là vùng thả (`dropEnabled`) để kéo việc vào/ra epic.
 */
export const EpicPanel = memo(function EpicPanel({
  epics,
  issues,
  counts,
  selected,
  onSelect,
  dropEnabled,
  collapsed,
  onToggle,
}: {
  epics: IssueDto[];
  issues: IssueDto[];
  counts: Map<string, number>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  dropEnabled: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [showDone, setShowDone] = useState(false);
  // Dựng Map + tiến độ mọi epic MỘT lần theo `issues` (panel memo → không tính lại khi trang vẽ lại vì lý do khác).
  const progressByEpic = useMemo(() => {
    const byId = new Map(issues.map((i) => [i.id, i]));
    return new Map(epics.map((e) => [e.id, epicProgress(issues, e.id, byId)]));
  }, [issues, epics]);
  // Cùng định nghĩa với các mục dưới: việc thuộc các epic + "Không thuộc epic" (không đếm chính các epic).
  const total = useMemo(() => [...counts.values()].reduce((a, b) => a + b, 0), [counts]);
  if (collapsed) return null;
  const doneEpics = epics.filter((e) => e.status.category === 'DONE');
  const shown = epics.filter((e) => showDone || e.status.category !== 'DONE' || e.id === selected);
  const noEpic = counts.get('none') ?? 0;

  return (
    <nav
      aria-label="Epic"
      className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface lg:flex"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-medium text-ink-strong">Epic</h2>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="Thu gọn panel Epic"
          title="Thu gọn panel Epic"
          onClick={onToggle}
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
        <PanelItem dropEnabled={false} active={selected === null} onClick={() => onSelect(null)}>
          <span className="flex items-center justify-between text-sm text-ink">
            Tất cả việc
            <span
              className="tabular text-xs text-muted"
              title="Tổng việc thuộc các epic và “Không thuộc epic” (không đếm chính các epic)"
            >
              {total}
            </span>
          </span>
        </PanelItem>
        {shown.map((e) => (
          <PanelItem
            key={e.id}
            dropId={epicDropId(e.id)}
            dropEnabled={dropEnabled}
            active={selected === e.id}
            onClick={() => onSelect(selected === e.id ? null : e.id)}
          >
            <span className="flex min-w-0 items-center gap-1.5 text-sm text-ink">
              <IssueTypeIcon type={e.type} />
              <span className="shrink-0 font-mono text-xs text-muted">{e.key}</span>
              <span className="min-w-0 flex-1 truncate">{e.summary}</span>
            </span>
            <PointsBar progress={progressByEpic.get(e.id) ?? EMPTY_PROGRESS} />
          </PanelItem>
        ))}
        <PanelItem
          dropId={epicDropId('none')}
          dropEnabled={dropEnabled}
          active={selected === 'none'}
          onClick={() => onSelect(selected === 'none' ? null : 'none')}
        >
          <span className="flex items-center justify-between text-sm text-ink">
            Không thuộc epic
            <span className="tabular text-xs text-muted">{noEpic}</span>
          </span>
        </PanelItem>
        {epics.length === 0 && (
          <li className="px-2.5 py-3 text-xs text-muted">
            Chưa có epic. Tạo việc loại Epic để gom các việc cùng mảng lớn.
          </li>
        )}
      </ul>
      {doneEpics.length > 0 && (
        <label className="flex cursor-pointer items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Hiện epic đã xong ({doneEpics.length})
        </label>
      )}
    </nav>
  );
});
