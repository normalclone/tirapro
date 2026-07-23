/**
 * Catalog quyền (RBAC) — format "resource:action". Dùng chung guard (BE) và
 * điều kiện hiển thị UI (FE). Là single source of truth cho seed Permission.
 */
import type { PermissionScope } from './enums';

export const PERMISSIONS = {
  // Workspace
  WORKSPACE_ADMIN: 'workspace:admin',
  WORKSPACE_VIEW: 'workspace:view',
  MEMBER_MANAGE: 'member:manage',
  TEAM_MANAGE: 'team:manage',
  // Project
  PROJECT_CREATE: 'project:create',
  PROJECT_ADMIN: 'project:admin',
  PROJECT_VIEW: 'project:view',
  // Issue
  ISSUE_CREATE: 'issue:create',
  ISSUE_EDIT: 'issue:edit',
  ISSUE_EDIT_OWN: 'issue:edit:own',
  ISSUE_DELETE: 'issue:delete',
  ISSUE_TRANSITION: 'issue:transition',
  ISSUE_ASSIGN: 'issue:assign',
  ISSUE_LINK: 'issue:link',
  ISSUE_TRIAGE: 'issue:triage',
  // Comment
  COMMENT_CREATE: 'comment:create',
  COMMENT_EDIT_OWN: 'comment:edit:own',
  COMMENT_DELETE: 'comment:delete',
  // Agile
  SPRINT_MANAGE: 'sprint:manage',
  BOARD_MANAGE: 'board:manage',
  BACKLOG_MANAGE: 'backlog:manage',
  WORKFLOW_EDIT: 'workflow:edit',
  CUSTOM_FIELD_MANAGE: 'customfield:manage',
  // Reports / dashboards / filters
  REPORT_VIEW: 'report:view',
  DASHBOARD_MANAGE: 'dashboard:manage',
  FILTER_MANAGE: 'filter:manage',
  // AI
  AI_USE: 'ai:use',
  // Integrations
  INTEGRATION_MANAGE: 'integration:manage',
  IMPORT_RUN: 'import:run',
  DIGEST_MANAGE: 'digest:manage',
  // Guides / onboarding
  GUIDE_MANAGE: 'guide:manage',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface PermissionDef {
  key: PermissionKey;
  description: string;
  scope: PermissionScope;
}

export const PERMISSION_CATALOG: PermissionDef[] = [
  { key: PERMISSIONS.WORKSPACE_ADMIN, description: 'Quản trị workspace', scope: 'WORKSPACE' },
  { key: PERMISSIONS.WORKSPACE_VIEW, description: 'Xem workspace', scope: 'WORKSPACE' },
  { key: PERMISSIONS.MEMBER_MANAGE, description: 'Quản lý thành viên & vai trò', scope: 'WORKSPACE' },
  { key: PERMISSIONS.TEAM_MANAGE, description: 'Quản lý nhóm (team)', scope: 'WORKSPACE' },
  { key: PERMISSIONS.PROJECT_CREATE, description: 'Tạo project', scope: 'WORKSPACE' },
  { key: PERMISSIONS.PROJECT_ADMIN, description: 'Quản trị project', scope: 'PROJECT' },
  { key: PERMISSIONS.PROJECT_VIEW, description: 'Xem project', scope: 'PROJECT' },
  { key: PERMISSIONS.ISSUE_CREATE, description: 'Tạo issue', scope: 'PROJECT' },
  { key: PERMISSIONS.ISSUE_EDIT, description: 'Sửa mọi issue', scope: 'PROJECT' },
  { key: PERMISSIONS.ISSUE_EDIT_OWN, description: 'Sửa issue mình tạo/được giao', scope: 'PROJECT' },
  { key: PERMISSIONS.ISSUE_DELETE, description: 'Xóa issue', scope: 'PROJECT' },
  { key: PERMISSIONS.ISSUE_TRANSITION, description: 'Chuyển trạng thái issue', scope: 'PROJECT' },
  { key: PERMISSIONS.ISSUE_ASSIGN, description: 'Gán người thực hiện', scope: 'PROJECT' },
  { key: PERMISSIONS.ISSUE_LINK, description: 'Liên kết issue', scope: 'PROJECT' },
  { key: PERMISSIONS.ISSUE_TRIAGE, description: 'Triage issue (accept/duplicate/decline/snooze)', scope: 'PROJECT' },
  { key: PERMISSIONS.COMMENT_CREATE, description: 'Bình luận', scope: 'PROJECT' },
  { key: PERMISSIONS.COMMENT_EDIT_OWN, description: 'Sửa bình luận của mình', scope: 'PROJECT' },
  { key: PERMISSIONS.COMMENT_DELETE, description: 'Xóa bình luận', scope: 'PROJECT' },
  { key: PERMISSIONS.SPRINT_MANAGE, description: 'Quản lý sprint', scope: 'PROJECT' },
  { key: PERMISSIONS.BOARD_MANAGE, description: 'Quản lý board', scope: 'PROJECT' },
  { key: PERMISSIONS.BACKLOG_MANAGE, description: 'Quản lý backlog', scope: 'PROJECT' },
  { key: PERMISSIONS.WORKFLOW_EDIT, description: 'Chỉnh sửa workflow', scope: 'PROJECT' },
  { key: PERMISSIONS.CUSTOM_FIELD_MANAGE, description: 'Quản lý custom field', scope: 'PROJECT' },
  { key: PERMISSIONS.REPORT_VIEW, description: 'Xem báo cáo', scope: 'PROJECT' },
  { key: PERMISSIONS.DASHBOARD_MANAGE, description: 'Quản lý dashboard', scope: 'WORKSPACE' },
  { key: PERMISSIONS.FILTER_MANAGE, description: 'Quản lý saved filter', scope: 'WORKSPACE' },
  { key: PERMISSIONS.AI_USE, description: 'Dùng tính năng AI', scope: 'WORKSPACE' },
  { key: PERMISSIONS.INTEGRATION_MANAGE, description: 'Quản lý tích hợp (Telegram, Jira...)', scope: 'WORKSPACE' },
  { key: PERMISSIONS.IMPORT_RUN, description: 'Chạy migration/import', scope: 'WORKSPACE' },
  { key: PERMISSIONS.DIGEST_MANAGE, description: 'Quản lý báo cáo định kỳ (digest)', scope: 'PROJECT' },
  { key: PERMISSIONS.GUIDE_MANAGE, description: 'Tùy biến hướng dẫn/tour cho workspace', scope: 'WORKSPACE' },
];

/** Tên các system role seed sẵn. */
export const SYSTEM_ROLES = {
  WORKSPACE_ADMIN: 'Workspace Admin',
  WORKSPACE_MEMBER: 'Workspace Member',
  WORKSPACE_VIEWER: 'Workspace Viewer',
  PROJECT_ADMIN: 'Project Admin',
  PROJECT_DEVELOPER: 'Project Developer',
  PROJECT_REPORTER: 'Project Reporter',
  // Danh mục vai trò DỰ ÁN theo chức năng (mỗi vai trò có bộ quyền riêng).
  BUSINESS_ANALYST: 'Business Analyst',
  PRODUCT_OWNER: 'Product Owner',
  SCRUM_MASTER: 'Scrum Master',
  DEVELOPER: 'Developer',
  TESTER: 'Tester',
  DESIGNER: 'Designer',
  DEVOPS: 'DevOps',
  REVIEWER: 'Reviewer',
  STAKEHOLDER: 'Stakeholder',
} as const;

export type SystemRoleName = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

/**
 * Bộ quyền mặc định cho từng vai trò hệ thống (single source of truth — seed & bootstrap
 * workspace mới đều đọc từ đây). Key = permission string. Vai trò DỰ ÁN dùng quyền scope PROJECT.
 */
export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRoleName, PermissionKey[]> = {
  [SYSTEM_ROLES.WORKSPACE_ADMIN]: PERMISSION_CATALOG.map((p) => p.key),
  [SYSTEM_ROLES.WORKSPACE_MEMBER]: [
    PERMISSIONS.WORKSPACE_VIEW, PERMISSIONS.PROJECT_CREATE, PERMISSIONS.PROJECT_VIEW,
    PERMISSIONS.AI_USE, PERMISSIONS.DASHBOARD_MANAGE, PERMISSIONS.FILTER_MANAGE,
  ],
  [SYSTEM_ROLES.WORKSPACE_VIEWER]: [
    PERMISSIONS.WORKSPACE_VIEW, PERMISSIONS.PROJECT_VIEW, PERMISSIONS.REPORT_VIEW,
  ],
  [SYSTEM_ROLES.PROJECT_ADMIN]: [
    PERMISSIONS.PROJECT_VIEW, PERMISSIONS.PROJECT_ADMIN, PERMISSIONS.ISSUE_CREATE, PERMISSIONS.ISSUE_EDIT,
    PERMISSIONS.ISSUE_DELETE, PERMISSIONS.ISSUE_TRANSITION, PERMISSIONS.ISSUE_ASSIGN, PERMISSIONS.ISSUE_LINK,
    PERMISSIONS.ISSUE_TRIAGE, PERMISSIONS.COMMENT_CREATE, PERMISSIONS.COMMENT_EDIT_OWN, PERMISSIONS.COMMENT_DELETE,
    PERMISSIONS.SPRINT_MANAGE, PERMISSIONS.BOARD_MANAGE, PERMISSIONS.BACKLOG_MANAGE, PERMISSIONS.WORKFLOW_EDIT,
    PERMISSIONS.CUSTOM_FIELD_MANAGE, PERMISSIONS.REPORT_VIEW, PERMISSIONS.DIGEST_MANAGE,
  ],
  [SYSTEM_ROLES.PROJECT_DEVELOPER]: [
    PERMISSIONS.PROJECT_VIEW, PERMISSIONS.ISSUE_CREATE, PERMISSIONS.ISSUE_EDIT, PERMISSIONS.ISSUE_TRANSITION,
    PERMISSIONS.ISSUE_ASSIGN, PERMISSIONS.ISSUE_LINK, PERMISSIONS.ISSUE_TRIAGE, PERMISSIONS.COMMENT_CREATE,
    PERMISSIONS.COMMENT_EDIT_OWN, PERMISSIONS.BACKLOG_MANAGE, PERMISSIONS.REPORT_VIEW,
  ],
  [SYSTEM_ROLES.PROJECT_REPORTER]: [
    PERMISSIONS.PROJECT_VIEW, PERMISSIONS.ISSUE_CREATE, PERMISSIONS.ISSUE_EDIT_OWN,
    PERMISSIONS.COMMENT_CREATE, PERMISSIONS.COMMENT_EDIT_OWN, PERMISSIONS.REPORT_VIEW,
  ],
  // BA: định nghĩa yêu cầu, quản backlog & sprint, custom field, triage, báo cáo.
  [SYSTEM_ROLES.BUSINESS_ANALYST]: [
    PERMISSIONS.PROJECT_VIEW, PERMISSIONS.ISSUE_CREATE, PERMISSIONS.ISSUE_EDIT, PERMISSIONS.ISSUE_TRANSITION,
    PERMISSIONS.ISSUE_ASSIGN, PERMISSIONS.ISSUE_LINK, PERMISSIONS.ISSUE_TRIAGE, PERMISSIONS.COMMENT_CREATE,
    PERMISSIONS.COMMENT_EDIT_OWN, PERMISSIONS.BACKLOG_MANAGE, PERMISSIONS.SPRINT_MANAGE,
    PERMISSIONS.CUSTOM_FIELD_MANAGE, PERMISSIONS.REPORT_VIEW, PERMISSIONS.DIGEST_MANAGE,
  ],
  // Product Owner: làm chủ backlog/ưu tiên, lập sprint, báo cáo.
  [SYSTEM_ROLES.PRODUCT_OWNER]: [
    PERMISSIONS.PROJECT_VIEW, PERMISSIONS.ISSUE_CREATE, PERMISSIONS.ISSUE_EDIT, PERMISSIONS.ISSUE_ASSIGN,
    PERMISSIONS.ISSUE_LINK, PERMISSIONS.ISSUE_TRIAGE, PERMISSIONS.COMMENT_CREATE, PERMISSIONS.COMMENT_EDIT_OWN,
    PERMISSIONS.BACKLOG_MANAGE, PERMISSIONS.SPRINT_MANAGE, PERMISSIONS.REPORT_VIEW, PERMISSIONS.DIGEST_MANAGE,
  ],
  // Scrum Master: quy trình, board, sprint, backlog, báo cáo.
  [SYSTEM_ROLES.SCRUM_MASTER]: [
    PERMISSIONS.PROJECT_VIEW, PERMISSIONS.ISSUE_EDIT, PERMISSIONS.ISSUE_TRANSITION, PERMISSIONS.ISSUE_ASSIGN,
    PERMISSIONS.ISSUE_LINK, PERMISSIONS.COMMENT_CREATE, PERMISSIONS.COMMENT_EDIT_OWN, PERMISSIONS.SPRINT_MANAGE,
    PERMISSIONS.BOARD_MANAGE, PERMISSIONS.BACKLOG_MANAGE, PERMISSIONS.WORKFLOW_EDIT, PERMISSIONS.REPORT_VIEW,
  ],
  // Developer: làm & chuyển trạng thái issue, liên kết, comment, backlog, báo cáo.
  [SYSTEM_ROLES.DEVELOPER]: [
    PERMISSIONS.PROJECT_VIEW, PERMISSIONS.ISSUE_CREATE, PERMISSIONS.ISSUE_EDIT, PERMISSIONS.ISSUE_TRANSITION,
    PERMISSIONS.ISSUE_ASSIGN, PERMISSIONS.ISSUE_LINK, PERMISSIONS.COMMENT_CREATE, PERMISSIONS.COMMENT_EDIT_OWN,
    PERMISSIONS.BACKLOG_MANAGE, PERMISSIONS.REPORT_VIEW,
  ],
  // Tester/QA: tạo bug, triage, chuyển trạng thái (retest/done), liên kết, comment, báo cáo.
  [SYSTEM_ROLES.TESTER]: [
    PERMISSIONS.PROJECT_VIEW, PERMISSIONS.ISSUE_CREATE, PERMISSIONS.ISSUE_EDIT, PERMISSIONS.ISSUE_TRANSITION,
    PERMISSIONS.ISSUE_LINK, PERMISSIONS.ISSUE_TRIAGE, PERMISSIONS.COMMENT_CREATE, PERMISSIONS.COMMENT_EDIT_OWN,
    PERMISSIONS.REPORT_VIEW,
  ],
  // Designer (UI/UX): đóng góp issue, liên kết, comment, xem.
  [SYSTEM_ROLES.DESIGNER]: [
    PERMISSIONS.PROJECT_VIEW, PERMISSIONS.ISSUE_CREATE, PERMISSIONS.ISSUE_EDIT, PERMISSIONS.ISSUE_LINK,
    PERMISSIONS.COMMENT_CREATE, PERMISSIONS.COMMENT_EDIT_OWN, PERMISSIONS.REPORT_VIEW,
  ],
  // DevOps: như Developer (CI/CD, hạ tầng) — quản tích hợp ở cấp workspace.
  [SYSTEM_ROLES.DEVOPS]: [
    PERMISSIONS.PROJECT_VIEW, PERMISSIONS.ISSUE_CREATE, PERMISSIONS.ISSUE_EDIT, PERMISSIONS.ISSUE_TRANSITION,
    PERMISSIONS.ISSUE_ASSIGN, PERMISSIONS.ISSUE_LINK, PERMISSIONS.COMMENT_CREATE, PERMISSIONS.COMMENT_EDIT_OWN,
    PERMISSIONS.REPORT_VIEW,
  ],
  // Reviewer: review, chuyển trạng thái, liên kết, comment, xem.
  [SYSTEM_ROLES.REVIEWER]: [
    PERMISSIONS.PROJECT_VIEW, PERMISSIONS.ISSUE_EDIT, PERMISSIONS.ISSUE_TRANSITION, PERMISSIONS.ISSUE_LINK,
    PERMISSIONS.COMMENT_CREATE, PERMISSIONS.COMMENT_EDIT_OWN, PERMISSIONS.REPORT_VIEW,
  ],
  // Stakeholder: chỉ xem + bình luận + báo cáo.
  [SYSTEM_ROLES.STAKEHOLDER]: [
    PERMISSIONS.PROJECT_VIEW, PERMISSIONS.COMMENT_CREATE, PERMISSIONS.COMMENT_EDIT_OWN, PERMISSIONS.REPORT_VIEW,
  ],
};

/** Scope của từng system role (để seed & UI nhóm theo cấp). */
export const SYSTEM_ROLE_SCOPE: Record<SystemRoleName, 'WORKSPACE' | 'PROJECT'> = {
  [SYSTEM_ROLES.WORKSPACE_ADMIN]: 'WORKSPACE',
  [SYSTEM_ROLES.WORKSPACE_MEMBER]: 'WORKSPACE',
  [SYSTEM_ROLES.WORKSPACE_VIEWER]: 'WORKSPACE',
  [SYSTEM_ROLES.PROJECT_ADMIN]: 'PROJECT',
  [SYSTEM_ROLES.PROJECT_DEVELOPER]: 'PROJECT',
  [SYSTEM_ROLES.PROJECT_REPORTER]: 'PROJECT',
  [SYSTEM_ROLES.BUSINESS_ANALYST]: 'PROJECT',
  [SYSTEM_ROLES.PRODUCT_OWNER]: 'PROJECT',
  [SYSTEM_ROLES.SCRUM_MASTER]: 'PROJECT',
  [SYSTEM_ROLES.DEVELOPER]: 'PROJECT',
  [SYSTEM_ROLES.TESTER]: 'PROJECT',
  [SYSTEM_ROLES.DESIGNER]: 'PROJECT',
  [SYSTEM_ROLES.DEVOPS]: 'PROJECT',
  [SYSTEM_ROLES.REVIEWER]: 'PROJECT',
  [SYSTEM_ROLES.STAKEHOLDER]: 'PROJECT',
};

/** Mô tả ngắn + màu nhãn cho vai trò hệ thống (UI badge/catalog). */
export const SYSTEM_ROLE_META: Record<SystemRoleName, { description: string; color: string }> = {
  [SYSTEM_ROLES.WORKSPACE_ADMIN]: { description: 'Toàn quyền quản trị workspace', color: 'oklch(0.55 0.20 25)' },
  [SYSTEM_ROLES.WORKSPACE_MEMBER]: { description: 'Thành viên: tạo & tham gia dự án', color: 'oklch(0.55 0.13 245)' },
  [SYSTEM_ROLES.WORKSPACE_VIEWER]: { description: 'Chỉ xem ở cấp workspace', color: 'oklch(0.60 0.018 256)' },
  [SYSTEM_ROLES.PROJECT_ADMIN]: { description: 'Quản trị dự án (lead)', color: 'oklch(0.55 0.20 25)' },
  [SYSTEM_ROLES.PROJECT_DEVELOPER]: { description: 'Lập trình viên (chung)', color: 'oklch(0.55 0.13 245)' },
  [SYSTEM_ROLES.PROJECT_REPORTER]: { description: 'Báo cáo & tạo issue của mình', color: 'oklch(0.60 0.018 256)' },
  [SYSTEM_ROLES.BUSINESS_ANALYST]: { description: 'Phân tích nghiệp vụ, backlog, yêu cầu', color: 'oklch(0.55 0.16 300)' },
  [SYSTEM_ROLES.PRODUCT_OWNER]: { description: 'Chủ sản phẩm: ưu tiên & backlog', color: 'oklch(0.58 0.16 330)' },
  [SYSTEM_ROLES.SCRUM_MASTER]: { description: 'Điều phối quy trình & sprint', color: 'oklch(0.60 0.13 200)' },
  [SYSTEM_ROLES.DEVELOPER]: { description: 'Lập trình viên: làm & chuyển issue', color: 'oklch(0.55 0.13 245)' },
  [SYSTEM_ROLES.TESTER]: { description: 'Kiểm thử/QA: bug, triage, retest', color: 'oklch(0.58 0.13 150)' },
  [SYSTEM_ROLES.DESIGNER]: { description: 'Thiết kế UI/UX', color: 'oklch(0.62 0.13 285)' },
  [SYSTEM_ROLES.DEVOPS]: { description: 'CI/CD, hạ tầng, vận hành', color: 'oklch(0.55 0.10 220)' },
  [SYSTEM_ROLES.REVIEWER]: { description: 'Review & duyệt issue', color: 'oklch(0.60 0.12 160)' },
  [SYSTEM_ROLES.STAKEHOLDER]: { description: 'Bên liên quan: xem & góp ý', color: 'oklch(0.65 0.05 256)' },
};
