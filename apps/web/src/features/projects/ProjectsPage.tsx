import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, ArrowRight, FolderKanban, Plus, Search } from 'lucide-react';
import type { ProjectDto } from '@tirapro/types';
import { pageContainer } from '@/components/layout/page';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { Avatar, Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { lastViewKey } from '@/lib/currentProject';
import { APP_NAV_LABELS } from '@/lib/navLabels';
import { TERM } from '@/lib/terms';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { useProjects } from './api';
import { CreateProjectModal } from './CreateProjectModal';
import {
  filterProjects,
  PROJECT_SORT_LABEL,
  sortProjects,
  type ProjectSort,
} from './projectsFilter';
import { useShowArchived } from './showArchived';
import { SegmentedControl } from '@/components/ui/SegmentedControl';

const TYPE_LABEL: Record<ProjectDto['type'], string> = { SCRUM: 'Scrum', KANBAN: 'Kanban' };

/** Cột bảng desktop: Dự án · Loại · Phụ trách · Công việc · liên kết nhanh. Dưới `sm` xếp dọc thành thẻ. */
const ROW_GRID =
  'sm:grid sm:grid-cols-[minmax(0,1fr)_5rem_11rem_6.5rem_auto] sm:items-center sm:gap-4';

/** Dự án + view người dùng mở gần nhất (do ProjectLayout ghi); hỏng/không có → null. */
function readLastView(): { key: string; view: string } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(lastViewKey()) || '{}') as {
      key?: string;
      view?: string;
    };
    return saved.key ? { key: saved.key, view: saved.view || 'board' } : null;
  } catch {
    return null;
  }
}

/**
 * Trang "Dự án": liệt kê dự án (tìm kiếm, mở Bảng việc / Việc chờ, tạo dự án) — thay cho việc
 * nhảy thẳng vào bảng của dự án gần nhất. Giữ đường dẫn `/projects`.
 */
export function ProjectsPage() {
  const [showArchived, setShowArchived] = useShowArchived();
  const projectsQuery = useProjects(showArchived);
  const canCreate = useAuth((s) => s.can('project:create'));
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ProjectSort>('recent');
  const [createOpen, setCreateOpen] = useState(false);
  const last = useMemo(readLastView, []);

  const projects = projectsQuery.data;
  // Danh sách rỗng khi công tắc tắt có thể là "tất cả đã lưu trữ" — tra thêm danh sách đủ để gợi ý đúng.
  const allQuery = useProjects(true, !showArchived && projects?.length === 0);
  const onlyArchived = !showArchived && projects?.length === 0 && (allQuery.data?.length ?? 0) > 0;
  const recent = projects?.find((p) => p.key === last?.key);
  // Dự án xem gần nhất ghim đầu danh sách (không tự chuyển trang).
  const shown = useMemo(
    () => sortProjects(filterProjects(projects ?? [], query), sort, recent?.key),
    [projects, query, sort, recent],
  );

  const createButton = canCreate && (
    <Button size="sm" onClick={() => setCreateOpen(true)}>
      <Plus className="h-4 w-4" /> Tạo dự án
    </Button>
  );

  return (
    <div className={pageContainer('lg')}>
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold tracking-tight text-ink-strong">
          {APP_NAV_LABELS.projects}
        </h1>
        {createButton}
      </header>

      {recent && last && (
        <Link
          to={`/p/${recent.key}/${last.view}`}
          className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm transition-colors hover:bg-surface-2"
        >
          <span className="text-muted">Tiếp tục:</span>
          <span className="min-w-0 truncate font-medium text-ink-strong">{recent.name}</span>
          <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-faint" aria-hidden />
        </Link>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="relative w-full min-w-[12rem] max-w-sm sm:flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm theo tên, mã hoặc người phụ trách"
            aria-label="Tìm dự án"
            className="pl-8"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
          Hiện đã lưu trữ
        </label>
        <div className="flex items-center gap-2 text-sm text-muted sm:ml-auto">
          <span id="project-sort-label">Sắp xếp</span>
          <SegmentedControl<ProjectSort>
            ariaLabelledby="project-sort-label"
            size="sm"
            fullWidth={false}
            value={sort}
            onChange={setSort}
            options={(Object.keys(PROJECT_SORT_LABEL) as ProjectSort[]).map((m) => ({
              value: m,
              label: PROJECT_SORT_LABEL[m],
            }))}
          />
        </div>
      </div>

      <QueryBoundary
        query={projectsQuery}
        skeleton={
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        }
        empty={(d) => d.length === 0}
        emptyState={
          onlyArchived ? (
            <EmptyState
              icon={<Archive className="h-6 w-6" />}
              title="Tất cả dự án đã được lưu trữ"
              description="Dự án đã lưu trữ chỉ đọc và đang được ẩn. Bật hiển thị để xem hoặc khôi phục."
              action={
                <Button size="sm" variant="secondary" onClick={() => setShowArchived(true)}>
                  Hiện đã lưu trữ
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<FolderKanban className="h-6 w-6" />}
              title="Chưa có dự án nào"
              description={
                canCreate
                  ? 'Dự án gom công việc, sprint và bảng của một nhóm. Tạo dự án đầu tiên để bắt đầu.'
                  : 'Nhờ quản trị thêm bạn vào một dự án.'
              }
              action={
                canCreate ? (
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4" /> Tạo dự án đầu tiên
                  </Button>
                ) : undefined
              }
            />
          )
        }
      >
        {() =>
          shown.length === 0 ? (
            <EmptyState
              icon={<Search className="h-6 w-6" />}
              title={`Không có dự án nào khớp “${query.trim()}”`}
              action={
                <Button size="sm" variant="secondary" onClick={() => setQuery('')}>
                  Xoá ô tìm
                </Button>
              }
            />
          ) : (
            <ProjectList projects={shown} recentKey={recent?.key} lastView={last} />
          )
        }
      </QueryBoundary>

      <CreateProjectModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function ProjectList({
  projects,
  recentKey,
  lastView,
}: {
  projects: ProjectDto[];
  recentKey?: string;
  lastView: { key: string; view: string } | null;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
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
        <span>Phụ trách</span>
        <span>{TERM.issue.charAt(0).toUpperCase() + TERM.issue.slice(1)}</span>
        <span className="w-32" />
      </div>
      <ul className="divide-y divide-border">
        {projects.map((p) => (
          <li
            key={p.id}
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
            {/* Dưới sm: Loại · Phụ trách · Số việc nằm chung một hàng; từ sm: mỗi thứ là một cột của bảng. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:contents">
              <span className="text-sm text-muted">{TYPE_LABEL[p.type] ?? p.type}</span>
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
        ))}
      </ul>
    </div>
  );
}
