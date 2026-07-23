import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/stores/auth';
import { AppShell } from '@/components/layout/AppShell';
// Vào ngay từ đầu (unauth first paint + shell) → giữ eager, không tách chunk.
import { LoginPage } from '@/features/auth/LoginPage';
import { SignupPage } from '@/features/auth/SignupPage';
// ProjectLayout dùng nhiều (board/backlog/reports…) → eager để đổi tab không nháy toàn trang;
// nội dung con của nó lazy, có Suspense riêng bên trong ProjectLayout.
import { ProjectLayout, ProjectsIndexRedirect } from '@/features/projects/ProjectLayout';

// ── Lazy-load các trang nặng/không-phải-màn-đầu để giảm bundle ban đầu (mobile nhanh hơn) ──
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const MembersPage = lazy(() => import('@/features/members/MembersPage').then((m) => ({ default: m.MembersPage })));
const AccountPage = lazy(() => import('@/features/members/AccountPage').then((m) => ({ default: m.AccountPage })));
const ProjectActivityPage = lazy(() => import('@/features/intake/ProjectActivityPage').then((m) => ({ default: m.ProjectActivityPage })));
const BoardPage = lazy(() => import('@/features/board/BoardPage').then((m) => ({ default: m.BoardPage })));
const BacklogPage = lazy(() => import('@/features/backlog/BacklogPage').then((m) => ({ default: m.BacklogPage })));
const TriagePage = lazy(() => import('@/features/triage/TriagePage').then((m) => ({ default: m.TriagePage })));
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const GanttPage = lazy(() => import('@/features/gantt/GanttPage').then((m) => ({ default: m.GanttPage })));
const TreePage = lazy(() => import('@/features/tree/TreePage').then((m) => ({ default: m.TreePage })));
const ProjectConfigPage = lazy(() => import('@/features/project-config/ProjectConfigPage').then((m) => ({ default: m.ProjectConfigPage })));
const IssueDetailPage = lazy(() => import('@/features/issues/IssueDetailPage').then((m) => ({ default: m.IssueDetailPage })));
const FiltersPage = lazy(() => import('@/features/saved-filters/FiltersPage').then((m) => ({ default: m.FiltersPage })));
const IntegrationsPage = lazy(() => import('@/features/integrations/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage })));
const WorkflowSettingsPage = lazy(() => import('@/features/workflow-settings/WorkflowSettingsPage').then((m) => ({ default: m.WorkflowSettingsPage })));
const ApiKeysPage = lazy(() => import('@/features/api-keys/ApiKeysPage').then((m) => ({ default: m.ApiKeysPage })));
const RolesPage = lazy(() => import('@/features/settings/RolesPage').then((m) => ({ default: m.RolesPage })));
const DocumentationPage = lazy(() => import('@/features/docs/DocumentationPage').then((m) => ({ default: m.DocumentationPage })));
const SettingsLayout = lazy(() => import('@/features/settings/SettingsLayout').then((m) => ({ default: m.SettingsLayout })));
const SettingsGeneralPage = lazy(() => import('@/features/settings/SettingsLayout').then((m) => ({ default: m.SettingsGeneralPage })));
const SettingsMembersPage = lazy(() => import('@/features/settings/SettingsLayout').then((m) => ({ default: m.SettingsMembersPage })));
const SettingsNotificationsPage = lazy(() => import('@/features/settings/SettingsLayout').then((m) => ({ default: m.SettingsNotificationsPage })));
const SettingsSeveritiesPage = lazy(() => import('@/features/settings/SettingsLayout').then((m) => ({ default: m.SettingsSeveritiesPage })));
const SettingsPrioritiesPage = lazy(() => import('@/features/settings/SettingsLayout').then((m) => ({ default: m.SettingsPrioritiesPage })));
const SettingsFieldsPage = lazy(() => import('@/features/settings/SettingsLayout').then((m) => ({ default: m.SettingsFieldsPage })));
const AdminLayout = lazy(() => import('@/features/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })));
const AdminOverviewPage = lazy(() => import('@/features/admin/AdminOverviewPage').then((m) => ({ default: m.AdminOverviewPage })));
const AdminWorkspacesPage = lazy(() => import('@/features/admin/AdminWorkspacesPage').then((m) => ({ default: m.AdminWorkspacesPage })));
const AdminUsersPage = lazy(() => import('@/features/admin/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })));
const AdminConfigPage = lazy(() => import('@/features/admin/AdminConfigPage').then((m) => ({ default: m.AdminConfigPage })));
const AdminSystemPage = lazy(() => import('@/features/admin/AdminSystemPage').then((m) => ({ default: m.AdminSystemPage })));
// Overlay luôn mount trong shell nhưng không cần cho first paint → lazy (fallback null, mở mới tải).
const CommandPalette = lazy(() => import('@/features/command/CommandPalette').then((m) => ({ default: m.CommandPalette })));
const CreateIssueModal = lazy(() => import('@/features/issues/CreateIssueModal').then((m) => ({ default: m.CreateIssueModal })));

/** Loader gọn cho vùng nội dung khi chunk đang tải. */
function PageLoading() {
  return (
    <div className="grid h-full min-h-[40vh] place-items-center py-20 text-sm text-muted">
      <div className="animate-pulse">Đang tải…</div>
    </div>
  );
}

function RequireAuth() {
  const status = useAuth((s) => s.status);
  if (status === 'loading') {
    return (
      <div className="grid h-full place-items-center text-sm text-muted">
        <div className="animate-pulse">Đang tải Tirapro…</div>
      </div>
    );
  }
  if (status === 'guest') return <Navigate to="/login" replace />;
  return (
    <AppShell>
      <Suspense fallback={<PageLoading />}>
        <Outlet />
      </Suspense>
      <Suspense fallback={null}>
        <CommandPalette />
        <CreateIssueModal />
      </Suspense>
    </AppShell>
  );
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  // Trang tài liệu — công khai, độc lập, KHÔNG cần đăng nhập, có sidebar riêng.
  { path: '/documentation', element: <Suspense fallback={<PageLoading />}><DocumentationPage /></Suspense> },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'projects', element: <ProjectsIndexRedirect /> },
      { path: 'members', element: <MembersPage /> },
      { path: 'account', element: <AccountPage /> },
      {
        path: 'admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminOverviewPage /> },
          { path: 'workspaces', element: <AdminWorkspacesPage /> },
          { path: 'accounts', element: <AdminUsersPage /> },
          { path: 'config', element: <AdminConfigPage /> },
          { path: 'system', element: <AdminSystemPage /> },
        ],
      },
      {
        path: 'settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="/settings/general" replace /> },
          { path: 'general', element: <SettingsGeneralPage /> },
          { path: 'members', element: <SettingsMembersPage /> },
          { path: 'roles', element: <RolesPage /> },
          { path: 'notifications', element: <SettingsNotificationsPage /> },
          { path: 'severities', element: <SettingsSeveritiesPage /> },
          { path: 'priorities', element: <SettingsPrioritiesPage /> },
          { path: 'fields', element: <SettingsFieldsPage /> },
          { path: 'workflows', element: <WorkflowSettingsPage /> },
          { path: 'api', element: <ApiKeysPage /> },
        ],
      },
      { path: 'integrations', element: <IntegrationsPage /> },
      { path: 'filters', element: <FiltersPage /> },
      { path: 'issue/:key', element: <IssueDetailPage /> },
      {
        path: 'p/:key',
        element: <ProjectLayout />,
        children: [
          { index: true, element: <Navigate to="board" replace /> },
          { path: 'board', element: <BoardPage /> },
          { path: 'backlog', element: <BacklogPage /> },
          { path: 'triage', element: <TriagePage /> },
          { path: 'activity', element: <ProjectActivityPage /> },
          { path: 'reports', element: <ReportsPage /> },
          { path: 'gantt', element: <GanttPage /> },
          { path: 'tree', element: <TreePage /> },
          { path: 'config', element: <ProjectConfigPage /> },
        ],
      },
    ],
  },
]);
