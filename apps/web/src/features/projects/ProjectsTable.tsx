import { Link } from 'react-router-dom';
import { Archive } from 'lucide-react';
import type { ProjectDto } from '@tirapro/types';
import { Avatar, Badge } from '@/components/ui/primitives';
import { TERM } from '@/lib/terms';
import { cn } from '@/lib/utils';
import { GroupsCell } from './groups/GroupsPopover';

const TYPE_LABEL: Record<ProjectDto['type'], string> = { SCRUM: 'Scrum', KANBAN: 'Kanban' };

/** Cột bảng desktop: Dự án · Loại · Nhóm · Phụ trách · Công việc · liên kết nhanh. Dưới `sm` xếp dọc thành thẻ. */
const ROW_GRID =
  'sm:grid sm:grid-cols-[minmax(0,1fr)_5rem_6.5rem_11rem_6.5rem_auto] sm:items-center sm:gap-4';

export interface LastView {
  key: string;
  view: string;
}

/** Hàng tiêu đề cột (chỉ từ `sm`; dưới đó mỗi dự án là một thẻ tự mô tả). */
export function ProjectsHeaderRow() {
  return (
    <div
      className={cn(
        'hidden border-b border-border px-4 py-2 text-xs font-medium text-faint',
        ROW_GRID,
        'sm:grid',
      )}
      aria-hidden
    >
      <span>Dự án</span>
      <span>Loại</span>
      <span>Nhóm dự án</span>
      <span>Phụ trách</span>
      <span>{TERM.issue.charAt(0).toUpperCase() + TERM.issue.slice(1)}</span>
      <span className="w-32" />
    </div>
  );
}

/** Một dự án — dùng chung cho chế độ "Danh sách" và dưới từng nhóm của "Theo nhóm". */
export function ProjectRow({
  project: p,
  recentKey,
  lastView,
}: {
  project: ProjectDto;
  recentKey?: string;
  lastView: LastView | null;
}) {
  return (
    <li
      className={cn(
        'relative flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-surface-2',
        ROW_GRID,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-surface-2 font-mono text-[10px] font-bold text-muted">
          {p.key.slice(0, 3)}
        </span>
        <div className="min-w-0">
          <Link
            to={`/p/${p.key}/${p.key === lastView?.key ? lastView.view : 'board'}`}
            className="block truncate font-medium text-ink-strong after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-[var(--ring)]"
          >
            {p.name}
          </Link>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-faint">
            <span className="font-mono">{p.key}</span>
            {p.key === recentKey && (
              <Badge className="bg-primary-subtle text-primary">Gần nhất</Badge>
            )}
            {p.archivedAt && (
              <Badge className="bg-surface-2 text-muted">
                <Archive className="h-3 w-3" aria-hidden /> Đã lưu trữ
              </Badge>
            )}
          </div>
        </div>
      </div>
      {/* Dưới sm: Loại · Nhóm · Phụ trách · Số việc nằm chung một hàng; từ sm: mỗi thứ là một cột của bảng. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:contents">
        <span className="text-sm text-muted">{TYPE_LABEL[p.type] ?? p.type}</span>
        <span className="flex items-center">
          <GroupsCell project={p} />
        </span>
        <span className="flex min-w-0 items-center gap-2 text-sm text-muted">
          {p.lead ? (
            <>
              <Avatar name={p.lead.displayName} src={p.lead.avatarUrl} size={20} />
              <span className="truncate">{p.lead.displayName}</span>
            </>
          ) : (
            <span className="text-faint">Chưa có</span>
          )}
        </span>
        <span className="text-sm tabular-nums text-muted">
          {p.issueCount ?? 0} {TERM.issue}
        </span>
      </div>
      <span className="relative z-10 flex items-center gap-3 text-sm">
        <Link to={`/p/${p.key}/board`} className="py-1.5 text-primary hover:underline">
          {TERM.board}
        </Link>
        <Link to={`/p/${p.key}/backlog`} className="py-1.5 text-primary hover:underline">
          {TERM.backlog}
        </Link>
      </span>
    </li>
  );
}

/** Chế độ "Danh sách": một bảng phẳng. */
export function ProjectList({
  projects,
  recentKey,
  lastView,
}: {
  projects: readonly ProjectDto[];
  recentKey?: string;
  lastView: LastView | null;
}) {
  return (
    <div
      className="overflow-hidden rounded-lg border border-border bg-surface"
      data-tour="projects-list"
    >
      <ProjectsHeaderRow />
      <ul className="divide-y divide-border">
        {projects.map((p) => (
          <ProjectRow key={p.id} project={p} recentKey={recentKey} lastView={lastView} />
        ))}
      </ul>
    </div>
  );
}
