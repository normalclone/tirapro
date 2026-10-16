import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  type LucideIcon,
  Activity,
  Archive,
  BarChart3,
  ChevronDown,
  FolderX,
  GanttChartSquare,
  Inbox,
  LayoutGrid,
  ListTodo,
  ListTree,
  MoreHorizontal,
  Plus,
  Repeat,
  Settings,
  ShieldAlert,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { PermissionKey } from '@tirapro/types';
import { useProject, useProjects } from './api';
import { ProjectRail } from './ProjectRail';
import { GenerateIssuesDialog } from '@/features/ai/GenerateIssuesDialog';
import { Button } from '@/components/ui/Button';
import { useAi } from '@/stores/ai';
import { useCan, useProjectPermissions } from './permissions';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { apiErrorCode } from '@/lib/api';
import { useCreateIssueModal } from '@/stores/createIssue';
import { cn } from '@/lib/utils';
import { useProjectRealtime } from '@/lib/realtime';
import { LAST_ACTIVE_KEY, LAST_VIEW_KEY } from '@/lib/currentProject';
import { withKey } from '@/lib/shortcuts';
import { useScrollFade } from '@/lib/useScrollFade';
import { activeMoreSeg, tabLabelVisible } from './projectTabs';

const VIEWS = [
  { seg: 'board', label: 'Bảng việc', icon: LayoutGrid },
  { seg: 'backlog', label: 'Việc chờ', icon: ListTodo },
  { seg: 'gantt', label: 'Lịch trình', icon: GanttChartSquare },
  { seg: 'tree', label: 'Cây việc', icon: ListTree },
  { seg: 'reports', label: 'Báo cáo', icon: BarChart3 },
] as const;

/** Mục menu "Thêm": `to` dựng đường dẫn; `needs` = quyền cấp dự án để hiện mục (không có thì ẩn). */
const MORE: {
  id: string;
  label: string;
  icon: LucideIcon;
  to: (p: { key: string; id: string }) => string;
  needs?: PermissionKey;
}[] = [
  { id: 'triage', label: 'Việc mới vào', icon: Inbox, to: (p) => `/p/${p.key}/triage` },
  { id: 'activity', label: 'Hoạt động', icon: Activity, to: (p) => `/p/${p.key}/activity` },
  // Rủi ro và Tự động hoá dùng trang sẵn có, lọc sẵn theo dự án này qua `?project=<id>`.
  {
    id: 'risks',
    label: 'Rủi ro & vướng mắc',
    icon: ShieldAlert,
    to: (p) => `/manage/risks?project=${p.id}`,
  },
  {
    id: 'automation',
    label: 'Tự động hoá',
    icon: Repeat,
    to: (p) => `/connect/automation?project=${p.id}`,
    needs: 'automation:manage',
  },
  {
    id: 'trash',
    label: 'Thùng rác',
    icon: Trash2,
    to: (p) => `/p/${p.key}/trash`,
    needs: 'issue:delete',
  },
  { id: 'config', label: 'Cấu hình', icon: Settings, to: (p) => `/p/${p.key}/config` },
];

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
  const { data: project, isPending: projectPending, error: projectError } = useProject(key);
  // 404 gồm cả dự án riêng tư mà người xem không được thấy (API cố ý không phân biệt với không tồn tại).
  const notFound = apiErrorCode(projectError) === 'NOT_FOUND';
  const permsPending = useProjectPermissions(project?.id).isPending;
  const canProject = useCan(project?.id);
  const canAdminProject = canProject('project:admin');
  // Thô (không tính lưu trữ): dự án lưu trữ vẫn hiện nút nhưng tắt kèm giải thích; Viewer không có quyền tạo thì không thấy nút.
  const canCreateIssue = canProject('issue:create');
  const { data: projects } = useProjects();
  // Một lần cho mọi tab của project: vá cache issue/sprint khi người khác thao tác.
  useProjectRealtime(project?.id);

  const [genOpen, setGenOpen] = useState(false);
  const hasPicker = !!projects && projects.length > 1;

  const seg = loc.pathname.split('/')[3] || 'board';
  // Segment thực sự là "view" (bỏ qua create/issue…) để rail link đúng + không ghi đè lastView.
  const KNOWN_VIEWS = new Set([
    'board',
    'backlog',
    'gantt',
    'tree',
    'reports',
    'triage',
    'trash',
    'activity',
    'config',
  ]);
  const view = KNOWN_VIEWS.has(seg) ? seg : 'board';
  useEffect(() => {
    if (key && KNOWN_VIEWS.has(seg)) {
      try {
        localStorage.setItem(LAST_VIEW_KEY, JSON.stringify({ key, view: seg }));
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, seg]);
  // Nhớ dự án HOẠT ĐỘNG xem gần nhất để "Tạo việc" có dự án thay thế đúng khi đang ở dự án lưu trữ.
  const activeKey = project && !project.archivedAt ? project.key : null;
  useEffect(() => {
    if (!activeKey) return;
    try {
      localStorage.setItem(LAST_ACTIVE_KEY, activeKey);
    } catch {
      /* ignore */
    }
  }, [activeKey]);

  // Dưới sm: tab là ô vuông ≥44px chỉ có biểu tượng; tab ĐANG MỞ xếp dọc biểu tượng + nhãn nhỏ bên dưới.
  const tabCls = (active: boolean) =>
    cn(
      'flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors sm:px-2.5',
      'max-sm:min-h-11 max-sm:min-w-11 max-sm:flex-col max-sm:justify-center max-sm:gap-0.5 max-sm:py-1',
      active ? 'bg-primary-subtle text-primary' : 'text-muted hover:bg-surface-2 hover:text-ink',
    );
  const moreSeg = activeMoreSeg(seg);
  const moreLabel = MORE.find((m) => m.id === moreSeg)?.label;
  // Dải tab cuộn ngang khi thừa; mục đang mở tự cuộn vào khung (`aria-current` do NavLink đặt; nút "Thêm" tự đặt khi ở màn của nó).
  const tabsFade = useScrollFade<HTMLDivElement>(seg, '[aria-current="page"]');

  return (
    <div className="flex h-full min-h-0 print:block print:h-auto">
      {/* Rail dự án (submenu bên trái) — dùng chung với trang chi tiết issue */}
      <ProjectRail activeKey={key} view={view} withEpicPanel={view === 'backlog'} />

      {/* Nội dung: thanh nav view cố định + view hiện tại */}
      <div className="flex min-w-0 flex-1 flex-col print:block">
        <div
          data-audit="project-header"
          className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-border px-4 py-3 sm:px-6 print:hidden"
        >
          {/* Chuyển dự án trên mobile/tablet (rail dự án ẩn dưới lg) */}
          {hasPicker && (
            <div className="relative min-w-0 max-w-xs flex-1 lg:hidden">
              <select
                value={key}
                onChange={(e) => navigate(`/p/${e.target.value}/${view}`)}
                aria-label="Chuyển dự án"
                className="h-9 w-full truncate rounded-md border border-border bg-surface pl-2.5 pr-7 text-sm font-medium text-ink transition-colors focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.key}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
                aria-hidden
              />
            </div>
          )}
          {project?.avatarUrl && (
            <img
              src={project.avatarUrl}
              alt={project.name}
              className={cn(
                'h-6 w-6 shrink-0 rounded-md object-cover',
                hasPicker && 'hidden lg:block',
              )}
            />
          )}
          {/* Dưới lg đã có ô chọn dự án (hiện tên) → không lặp tên dự án lần hai. */}
          <h1
            className={cn(
              'min-w-0 truncate text-lg font-semibold tracking-tight',
              hasPicker && 'hidden lg:block',
            )}
          >
            {project?.name ?? key}
          </h1>
          <span
            className={cn(
              'rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted',
              hasPicker ? 'hidden lg:inline' : 'shrink-0',
            )}
          >
            {project?.key ?? key}
          </span>

          {(projectPending || (!!project?.id && permsPending)) && (
            // Giữ chỗ cùng kích thước nút Tạo/AI trong lúc quyền đang tải → không nhảy bố cục khi nút hiện ra.
            <Skeleton
              aria-hidden
              className={cn(
                'ml-auto h-8 rounded-md sm:ml-2',
                aiEnabled ? 'w-24 max-sm:h-11 sm:w-56' : 'w-11 max-sm:h-11 sm:w-32',
              )}
            />
          )}
          {canCreateIssue && (
            <>
              <Button
                size="sm"
                className="ml-auto max-sm:h-11 max-sm:w-11 max-sm:px-0 sm:ml-2"
                onClick={() => openCreate({ projectKey: key })}
                disabled={!project?.id || !!project.archivedAt}
                title={
                  project?.archivedAt
                    ? 'Dự án đã lưu trữ — chỉ đọc'
                    : withKey('Tạo công việc', 'global.create')
                }
                aria-label="Tạo công việc"
                data-tour="project-create-issue"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Tạo công việc</span>
              </Button>
              {aiEnabled && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="max-sm:h-11 max-sm:w-11 max-sm:px-0"
                  title="Tạo bằng AI"
                  onClick={() => setGenOpen(true)}
                  disabled={!project?.id || !!project.archivedAt}
                  data-tour="board-ai"
                  aria-label="Tạo bằng AI"
                >
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span className="hidden sm:inline">Tạo bằng AI</span>
                </Button>
              )}
            </>
          )}

          {/* Dải tab MỘT hàng: dưới lg xuống hàng riêng, tab không hoạt động chỉ còn biểu tượng (dưới sm) để "Thêm" luôn trong màn hình. */}
          <div
            ref={tabsFade.ref}
            style={tabsFade.style}
            className={cn(
              'relative order-last flex w-full items-center gap-0.5 overflow-x-auto whitespace-nowrap max-sm:scrollbar-none max-sm:[mask-image:var(--scroll-fade)] lg:order-none lg:ml-auto lg:w-auto lg:gap-1',
              notFound && 'hidden',
            )}
            data-tour="project-views"
          >
            {VIEWS.map((v) => (
              <NavLink
                key={v.seg}
                to={`/p/${key}/${v.seg}`}
                title={v.label}
                aria-label={v.label}
                className={({ isActive }) => tabCls(isActive)}
                data-tour={v.seg === 'backlog' ? 'board-backlog' : undefined}
              >
                {({ isActive }) => (
                  <>
                    <v.icon className="h-4 w-4 shrink-0" />
                    <span
                      className={cn(
                        'max-sm:text-[11px] max-sm:leading-none',
                        !tabLabelVisible(isActive) && 'hidden sm:inline',
                      )}
                    >
                      {v.label}
                    </span>
                  </>
                )}
              </NavLink>
            ))}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  aria-label={moreLabel ?? 'Thêm'}
                  title={moreLabel ?? 'Thêm'}
                  aria-current={moreSeg ? 'page' : undefined}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] data-[state=open]:bg-surface-2 sm:px-2.5',
                    'max-sm:min-h-11 max-sm:min-w-11 max-sm:flex-col max-sm:justify-center max-sm:gap-0.5 max-sm:py-1',
                    moreSeg
                      ? 'bg-primary-subtle text-primary'
                      : 'text-muted hover:bg-surface-2 hover:text-ink',
                  )}
                >
                  {/* Mobile: biểu tượng "…" (+ tên màn đang mở nếu thuộc Thêm); từ sm: chữ "Thêm" + mũi tên như cũ. */}
                  <MoreHorizontal className="h-4 w-4 shrink-0 sm:hidden" aria-hidden />
                  {moreLabel && (
                    <span className="max-w-[5.5rem] truncate text-[11px] leading-none sm:hidden">
                      {moreLabel}
                    </span>
                  )}
                  <span className="max-sm:hidden">Thêm</span>
                  <ChevronDown className="h-3.5 w-3.5 text-faint max-sm:hidden" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={6}
                  className="z-dropdown w-48 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg animate-in fade-in zoom-in-95 duration-150"
                >
                  {MORE.filter((m) => !m.needs || canProject(m.needs))
                    .filter((m) => project?.id || (m.id !== 'risks' && m.id !== 'automation'))
                    .map((m) => (
                      <DropdownMenu.Item key={m.id} asChild>
                        <Link
                          to={m.to({ key, id: project?.id ?? '' })}
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

        {project?.archivedAt && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-2 border-b border-border bg-warning/10 px-6 py-2 text-sm text-ink"
          >
            <Archive className="h-4 w-4 shrink-0 text-muted" aria-hidden />
            <span className="font-medium">Dự án đã lưu trữ — chỉ đọc.</span>
            <span className="text-muted">
              Không tạo hay sửa được việc, sprint và bảng.{' '}
              {canAdminProject ? (
                <Link
                  to={`/p/${key}/config`}
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  Khôi phục dự án trong Cấu hình
                </Link>
              ) : (
                'Nhờ quản trị dự án khôi phục nếu cần làm việc tiếp.'
              )}
            </span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto print:overflow-visible">
          <Suspense
            fallback={
              <div className="grid h-full min-h-[40vh] place-items-center py-20 text-sm text-muted">
                <span className="animate-pulse">Đang tải…</span>
              </div>
            }
          >
            {notFound ? (
              <div className="mx-auto max-w-md px-6 py-16">
                <EmptyState
                  icon={<FolderX className="h-6 w-6" />}
                  title="Không tìm thấy dự án"
                  description="Dự án không tồn tại, đã bị xoá hoặc bạn không có quyền xem. Chọn một dự án khác ở danh sách bên trái."
                />
              </div>
            ) : (
              <Outlet />
            )}
          </Suspense>
        </div>
      </div>

      {project?.id && aiEnabled && (
        <GenerateIssuesDialog
          projectKey={key}
          projectId={project.id}
          open={genOpen}
          onClose={() => setGenOpen(false)}
        />
      )}
    </div>
  );
}
