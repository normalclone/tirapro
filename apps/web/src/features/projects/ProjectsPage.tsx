import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, ArrowRight, FolderKanban, FolderTree, Plus, Search } from 'lucide-react';
import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { lastViewKey } from '@/lib/currentProject';
import { APP_NAV_LABELS } from '@/lib/navLabels';
import { useAuth } from '@/stores/auth';
import { useProjects } from './api';
import { CreateProjectModal } from './CreateProjectModal';
import { filterProjects, sortProjects, type ProjectSort } from './projectsFilter';
import { useProgramRefs } from './groups/api';
import { GroupTree } from './groups/GroupTree';
import { ManageGroupsDialog } from './groups/ManageGroupsDialog';
import { buildGroupTree, groupCounts } from './groups/groupModel';
import { useProjectsView } from './groups/groupsView';
import { ProjectList } from './ProjectsTable';
import { ProjectsToolbar } from './ProjectsToolbar';
import { useShowArchived } from './showArchived';

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
  const [manageOpen, setManageOpen] = useState(false);
  const [view, setView] = useProjectsView();
  const canManageGroups = useAuth((s) => s.can('program:manage'));
  const programRefs = useProgramRefs();
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

  const searching = query.trim() !== '';
  // Cây dựng từ danh sách ĐÃ lọc (tìm kiếm + "Hiện đã lưu trữ"): số dự án của nhóm khớp với những gì đang hiện.
  const tree = useMemo(
    () => buildGroupTree(shown, programRefs, { hideEmpty: searching }),
    [shown, programRefs, searching],
  );
  // Hộp "Quản lý nhóm" đếm theo danh sách theo công tắc lưu trữ (không theo ô tìm).
  const counts = useMemo(() => groupCounts(projects ?? []), [projects]);

  const createButton =
    canCreate || canManageGroups ? (
      <>
        {canManageGroups && (
          <Button size="sm" variant="secondary" onClick={() => setManageOpen(true)}>
            <FolderTree className="h-4 w-4" /> Quản lý nhóm
          </Button>
        )}
        {canCreate && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Tạo dự án
          </Button>
        )}
      </>
    ) : undefined;

  return (
    <PageFrame size="xl">
      <PageHeader title={APP_NAV_LABELS.projects} actions={createButton} />

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

      <ProjectsToolbar
        query={query}
        onQuery={setQuery}
        showArchived={showArchived}
        onShowArchived={setShowArchived}
        view={view}
        onView={setView}
        sort={sort}
        onSort={setSort}
      />

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
                  <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
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
          ) : view === 'groups' ? (
            <GroupTree
              groups={tree}
              programs={programRefs}
              recentKey={recent?.key}
              lastView={last}
              forceOpen={searching}
            />
          ) : (
            <ProjectList
              projects={shown}
              programs={programRefs}
              recentKey={recent?.key}
              lastView={last}
            />
          )
        }
      </QueryBoundary>

      <CreateProjectModal open={createOpen} onClose={() => setCreateOpen(false)} />
      {canManageGroups && (
        <ManageGroupsDialog
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          counts={counts}
        />
      )}
    </PageFrame>
  );
}
