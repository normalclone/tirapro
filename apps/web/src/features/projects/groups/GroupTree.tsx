import { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProjectRow, ProjectsHeaderRow, type LastView } from '../ProjectsTable';
import { GroupDot } from './GroupsPopover';
import { groupKey, type GroupNode } from './groupModel';

/**
 * Chế độ "Theo nhóm": mỗi nhóm một nút thu gọn được (màu, tên, số dự án đang hiện), con là dự án; dự án thuộc nhiều nhóm
 * hiện dưới từng nhóm; cuối cùng nút "Chưa thuộc nhóm" (nhận biết bằng `id === null`). `forceOpen` (đang tìm kiếm) mở hết
 * để kết quả khớp không bị giấu trong nhóm đang thu gọn.
 */
export function GroupTree({
  groups,
  recentKey,
  lastView,
  forceOpen,
}: {
  groups: readonly GroupNode[];
  recentKey?: string;
  lastView: LastView | null;
  forceOpen: boolean;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <GroupSection
          key={groupKey(g)}
          group={g}
          recentKey={recentKey}
          lastView={lastView}
          open={forceOpen || !collapsed.has(groupKey(g))}
          locked={forceOpen}
          onToggle={() => toggle(groupKey(g))}
        />
      ))}
    </div>
  );
}

function GroupSection({
  group,
  recentKey,
  lastView,
  open,
  locked,
  onToggle,
}: {
  group: GroupNode;
  recentKey?: string;
  lastView: LastView | null;
  open: boolean;
  /** Đang tìm kiếm: mọi nhóm bị mở cố định nên nút thu/mở tắt (không giả vờ bấm được). */
  locked: boolean;
  onToggle: () => void;
}) {
  const listId = useId();
  const count = group.projects.length;
  return (
    <section
      aria-label={group.id === null ? `${group.name}` : `Nhóm ${group.name}`}
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={locked}
        aria-expanded={open}
        aria-controls={listId}
        className={cn(
          'flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-surface-2',
          'disabled:cursor-default disabled:hover:bg-transparent',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]',
          '[@media(pointer:coarse)]:min-h-11',
        )}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-faint" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
        )}
        {group.id !== null && <GroupDot color={group.color} />}
        <span
          className={cn(
            'min-w-0 truncate text-sm font-medium',
            group.id === null ? 'text-muted' : 'text-ink-strong',
          )}
        >
          {group.name}
        </span>
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted">{count} dự án</span>
      </button>
      <div id={listId} hidden={!open}>
        {count === 0 ? (
          <p className="border-t border-border px-4 py-3 text-sm text-muted">
            Nhóm này chưa có dự án nào.
          </p>
        ) : (
          <>
            <ProjectsHeaderRow />
            <ul className="divide-y divide-border border-t border-border sm:border-t-0">
              {group.projects.map((p) => (
                <ProjectRow key={p.id} project={p} recentKey={recentKey} lastView={lastView} />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
