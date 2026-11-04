import { FolderTree, List, Search } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { PROJECTS_VIEW_LABEL, type ProjectsView } from './groups/groupsView';
import { PROJECT_SORT_LABEL, type ProjectSort } from './projectsFilter';

/** Thanh công cụ trang Dự án: tìm kiếm · "Hiện đã lưu trữ" · chế độ xem (Danh sách / Theo nhóm) · sắp xếp. */
export function ProjectsToolbar({
  query,
  onQuery,
  showArchived,
  onShowArchived,
  view,
  onView,
  sort,
  onSort,
}: {
  query: string;
  onQuery: (q: string) => void;
  showArchived: boolean;
  onShowArchived: (v: boolean) => void;
  view: ProjectsView;
  onView: (v: ProjectsView) => void;
  sort: ProjectSort;
  onSort: (s: ProjectSort) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="relative w-full min-w-[12rem] max-w-sm sm:flex-1">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Tìm theo tên, mã hoặc người phụ trách"
          aria-label="Tìm dự án"
          className="pl-8"
        />
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => onShowArchived(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-border accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
        Hiện đã lưu trữ
      </label>
      <div className="flex items-center gap-2 text-sm text-muted sm:ml-auto">
        <span id="project-view-label" className="sr-only">
          Chế độ xem
        </span>
        <SegmentedControl<ProjectsView>
          ariaLabelledby="project-view-label"
          size="sm"
          fullWidth={false}
          value={view}
          onChange={onView}
          options={(Object.keys(PROJECTS_VIEW_LABEL) as ProjectsView[]).map((m) => ({
            value: m,
            label: PROJECTS_VIEW_LABEL[m],
            icon:
              m === 'list' ? (
                <List className="h-3.5 w-3.5" />
              ) : (
                <FolderTree className="h-3.5 w-3.5" />
              ),
          }))}
        />
        <span id="project-sort-label">Sắp xếp</span>
        <SegmentedControl<ProjectSort>
          ariaLabelledby="project-sort-label"
          size="sm"
          fullWidth={false}
          value={sort}
          onChange={onSort}
          options={(Object.keys(PROJECT_SORT_LABEL) as ProjectSort[]).map((m) => ({
            value: m,
            label: PROJECT_SORT_LABEL[m],
          }))}
        />
      </div>
    </div>
  );
}
