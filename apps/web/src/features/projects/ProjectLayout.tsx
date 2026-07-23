import { Suspense, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Activity, BarChart3, ChevronDown, GanttChartSquare, Inbox, LayoutGrid,
  ListTodo, ListTree, Plus, Settings, Sparkles,
} from 'lucide-react';
import { useProject, useProjects } from './api';
import { CreateProjectModal } from './CreateProjectModal';
import { ProjectRail } from './ProjectRail';
import { GenerateIssuesDialog } from '@/features/ai/GenerateIssuesDialog';
import { Button } from '@/components/ui/Button';
import { useAi } from '@/stores/ai';
import { useCreateIssueModal } from '@/stores/createIssue';
import { cn } from '@/lib/utils';

/** localStorage: view cơ bản người dùng mở gần nhất (để /projects mở lại đúng view). */
export const LAST_VIEW_KEY = 'tirapro:lastProjectView';

const VIEWS = [
  { seg: 'board', label: 'Board', icon: LayoutGrid },
  { seg: 'backlog', label: 'Backlog', icon: ListTodo },
  { seg: 'gantt', label: 'Lịch trình', icon: GanttChartSquare },
  { seg: 'tree', label: 'Cây', icon: ListTree },
  { seg: 'reports', label: 'Báo cáo', icon: BarChart3 },
] as const;

const MORE = [
  { seg: 'triage', label: 'Triage', icon: Inbox },
  { seg: 'activity', label: 'Hoạt động', icon: Activity },
  { seg: 'config', label: 'Cấu hình', icon: Settings },
] as const;

/**
 * Khung cho mọi màn trong 1 dự án: rail dự án bên trái (+ tạo dự án) + thanh nav view
 * CỐ ĐỊNH (Board/Backlog/Lịch trình/Cây/Báo cáo/Thêm) dùng chung cho tất cả view.
 * View đang xem được lưu vào localStorage → lần sau vào "Dự án" mở đúng view đó.
 */
export function ProjectLayout() {
  const { key = '' } = useParams();
  const loc = useLocation();
  const navigate = useNavigate();
  const aiEnabled = useAi((s) => s.enabled);
  const openCreate = useCreateIssueModal((s) => s.openCreate);
  const { data: project } = useProject(key);
  const { data: projects } = useProjects();

  const [genOpen, setGenOpen] = useState(false);

  const seg = loc.pathname.split('/')[3] || 'board';
  // Segment thực sự là "view" (bỏ qua create/issue…) để rail link đúng + không ghi đè lastView.
  const KNOWN_VIEWS = new Set(['board', 'backlog', 'gantt', 'tree', 'reports', 'triage', 'activity', 'config']);
  const view = KNOWN_VIEWS.has(seg) ? seg : 'board';
  useEffect(() => {
    if (key && KNOWN_VIEWS.has(seg)) {
      try { localStorage.setItem(LAST_VIEW_KEY, JSON.stringify({ key, view: seg })); } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, seg]);

  const tabCls = (active: boolean) =>
    cn(
      'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
      active ? 'bg-primary-subtle text-primary' : 'text-muted hover:bg-surface-2 hover:text-ink',
    );

  return (
    <div className="flex h-full min-h-0">
      {/* Rail dự án (submenu bên trái) — dùng chung với trang chi tiết issue */}
      <ProjectRail activeKey={key} view={view} />

      {/* Nội dung: thanh nav view cố định + view hiện tại */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
          {/* Chuyển dự án trên mobile/tablet (rail dự án ẩn dưới lg) */}
          {projects && projects.length > 1 && (
            <div className="relative lg:hidden">
              <select
                value={key}
                onChange={(e) => navigate(`/p/${e.target.value}/${view}`)}
                aria-label="Chuyển dự án"
                className="h-8 max-w-[10rem] truncate rounded-md border border-border bg-surface pl-2.5 pr-7 text-sm font-medium text-ink transition-colors focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.key}>{p.name}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" aria-hidden />
            </div>
          )}
          {project?.avatarUrl && (
            <img src={project.avatarUrl} alt={project.name} className="h-6 w-6 shrink-0 rounded-md object-cover" />
          )}
          <h1 className="text-lg font-semibold tracking-tight">{project?.name ?? key}</h1>
          <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted">{project?.key ?? key}</span>

          <Button size="sm" className="ml-2" onClick={() => openCreate({ projectKey: key })} disabled={!project?.id}>
            <Plus className="h-4 w-4" /> Tạo issue
          </Button>
          {aiEnabled && (
            <Button variant="secondary" size="sm" onClick={() => setGenOpen(true)} disabled={!project?.id} data-tour="board-ai">
              <Sparkles className="h-4 w-4 text-primary" /> Tạo bằng AI
            </Button>
          )}

          <div className="ml-auto flex items-center gap-1">
            {VIEWS.map((v) => (
              <NavLink key={v.seg} to={`/p/${key}/${v.seg}`} className={({ isActive }) => tabCls(isActive)} data-tour={v.seg === 'backlog' ? 'board-backlog' : undefined}>
                <v.icon className="h-4 w-4" />
                {v.label}
              </NavLink>
            ))}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] data-[state=open]:bg-surface-2"
                >
                  Thêm
                  <ChevronDown className="h-3.5 w-3.5 text-faint" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={6}
                  className="z-dropdown w-48 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg animate-in fade-in zoom-in-95 duration-150"
                >
                  {MORE.map((m) => (
                    <DropdownMenu.Item key={m.seg} asChild>
                      <Link
                        to={`/p/${key}/${m.seg}`}
                        className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink outline-none transition-colors data-[highlighted]:bg-surface-2"
                      >
                        <m.icon className="h-4 w-4 text-muted" />
                        {m.label}
                      </Link>
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <Suspense fallback={<div className="grid h-full min-h-[40vh] place-items-center py-20 text-sm text-muted"><span className="animate-pulse">Đang tải…</span></div>}>
            <Outlet />
          </Suspense>
        </div>
      </div>

      {project?.id && aiEnabled && (
        <GenerateIssuesDialog projectKey={key} projectId={project.id} open={genOpen} onClose={() => setGenOpen(false)} />
      )}
    </div>
  );
}

/** /projects → mở lại view gần nhất (hoặc board của dự án đầu tiên). */
export function ProjectsIndexRedirect() {
  const { data: projects } = useProjects();
  const [createOpen, setCreateOpen] = useState(false);

  if (!projects) {
    return <div className="grid h-full place-items-center text-sm text-muted"><span className="animate-pulse">Đang tải…</span></div>;
  }
  if (projects.length === 0) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <p className="text-sm text-muted">Chưa có dự án nào.</p>
          <Button size="sm" className="mt-3" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Tạo dự án</Button>
        </div>
        <CreateProjectModal open={createOpen} onClose={() => setCreateOpen(false)} />
      </div>
    );
  }
  let saved: { key?: string; view?: string } = {};
  try { saved = JSON.parse(localStorage.getItem(LAST_VIEW_KEY) || '{}'); } catch { /* ignore */ }
  const target = saved.key && projects.some((p) => p.key === saved.key) ? saved.key : projects[0].key;
  const view = saved.view || 'board';
  return <Navigate to={`/p/${target}/${view}`} replace />;
}
