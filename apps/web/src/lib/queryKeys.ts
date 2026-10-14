import type { GoalFilter } from '@/features/goals/api';
import type { RaidFilter } from '@/features/raid/api';
import type { IntegrationType } from '@/features/integrations/api';
import type { RoleScope } from '@tirapro/types';

/**
 * Nơi DUY NHẤT định nghĩa query key của web.
 *
 * Quy ước:
 * - Key "gốc" (`all`, `...Root`) là tiền tố của các key con → dùng để invalidate cả nhóm.
 * - Mọi thứ thuộc về một issue nằm dưới `['issues', <loại>, <id>]`, nên `keys.issues.all`
 *   làm mới được toàn bộ dữ liệu issue; muốn hẹp hơn thì dùng key con cụ thể.
 * - Danh sách issue của MỘT project chỉ có một cache: `keys.issues.byProject(pid)`
 *   (board, backlog, gantt, tree, chi tiết issue đều đọc chung).
 */
export const keys = {
  me: ['me'] as const,

  projects: {
    all: ['projects'] as const,
    byKey: (key: string) => ['project', key] as const,
    /** Cùng tiền tố `all` nên invalidate `all` làm mới cả hai. */
    withArchived: ['projects', 'with-archived'] as const,
    activity: (projectId: string) => ['project-activity', projectId] as const,
  },

  issues: {
    all: ['issues'] as const,
    byProject: (projectId: string) => ['issues', 'project', projectId] as const,
    /** Việc của MỘT board có bộ lọc JQL (board không lọc thì dùng `byProject`). */
    byBoard: (boardId: string) => ['issues', 'board', boardId] as const,
    byKey: (key: string) => ['issues', 'key', key] as const,
    comments: (issueId: string) => ['issues', 'comments', issueId] as const,
    devLinks: (issueId: string) => ['issues', 'dev-links', issueId] as const,
    activity: (issueId: string) => ['issues', 'activity', issueId] as const,
    watch: (issueId: string) => ['issues', 'watch', issueId] as const,
    watchers: (issueId: string) => ['issues', 'watchers', issueId] as const,
    links: (issueId: string) => ['issues', 'links', issueId] as const,
    participants: (issueId: string) => ['issues', 'participants', issueId] as const,
    checklist: (issueId: string) => ['issues', 'checklist', issueId] as const,
    customFields: (issueId: string) => ['issues', 'custom-fields', issueId] as const,
    sla: (issueId: string) => ['issues', 'sla', issueId] as const,
    attachments: (issueId: string) => ['issues', 'attachments', issueId] as const,
    worklogs: (issueId: string) => ['issues', 'worklogs', issueId] as const,
    linkTypes: ['issues', 'link-types'] as const,
  },

  sprints: {
    byProject: (projectId: string) => ['sprints', projectId] as const,
  },

  boards: {
    byProject: (projectId: string) => ['boards', projectId] as const,
  },

  notifications: {
    all: ['notifications'] as const,
    list: ['notifications', 'list'] as const,
    unread: ['notifications', 'unread'] as const,
  },

  system: {
    announcement: ['system-announcement'] as const,
  },

  search: {
    jql: (jql: string) => ['search', jql] as const,
    quick: (q: string) => ['quick-search', q] as const,
  },

  clients: { all: ['clients'] as const },
  notificationPrefs: ['notification-preferences'] as const,
  severities: ['severities'] as const,
  priorities: ['priorities'] as const,
  customFields: ['custom-fields'] as const,
  workflows: ['workflows'] as const,
  /** Quy trình (kèm trạng thái) của MỘT dự án — cùng tiền tố `workflows`. */
  projectWorkflow: (projectId: string) => ['workflows', 'project', projectId] as const,
  teams: { all: ['teams'] as const },
  apiKeys: { all: ['api-keys'] as const },

  filters: {
    all: ['filters'] as const,
    fields: ['filter-fields'] as const,
  },

  goals: {
    all: ['goals'] as const,
    list: (filter: GoalFilter) => ['goals', filter] as const,
    periods: ['goal-periods'] as const,
    issueSearch: (q: string, projectId: string) => ['goal-issue-search', q, projectId] as const,
  },

  raid: {
    all: ['raid'] as const,
    list: (filter: RaidFilter) => ['raid', filter] as const,
  },

  workspaces: { mine: ['my-workspaces'] as const },

  resources: {
    workloadRoot: ['workload'] as const,
    allocationsRoot: ['allocations'] as const,
    timeOffRoot: ['time-off'] as const,
    workload: (p: Record<string, string | undefined>) => ['workload', p] as const,
    allocations: (p: Record<string, string | undefined>) => ['allocations', p] as const,
    timeOff: (p: Record<string, string | undefined>) => ['time-off', p] as const,
  },

  users: {
    workspace: ['workspace-users'] as const,
    allRoot: ['all-users'] as const,
    all: (search?: string) => ['all-users', search ?? ''] as const,
  },

  members: {
    workspace: ['workspace-members'] as const,
    projectRoot: ['project-members'] as const,
    project: (projectId: string) => ['project-members', projectId] as const,
  },

  roles: {
    all: ['roles'] as const,
    byScope: (scope?: RoleScope) => ['roles', scope ?? 'ALL'] as const,
  },

  admin: {
    users: ['admin-users'] as const,
    overview: ['admin-overview'] as const,
    workspaces: ['admin-workspaces'] as const,
    config: ['admin-config'] as const,
    health: ['admin-health'] as const,
    audit: (limit: number, action: string) => ['admin-audit', limit, action] as const,
  },

  wiki: {
    treeRoot: ['wiki', 'tree'] as const,
    searchRoot: ['wiki', 'search'] as const,
    tree: (scope: string) => ['wiki', 'tree', scope] as const,
    search: (scope: string, q: string) => ['wiki', 'search', scope, q] as const,
    page: (id: string) => ['wiki', 'page', id] as const,
  },

  planning: {
    dependencies: (projectId: string) => ['planning', 'dependencies', projectId] as const,
    milestones: (projectId: string) => ['planning', 'milestones', projectId] as const,
    baselines: (projectId: string) => ['planning', 'baselines', projectId] as const,
    baseline: (projectId: string, baselineId: string) =>
      ['planning', 'baseline', projectId, baselineId] as const,
    schedule: (projectId: string) => ['planning', 'schedule', projectId] as const,
  },

  triage: {
    all: ['triage'] as const,
    inbox: (projectId: string) => ['triage', 'inbox', projectId] as const,
    count: (projectId: string) => ['triage', 'count', projectId] as const,
    duplicates: (projectId: string, q: string) => ['triage', 'duplicates', projectId, q] as const,
  },

  dashboard: {
    myIssues: ['my-issues'] as const,
    workspaceOverview: ['workspace-overview'] as const,
  },

  integrations: {
    byType: (type: IntegrationType) => ['integrations', type] as const,
    channels: (integrationId: string) => ['integration-channels', integrationId] as const,
    repositories: ['repositories'] as const,
  },

  /**
   * Nhãn/component/phiên bản của project có HAI cache (trang Cài đặt project và dropdown khi tạo/sửa issue).
   * Cả hai chung tiền tố ['project-lookups', pid] → `projectMeta.all(pid)` làm mới cả hai sau khi sửa.
   */
  projectConfig: {
    components: (projectId: string) => ['project-lookups', projectId, 'config', 'components'] as const,
    versions: (projectId: string) => ['project-lookups', projectId, 'config', 'versions'] as const,
    labels: (projectId: string) => ['project-lookups', projectId, 'config', 'labels'] as const,
    importJobs: ['import-jobs'] as const,
  },

  /** Metadata dùng khi tạo/sửa issue (dropdown nhãn, component, phiên bản). */
  projectMeta: {
    all: (projectId: string) => ['project-lookups', projectId] as const,
    labels: (projectId: string) => ['project-lookups', projectId, 'labels'] as const,
    components: (projectId: string) => ['project-lookups', projectId, 'components'] as const,
    versions: (projectId: string) => ['project-lookups', projectId, 'versions'] as const,
  },

  guides: { screen: (screen: string) => ['guides', screen] as const },

  ai: {
    projectMeta: (key: string) => ['project-meta', key] as const,
    capabilities: ['ai', 'capabilities'] as const,
  },

  programs: {
    all: ['programs'] as const,
    rollup: ['programs', 'rollup'] as const,
  },

  digests: {
    all: ['digests'] as const,
    byProject: (projectId?: string) =>
      projectId ? (['digests', projectId] as const) : (['digests'] as const),
  },

  sla: {
    policies: ['sla-policies'] as const,
    board: ['sla-board'] as const,
  },

  automation: {
    templates: ['automation', 'templates'] as const,
    recurring: ['automation', 'recurring'] as const,
    rulesRoot: ['automation', 'rules'] as const,
    rules: (scope: string) => ['automation', 'rules', scope] as const,
    ruleRuns: (ruleId: string) => ['automation', 'rule-runs', ruleId] as const,
  },

  reports: {
    project: (projectId: string) => ['report', 'project', projectId] as const,
    sprints: (projectId: string) => ['report', 'sprints', projectId] as const,
    burndown: (sprintId: string) => ['report', 'burndown', sprintId] as const,
    velocity: (projectId: string) => ['report', 'velocity', projectId] as const,
    cfd: (projectId: string) => ['report', 'cfd', projectId] as const,
    createdResolved: (projectId: string) => ['report', 'created-resolved', projectId] as const,
  },
} as const;
