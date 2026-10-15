import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Archive, Plus } from 'lucide-react';
import { useProjects } from './api';
import { CreateProjectModal } from './CreateProjectModal';
import { useShowArchived } from './showArchived';
import { cn } from '@/lib/utils';

/**
 * Rail dự án (submenu trái) — danh sách dự án + nút tạo dự án.
 * Dùng chung cho ProjectLayout và trang chi tiết issue để luôn giữ ngữ cảnh dự án.
 *
 *  activeKey — key dự án đang xem (tô sáng).
 *  view      — segment view để link sang (board/backlog/…); mặc định "board".
 */
export function ProjectRail({ activeKey, view = 'board' }: { activeKey: string; view?: string }) {
  const [showArchived, toggleArchived] = useShowArchived();
  const { data: projects } = useProjects(showArchived);
  const [createProject, setCreateProject] = useState(false);

  return (
    <>
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex items-center justify-between gap-2 px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-faint">Dự án</span>
          <button
            type="button"
            onClick={() => setCreateProject(true)}
            aria-label="Tạo dự án"
            title="Tạo dự án"
            className="grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {(projects ?? []).map((p) => (
            <NavLink
              key={p.id}
              to={`/p/${p.key}/${view}`}
              className={cn(
                'flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors',
                p.key === activeKey
                  ? 'bg-primary-subtle font-medium text-primary'
                  : 'text-ink hover:bg-surface-2',
              )}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-surface-2 font-mono text-[10px] font-bold text-muted">
                {p.key.slice(0, 3)}
              </span>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.archivedAt && (
                <Archive className="h-3.5 w-3.5 shrink-0 text-faint" aria-label="Đã lưu trữ" />
              )}
            </NavLink>
          ))}
          {projects && projects.length === 0 && (
            <p className="px-2 py-4 text-xs text-faint">Chưa có dự án.</p>
          )}
        </nav>
        <label className="flex cursor-pointer items-center gap-2 border-t border-border px-3 py-2.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => toggleArchived(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
          Hiện đã lưu trữ
        </label>
      </aside>

      <CreateProjectModal open={createProject} onClose={() => setCreateProject(false)} />
    </>
  );
}
