/**
 * Hình dạng entity ở tầng API (đã serialize: Date -> ISO string).
 * FE dùng trực tiếp các interface này cho TanStack Query cache.
 */
import type {
  BoardType,
  CustomFieldType,
  DashboardScope,
  DefaultAssigneeMode,
  FilterVisibility,
  FixVersionType,
  IssueTypeKey,
  MailStatus,
  NotificationType,
  ProjectType,
  RichTextFormat,
  RoleScope,
  RuleRunStatus,
  RuleTrigger,
  SprintState,
  StatusCategory,
  TriageState,
  UserStatus,
  WidgetType,
  WorkspacePlan,
} from './enums';
import type { PermissionKey } from './permissions';

export type ID = string;
export type ISODate = string;

export interface UserDto {
  id: ID;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  timezone: string;
  locale: string;
  status: UserStatus;
  isSystemAdmin: boolean;
  /** Có quyền lập không gian làm việc mới (admin hệ thống cấp). Chỉ có trong `/auth/me`, `/auth/login`… của chính mình. */
  canCreateWorkspace?: boolean;
  lastSeenAt: ISODate | null;
  createdAt: ISODate;
}

/**
 * Người dùng NHÚNG trong dữ liệu khác (người phụ trách/báo lỗi của công việc, tác giả bình luận): chỉ định danh + hiển thị,
 * KHÔNG mang `isSystemAdmin` / `lastSeenAt` (không lộ ai là quản trị hệ thống hay lần hoạt động gần nhất cho mọi người xem việc).
 */
export type UserRefDto = Omit<UserDto, 'isSystemAdmin' | 'lastSeenAt' | 'canCreateWorkspace'>;

/**
 * Người dùng trong danh sách thành viên / `GET /users`: `isSystemAdmin` và `lastSeenAt` chỉ có khi người xem có
 * `member:manage` (quản trị thành viên); người khác nhận bản rút gọn như `UserRefDto`.
 */
export type MemberUserDto = UserRefDto & { isSystemAdmin?: boolean; lastSeenAt?: ISODate | null };

/** Người dùng trong pool chung (picker "thêm thành viên") — chỉ những trường picker cần. */
export type PoolUserDto = Pick<UserDto, 'id' | 'email' | 'displayName' | 'avatarUrl' | 'status'>;

export interface WorkspaceDto {
  id: ID;
  name: string;
  slug: string;
  ownerId: ID;
  plan: WorkspacePlan;
  settings: Record<string, unknown>;
  createdAt: ISODate;
}

/** Tham chiếu vai trò gọn (cho badge/nhãn). */
export interface RoleRefDto {
  id: ID;
  name: string;
  color?: string | null;
}

export interface MembershipDto {
  id: ID;
  workspaceId: ID;
  userId: ID;
  roleId: ID; // vai trò CHÍNH (mặc định hiển thị)
  roleName: string;
  roles: RoleRefDto[]; // TẤT CẢ vai trò (có thể nhiều)
  scope: RoleScope;
  projectId?: ID | null;
}

/** Role đầy đủ cho catalog/CRUD. */
export interface RoleDto {
  id: ID;
  workspaceId: ID | null; // null = role hệ thống (dùng chung), khác null = custom của workspace
  name: string;
  scope: RoleScope;
  isSystem: boolean;
  description?: string | null;
  color?: string | null;
  permissionKeys: PermissionKey[];
  memberCount?: number; // số membership đang gắn role này (để cảnh báo khi xoá)
  /** Phiên bản của vai trò (ISO) — gửi lại ở PATCH làm `expectedUpdatedAt` để không ghi đè sửa của người khác. */
  updatedAt?: ISODate;
}

/** Một thành viên kèm danh sách vai trò (workspace hoặc project). */
export interface MemberDto {
  membershipId: ID;
  user: MemberUserDto;
  roles: RoleRefDto[];
  joinedAt?: ISODate | null;
  /**
   * Chỉ dùng ở danh sách thành viên DỰ ÁN: `true` = vai trò được ĐẶT RIÊNG cho dự án
   * này (ghi đè), `false` = đang dùng vai trò MẶC ĐỊNH suy từ vai trò workspace.
   */
  isOverride?: boolean;
}

/** Nhóm (team) đầy đủ — nhóm thành viên trong workspace. */
export interface TeamDto {
  id: ID;
  workspaceId: ID;
  name: string;
  key: string;
  description?: string | null;
  color?: string | null;
  lead?: UserDto | null;
  members: UserDto[];
  memberCount: number;
  createdAt: ISODate;
}

export interface AuthMeDto {
  user: UserDto;
  workspaceId: ID | null;
  memberships: MembershipDto[];
  permissions: PermissionKey[]; // effective trong workspace hiện tại
}

/** Quyền hiệu lực của người đang đăng nhập ở MỘT dự án (= vai trò workspace ∪ vai trò dự án). */
export interface ProjectPermissionsDto {
  projectId: ID;
  permissions: PermissionKey[];
}

export interface AuthTokensDto {
  accessToken: string;
  expiresIn: number;
}

/** Tuỳ chọn nhận thông báo qua email (lưu ở `User.settings.notifications.email`). */
export interface NotificationEmailPrefs {
  mention: boolean;
  assigned: boolean;
  comment: boolean;
  transition: boolean;
}

/** Một dòng trong hộp thư đi (admin xem thư lỗi). Không kèm nội dung thư vì có thể chứa liên kết còn hiệu lực. */
export interface MailOutboxItemDto {
  id: ID;
  to: string;
  subject: string;
  template: string;
  status: MailStatus;
  attempts: number;
  lastError: string | null;
  scheduledAt: ISODate;
  sentAt: ISODate | null;
  createdAt: ISODate;
}

export interface ProjectDto {
  id: ID;
  workspaceId: ID;
  key: string;
  name: string;
  description: string | null;
  type: ProjectType;
  leadId: ID | null;
  lead?: UserDto | null;
  avatarUrl: string | null;
  defaultAssigneeMode: DefaultAssigneeMode;
  isArchived: boolean;
  /** Thời điểm lưu trữ; null = đang hoạt động. Dự án đã lưu trữ chỉ đọc. */
  archivedAt: ISODate | null;
  /** Dự án riêng tư: chỉ thành viên dự án + quản trị workspace thấy (người khác nhận 404). */
  isPrivate: boolean;
  issueCount?: number;
  createdAt: ISODate;
}

export interface IssueTypeDto {
  id: ID;
  name: string;
  key: IssueTypeKey | null;
  iconUrl: string | null;
  color: string | null;
  hierarchyLevel: number;
  isSubtask: boolean;
}

export interface StatusDto {
  id: ID;
  workflowId: ID;
  name: string;
  category: StatusCategory;
  color: string | null;
  order: number;
  isInitial: boolean;
}

export interface PriorityDto {
  id: ID;
  name: string;
  iconKey: string | null;
  color: string | null;
  rank: number;
  isDefault: boolean;
}

export interface SeverityDto {
  id: ID;
  name: string;
  description: string | null;
  color: string | null;
  rank: number;
  isDefault: boolean;
}

export interface ResolutionDto {
  id: ID;
  name: string;
  description: string | null;
  rank: number;
}

export interface LinkTypeDto {
  id: ID;
  name: string;
  outwardName: string;
  inwardName: string;
}

export interface LabelDto {
  id: ID;
  projectId: ID;
  name: string;
  color: string | null;
}

export interface IssueLinkDto {
  id: ID;
  linkType: LinkTypeDto;
  direction: 'inward' | 'outward';
  sourceIssueId: ID;
  targetIssueId: ID;
  target?: IssueSummaryDto;
}

export interface IssueSummaryDto {
  id: ID;
  key: string;
  summary: string;
  type: IssueTypeDto;
  status: StatusDto;
  priority: PriorityDto | null;
  assignee?: UserRefDto | null;
}

/** Môi trường phát sinh lỗi (Bug): do người báo điền hoặc "Điền từ phiên hiện tại". */
export interface IssueEnvironment {
  env?: 'production' | 'staging' | 'dev' | 'other';
  browser?: string;
  os?: string;
  build?: string;
  url?: string;
  viewport?: string;
}

/** Loại yêu cầu người gửi chọn ở form Báo lỗi / Gửi yêu cầu (lưu ở `triageSource`). */
export type TriageKind = 'BUG' | 'FEATURE' | 'QUESTION';

/** Thẻ Việc mới vào (Triage): đủ thông tin để duyệt mà không mở trang công việc. Dùng chung API và web. */
export interface TriageItemDto {
  id: ID;
  key: string;
  summary: string;
  projectId: ID;
  description: string | null;
  reporter: UserRefDto | null;
  /** Loại yêu cầu người gửi chọn; null với việc không đi qua form báo lỗi. */
  kind: TriageKind | null;
  environment: IssueEnvironment | null;
  type: IssueTypeDto;
  status: StatusDto;
  priority: PriorityDto | null;
  severity: SeverityDto | null;
  assignee: UserRefDto | null;
  sprintId: ID | null;
  occurrenceCount: number;
  lastOccurredAt: ISODate | null;
  triageState: TriageState | null;
  triageSnoozeUntil: ISODate | null;
  createdAt: ISODate;
  version: number;
}

/** Kết quả POST /issues/:id/transition: issue + cờ cho biết lý do (comment) có được lưu thành bình luận không. */
export interface IssueTransitionResultDto extends IssueDto {
  /** Chỉ có khi request gửi `comment`; `false` = chuyển trạng thái xong nhưng KHÔNG ghi được bình luận lý do. */
  reasonSaved?: boolean;
}

/** Thành phần đang gắn vào công việc (rút gọn). */
export interface IssueComponentRefDto {
  id: ID;
  name: string;
}

/** Phiên bản đang gắn vào công việc: FIX = sửa ở phiên bản, AFFECTS = bị ảnh hưởng ở phiên bản. */
export interface IssueVersionRefDto {
  id: ID;
  name: string;
  type: FixVersionType;
}

export interface IssueDto extends IssueSummaryDto {
  workspaceId: ID;
  projectId: ID;
  number: number;
  description: string | null;
  descriptionFormat: RichTextFormat;
  /** Tiêu chí chấp nhận (Markdown, ô tick `- [ ]`). Chỉ có ở chi tiết công việc và kết quả mutation; danh sách chỉ trả `acceptanceProgress`. */
  acceptanceCriteria?: string | null;
  /** Số tiêu chí đã đạt, tính từ `acceptanceCriteria`; null khi không có mục tick. */
  acceptanceProgress: { done: number; total: number } | null;
  reporter?: UserRefDto | null;
  reporterId: ID | null;
  /** Người tạo (có thể khác `reporterId`); cùng với reporter/assignee quyết định "việc của mình" cho `issue:edit:own`. */
  createdById: ID | null;
  assigneeId: ID | null;
  parentId: ID | null;
  epicId: ID | null;
  sprintId: ID | null;
  storyPoints: number | null;
  originalEstimate: number | null;
  remainingEstimate: number | null;
  timeSpent: number | null;
  dueDate: ISODate | null;
  startDate: ISODate | null;
  resolution: ResolutionDto | null;
  resolvedAt: ISODate | null;
  severity: SeverityDto | null;
  triageState: TriageState | null;
  triageSnoozeUntil: ISODate | null;
  occurrenceCount: number;
  environment: IssueEnvironment | null;
  rank: string;
  version: number;
  labels: LabelDto[];
  /** Thành phần đã gắn (sắp theo tên). */
  components: IssueComponentRefDto[];
  /** Phiên bản đã gắn, cả FIX lẫn AFFECTS (sắp theo tên rồi loại). */
  fixVersions: IssueVersionRefDto[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** Kết quả sửa hàng loạt: issue đã sửa (kèm version mới để hoàn tác) và các item bị người khác sửa trước (kèm version hiện tại). */
export interface BulkUpdateIssuesResult {
  updated: IssueDto[];
  conflicts: Array<{ id: ID; version: number }>;
}

export interface CommentDto {
  id: ID;
  issueId: ID;
  authorId: ID | null;
  author?: UserRefDto | null;
  body: string;
  bodyFormat: RichTextFormat;
  parentId: ID | null;
  isEdited: boolean;
  version: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface SprintDto {
  id: ID;
  projectId: ID;
  boardId: ID | null;
  name: string;
  goal: string | null;
  state: SprintState;
  startDate: ISODate | null;
  endDate: ISODate | null;
  completeDate: ISODate | null;
  sequence: number;
  issueCount?: number;
  totalPoints?: number;
}

export interface BoardColumnDto {
  id: ID;
  boardId: ID;
  name: string;
  order: number;
  wipLimit: number | null;
  statusIds: ID[];
}

/** Cách nhóm thẻ thành swimlane trên board. */
export const SWIMLANE_BY = ['none', 'assignee', 'epic', 'priority', 'parent'] as const;
export type SwimlaneBy = (typeof SWIMLANE_BY)[number];

export interface BoardDto {
  id: ID;
  projectId: ID;
  name: string;
  type: BoardType;
  filterJql: string | null;
  swimlaneBy: SwimlaneBy;
  columns: BoardColumnDto[];
}

export interface CustomFieldDto {
  id: ID;
  name: string;
  type: CustomFieldType;
  isRequired: boolean;
  order: number;
  config: Record<string, unknown>;
  options?: { id: ID; value: string; color: string | null; order: number }[];
}

export interface NotificationDto {
  id: ID;
  type: NotificationType;
  issueId: ID | null;
  actorId: ID | null;
  /** Ảnh đại diện của người làm — chỉ có khi ĐỌC danh sách (`GET /notifications`); event realtime không kèm. */
  actorAvatarUrl?: string | null;
  payload: Record<string, unknown>;
  readAt: ISODate | null;
  createdAt: ISODate;
}

export interface DashboardDto {
  id: ID;
  name: string;
  description: string | null;
  scope: DashboardScope;
  isDefault: boolean;
  layout: Record<string, unknown>;
  widgets: WidgetDto[];
}

export interface WidgetDto {
  id: ID;
  type: WidgetType;
  title: string;
  config: Record<string, unknown>;
  position: Record<string, unknown>;
  refreshSec: number | null;
}

export interface SavedFilterDto {
  id: ID;
  name: string;
  jql: string;
  visibility: FilterVisibility;
  ownerId: ID;
}

// ---------- Import từ Jira ----------

/** Kết quả phân tích file CSV Jira (bước 1 của wizard). */
export interface JiraAnalyzeResult {
  analyzeId: string;
  rows: number;
  projectKeys: string[];
  issueTypes: string[];
  statuses: string[];
  priorities: string[];
  users: Array<{ name: string; email?: string }>;
  unknownColumns: string[];
}

/** Tiến độ / kết quả một lần import (poll `GET /import/jobs/:id`). */
export interface ImportJobDto {
  id: ID;
  source: 'JIRA_CLOUD' | 'JIRA_SERVER' | 'CSV';
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;
  totalItems: number | null;
  processedItems: number;
  result: Record<string, unknown> | null;
  /** Mỗi dòng một lỗi/cảnh báo: "Dòng 5 (ABC-12): lý do". */
  errorLog: string | null;
  createdAt: ISODate;
  completedAt: ISODate | null;
}

/** Tóm tắt chạy thử (dry-run) — không ghi gì vào DB. */
export interface JiraDryRunResult {
  dryRun: true;
  total: number;
  epics: number;
  subtasks: number;
  sprints: number;
  labels: number;
  comments: number;
  /** Số dòng sẽ bị bỏ qua vì mã Jira đã có trong workspace hoặc lặp trong tệp (chỉ khi giữ mã Jira, L27). */
  duplicateKeys: number;
  /** Số dòng có mã Jira sai dạng `KEY-123` — vẫn tạo nhưng bằng mã Tirapro tự sinh (L27). */
  invalidKeys: number;
  /** Số việc sẽ tự gán khi người phụ trách (đã nhớ email, chưa là thành viên) được thêm vào workspace (L28). */
  rememberedAssignees: number;
  warnings: string[];
}

/** Dữ liệu đích để dựng bảng mapping của wizard nhập Jira. */
export interface JiraImportTargets {
  projects: Array<{ id: ID; key: string; name: string }>;
  issueTypes: Array<{ id: ID; name: string; isSubtask: boolean }>;
  priorities: Array<{ id: ID; name: string }>;
  /** Trạng thái trong workflow của project được chọn; rỗng khi chưa chọn hoặc tạo project mới. */
  statuses: Array<{ id: ID; name: string }>;
  members: Array<{ id: ID; displayName: string; email: string }>;
}

/** Một lần ghi nhận thời gian trên issue. `timeSpentSec` tính bằng giây. */
export interface WorklogDto {
  id: ID;
  issueId: ID;
  author: Pick<UserDto, 'id' | 'displayName' | 'avatarUrl'>;
  timeSpentSec: number;
  startedAt: ISODate;
  comment: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** Danh sách worklog kèm tổng và ước lượng hiện tại của issue (giây). */
export interface WorklogListDto {
  items: WorklogDto[];
  totalSec: number;
  originalEstimate: number | null;
  remainingEstimate: number | null;
}

/** Quy tắc tự động hoá (khi… nếu… thì…). `conditions`/`actions` là JSON đã qua zod ở `@tirapro/shared`. */
export interface AutomationRuleDto {
  id: ID;
  workspaceId: ID;
  projectId: ID | null;
  name: string;
  enabled: boolean;
  trigger: RuleTrigger;
  triggerConfig: Record<string, unknown>;
  conditions: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  createdById: ID;
  lastRunAt: ISODate | null;
  runCount: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface AutomationRunStepDto {
  step: string;
  ok: boolean;
  message: string;
}

export interface AutomationRunDto {
  id: ID;
  ruleId: ID;
  issueId: ID | null;
  issueKey: string | null;
  status: RuleRunStatus;
  log: AutomationRunStepDto[];
  durationMs: number;
  createdAt: ISODate;
}

/** Kết quả chạy thử (dry-run): không ghi gì, chỉ trả log. */
export interface AutomationRuleTestResultDto {
  status: RuleRunStatus;
  log: AutomationRunStepDto[];
}
