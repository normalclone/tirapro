import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/stores/auth';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/features/auth/LoginPage';
import { SignupPage } from '@/features/auth/SignupPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { MembersPage } from '@/features/members/MembersPage';
import { AccountPage } from '@/features/members/AccountPage';
import { ProjectActivityPage } from '@/features/intake/ProjectActivityPage';
import { ProjectLayout, ProjectsIndexRedirect } from '@/features/projects/ProjectLayout';
import { BoardPage } from '@/features/board/BoardPage';
import { BacklogPage } from '@/features/backlog/BacklogPage';
import { TriagePage } from '@/features/triage/TriagePage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import {
  SettingsLayout,
  SettingsGeneralPage,
  SettingsMembersPage,
  SettingsNotificationsPage,
  SettingsSeveritiesPage,
  SettingsPrioritiesPage,
  SettingsFieldsPage,
} from '@/features/settings/SettingsLayout';
import { RolesPage } from '@/features/settings/RolesPage';
import { IntegrationsPage } from '@/features/integrations/IntegrationsPage';
import { WorkflowSettingsPage } from '@/features/workflow-settings/WorkflowSettingsPage';
import { ApiKeysPage } from '@/features/api-keys/ApiKeysPage';
import { DocumentationPage } from '@/features/docs/DocumentationPage';
import { FiltersPage } from '@/features/saved-filters/FiltersPage';
import { ProjectConfigPage } from '@/features/project-config/ProjectConfigPage';
import { IssueDetailPage } from '@/features/issues/IssueDetailPage';
import { CreateIssueModal } from '@/features/issues/CreateIssueModal';
import { GanttPage } from '@/features/gantt/GanttPage';
import { TreePage } from '@/features/tree/TreePage';
import { AdminUsersPage } from '@/features/admin/AdminUsersPage';
import { AdminLayout } from '@/features/admin/AdminLayout';
import { AdminOverviewPage } from '@/features/admin/AdminOverviewPage';
import { AdminWorkspacesPage } from '@/features/admin/AdminWorkspacesPage';
import { AdminConfigPage } from '@/features/admin/AdminConfigPage';
import { AdminSystemPage } from '@/features/admin/AdminSystemPage';
import { CommandPalette } from '@/features/command/CommandPalette';

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
      <Outlet />
      <CommandPalette />
      <CreateIssueModal />
    </AppShell>
  );
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  // Trang tài liệu — công khai, độc lập, KHÔNG cần đăng nhập, có sidebar riêng.
  { path: '/documentation', element: <DocumentationPage /> },
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
