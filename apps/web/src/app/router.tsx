import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/stores/auth';
import { AppShell } from '@/components/layout/AppShell';
import { RouteError } from '@/components/layout/RouteError';
import { RequireAccess } from '@/components/layout/RequireAccess';
import { ConnectIndexRedirect } from '@/features/connect/ConnectIndexRedirect';
import { SettingsIndexRedirect } from '@/features/settings/SettingsIndexRedirect';
import { NAV_RULES } from '@/lib/navAccess';
// Vào ngay từ đầu (unauth first paint + shell) → giữ eager, không tách chunk.
import { LoginPage } from '@/features/auth/LoginPage';
import { NoWorkspaceScreen } from '@/features/auth/NoWorkspaceScreen';
import { needsWorkspaceScreen } from '@/features/auth/workspaceGate';
import { SignupPage } from '@/features/auth/SignupPage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
// ProjectLayout dùng nhiều (board/backlog/reports…) → eager để đổi tab không nháy toàn trang;
// nội dung con của nó lazy, có Suspense riêng bên trong ProjectLayout.
import { ProjectLayout } from '@/features/projects/ProjectLayout';

// ── Lazy-load các trang nặng/không-phải-màn-đầu để giảm bundle ban đầu (mobile nhanh hơn) ──
const DashboardPage = lazy(() =>
  import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const DashboardViewPage = lazy(() =>
  import('@/features/dashboards/DashboardViewPage').then((m) => ({
    default: m.DashboardViewPage,
  })),
);
const ProjectsPage = lazy(() =>
  import('@/features/projects/ProjectsPage').then((m) => ({ default: m.ProjectsPage })),
);
const MembersPage = lazy(() =>
  import('@/features/members/MembersPage').then((m) => ({ default: m.MembersPage })),
);
const NotificationsPage = lazy(() =>
  import('@/features/notifications/NotificationsPage').then((m) => ({
    default: m.NotificationsPage,
  })),
);
const AccountPage = lazy(() =>
  import('@/features/members/AccountPage').then((m) => ({ default: m.AccountPage })),
);
const ProjectActivityPage = lazy(() =>
  import('@/features/intake/ProjectActivityPage').then((m) => ({ default: m.ProjectActivityPage })),
);
const BoardPage = lazy(() =>
  import('@/features/board/BoardPage').then((m) => ({ default: m.BoardPage })),
);
const BacklogPage = lazy(() =>
  import('@/features/backlog/BacklogPage').then((m) => ({ default: m.BacklogPage })),
);
const TriagePage = lazy(() =>
  import('@/features/triage/TriagePage').then((m) => ({ default: m.TriagePage })),
);
const TrashPage = lazy(() =>
  import('@/features/trash/TrashPage').then((m) => ({ default: m.TrashPage })),
);
const ReportsPage = lazy(() =>
  import('@/features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const GanttPage = lazy(() =>
  import('@/features/gantt/GanttPage').then((m) => ({ default: m.GanttPage })),
);
const TreePage = lazy(() =>
  import('@/features/tree/TreePage').then((m) => ({ default: m.TreePage })),
);
const ProjectConfigPage = lazy(() =>
  import('@/features/project-config/ProjectConfigPage').then((m) => ({
    default: m.ProjectConfigPage,
  })),
);
const IssueDetailPage = lazy(() =>
  import('@/features/issues/IssueDetailPage').then((m) => ({ default: m.IssueDetailPage })),
);
const FiltersPage = lazy(() =>
  import('@/features/saved-filters/FiltersPage').then((m) => ({ default: m.FiltersPage })),
);
const IntegrationsPage = lazy(() =>
  import('@/features/integrations/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage })),
);
const WorkflowSettingsPage = lazy(() =>
  import('@/features/workflow-settings/WorkflowSettingsPage').then((m) => ({
    default: m.WorkflowSettingsPage,
  })),
);
const ApiKeysPage = lazy(() =>
  import('@/features/api-keys/ApiKeysPage').then((m) => ({ default: m.ApiKeysPage })),
);
const RolesPage = lazy(() =>
  import('@/features/settings/RolesPage').then((m) => ({ default: m.RolesPage })),
);
const AuditLogPage = lazy(() =>
  import('@/features/audit/AuditLogPage').then((m) => ({ default: m.AuditLogPage })),
);
const DocumentationPage = lazy(() =>
  import('@/features/docs/DocumentationPage').then((m) => ({ default: m.DocumentationPage })),
);
const SettingsLayout = lazy(() =>
  import('@/features/settings/SettingsLayout').then((m) => ({ default: m.SettingsLayout })),
);
const SettingsGeneralPage = lazy(() =>
  import('@/features/settings/SettingsGeneralPage').then((m) => ({
    default: m.SettingsGeneralPage,
  })),
);
const SettingsNotificationsPage = lazy(() =>
  import('@/features/settings/SettingsNotificationsPage').then((m) => ({
    default: m.SettingsNotificationsPage,
  })),
);
const SettingsSeveritiesPage = lazy(() =>
  import('@/features/settings/SettingsSeveritiesPage').then((m) => ({
    default: m.SettingsSeveritiesPage,
  })),
);
const SettingsPrioritiesPage = lazy(() =>
  import('@/features/settings/SettingsPrioritiesPage').then((m) => ({
    default: m.SettingsPrioritiesPage,
  })),
);
const ImportPage = lazy(() =>
  import('@/features/import/ImportPage').then((m) => ({ default: m.ImportPage })),
);
const SettingsFieldsPage = lazy(() =>
  import('@/features/settings/SettingsFieldsPage').then((m) => ({ default: m.SettingsFieldsPage })),
);
const AdminLayout = lazy(() =>
  import('@/features/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })),
);
const AdminOverviewPage = lazy(() =>
  import('@/features/admin/AdminOverviewPage').then((m) => ({ default: m.AdminOverviewPage })),
);
const AdminWorkspacesPage = lazy(() =>
  import('@/features/admin/AdminWorkspacesPage').then((m) => ({ default: m.AdminWorkspacesPage })),
);
const AdminUsersPage = lazy(() =>
  import('@/features/admin/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })),
);
const AdminConfigPage = lazy(() =>
  import('@/features/admin/AdminConfigPage').then((m) => ({ default: m.AdminConfigPage })),
);
const AdminSystemPage = lazy(() =>
  import('@/features/admin/AdminSystemPage').then((m) => ({ default: m.AdminSystemPage })),
);
const PortfolioPage = lazy(() =>
  import('@/features/portfolio/PortfolioPage').then((m) => ({ default: m.PortfolioPage })),
);
const ClientsPage = lazy(() =>
  import('@/features/clients/ClientsPage').then((m) => ({ default: m.ClientsPage })),
);
const GoalsPage = lazy(() =>
  import('@/features/goals/GoalsPage').then((m) => ({ default: m.GoalsPage })),
);
const RaidPage = lazy(() =>
  import('@/features/raid/RaidPage').then((m) => ({ default: m.RaidPage })),
);
const ResourcesPage = lazy(() =>
  import('@/features/resources/ResourcesPage').then((m) => ({ default: m.ResourcesPage })),
);
const SlaBoardPage = lazy(() =>
  import('@/features/sla/SlaPage').then((m) => ({ default: m.SlaBoardPage })),
);
const SlaPoliciesPage = lazy(() =>
  import('@/features/sla/SlaPage').then((m) => ({ default: m.SlaPoliciesPage })),
);
const ManageLayout = lazy(() =>
  import('@/features/manage/ManageLayout').then((m) => ({ default: m.ManageLayout })),
);
const ConnectLayout = lazy(() =>
  import('@/features/connect/ConnectLayout').then((m) => ({ default: m.ConnectLayout })),
);
const WikiPage = lazy(() =>
  import('@/features/wiki/WikiPage').then((m) => ({ default: m.WikiPage })),
);
const AutomationPage = lazy(() =>
  import('@/features/automation/AutomationPage').then((m) => ({ default: m.AutomationPage })),
);
// Overlay luôn mount trong shell nhưng không cần cho first paint → lazy (fallback null, mở mới tải).
const CommandPalette = lazy(() =>
  import('@/features/command/CommandPalette').then((m) => ({ default: m.CommandPalette })),
);
const QuickAssignDialog = lazy(() =>
  import('@/features/quick-assign/QuickAssignDialog').then((m) => ({
    default: m.QuickAssignDialog,
  })),
);
const CreateIssueModal = lazy(() =>
  import('@/features/issues/CreateIssueModal').then((m) => ({ default: m.CreateIssueModal })),
);
const ReportIssueModal = lazy(() =>
  import('@/features/intake/ReportIssueModal').then((m) => ({ default: m.ReportIssueModal })),
);

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
  const user = useAuth((s) => s.user);
  const workspaceId = useAuth((s) => s.workspaceId);
  const { pathname } = useLocation();
  if (status === 'loading') {
    return (
      <div className="grid h-full place-items-center text-sm text-muted">
        <div className="animate-pulse">Đang tải Tirapro…</div>
      </div>
    );
  }
  if (status === 'guest') return <Navigate to="/login" replace />;
  // Chưa thuộc không gian làm việc nào: màn riêng thay cho khung ứng dụng (xem workspaceGate).
  if (user && needsWorkspaceScreen({ workspaceId, isSystemAdmin: user.isSystemAdmin }, pathname)) {
    return <NoWorkspaceScreen />;
  }
  return (
    <AppShell>
      <Suspense fallback={<PageLoading />}>
        <Outlet />
      </Suspense>
      <Suspense fallback={null}>
        <CommandPalette />
        <QuickAssignDialog />
        <CreateIssueModal />
        <ReportIssueModal />
      </Suspense>
    </AppShell>
  );
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  // Công khai: quên / đặt lại mật khẩu qua liên kết trong email.
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  // Trang tài liệu — công khai, độc lập, KHÔNG cần đăng nhập, có sidebar riêng.
  {
    path: '/documentation',
    element: (
      <Suspense fallback={<PageLoading />}>
        <DocumentationPage />
      </Suspense>
    ),
  },
  {
    path: '/',
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'dashboards/:id', element: <DashboardViewPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'members', element: <MembersPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
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
          { index: true, element: <SettingsIndexRedirect /> },
          {
            element: <RequireAccess rule={NAV_RULES.settingsGeneral} who="quản trị viên" />,
            children: [{ path: 'general', element: <SettingsGeneralPage /> }],
          },
          // Tab thành viên trong Cài đặt đã gộp vào trang Thành viên — giữ link cũ hoạt động.
          { path: 'members', element: <Navigate to="/members" replace /> },
          { path: 'roles', element: <RolesPage /> },
          { path: 'audit', element: <AuditLogPage /> },
          { path: 'notifications', element: <SettingsNotificationsPage /> },
          { path: 'severities', element: <SettingsSeveritiesPage /> },
          { path: 'priorities', element: <SettingsPrioritiesPage /> },
          { path: 'fields', element: <SettingsFieldsPage /> },
          { path: 'workflows', element: <WorkflowSettingsPage /> },
          {
            element: (
              <RequireAccess rule={NAV_RULES.settingsImport} who="người được phép nhập dữ liệu" />
            ),
            children: [{ path: 'import', element: <ImportPage /> }],
          },
          {
            element: <RequireAccess rule={NAV_RULES.settingsApi} who="quản trị viên" />,
            children: [{ path: 'api', element: <ApiKeysPage /> }],
          },
          { path: 'response-time', element: <SlaPoliciesPage /> },
        ],
      },
      // Quản trị — gom các màn theo dõi cấp công ty vào một mục.
      {
        path: 'manage',
        element: <ManageLayout />,
        children: [
          { index: true, element: <Navigate to="/manage/portfolio" replace /> },
          { path: 'portfolio', element: <PortfolioPage /> },
          { path: 'goals', element: <GoalsPage /> },
          { path: 'risks', element: <RaidPage /> },
          { path: 'resources', element: <ResourcesPage /> },
          { path: 'response-time', element: <SlaBoardPage /> },
          { path: 'clients', element: <ClientsPage /> },
        ],
      },
      // Kết nối & tự động hoá.
      // Không bọc cả /connect bằng RequireAccess: người chỉ quản trị MỘT dự án vào Tự động hoá qua menu "Thêm" của dự án
      // (quyền cấp dự án không có trong `/auth/me`; trang Quy tắc tự giải thích khi thiếu quyền). Chỉ tab Ứng dụng bên ngoài bị gác.
      {
        path: 'connect',
        element: <ConnectLayout />,
        children: [
          { index: true, element: <ConnectIndexRedirect /> },
          {
            element: <RequireAccess rule={NAV_RULES.connectIntegrations} who="quản trị viên" />,
            children: [{ path: 'integrations', element: <IntegrationsPage /> }],
          },
          { path: 'automation', element: <AutomationPage /> },
        ],
      },
      { path: 'wiki', element: <WikiPage /> },
      // Giữ liên kết cũ hoạt động sau khi gộp menu.
      { path: 'portfolio', element: <Navigate to="/manage/portfolio" replace /> },
      { path: 'goals', element: <Navigate to="/manage/goals" replace /> },
      { path: 'raid', element: <Navigate to="/manage/risks" replace /> },
      { path: 'resources', element: <Navigate to="/manage/resources" replace /> },
      { path: 'sla', element: <Navigate to="/manage/response-time" replace /> },
      { path: 'clients', element: <Navigate to="/manage/clients" replace /> },
      { path: 'integrations', element: <Navigate to="/connect/integrations" replace /> },
      { path: 'automation', element: <Navigate to="/connect/automation" replace /> },
      { path: 'filters', element: <FiltersPage /> },
      { path: 'issue/:key', element: <IssueDetailPage /> },
      {
        path: 'p/:key',
        element: <ProjectLayout />,
        errorElement: <RouteError />,
        children: [
          { index: true, element: <Navigate to="board" replace /> },
          { path: 'board', element: <BoardPage /> },
          { path: 'backlog', element: <BacklogPage /> },
          { path: 'triage', element: <TriagePage /> },
          { path: 'trash', element: <TrashPage /> },
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
