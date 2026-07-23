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
  IssueTypeKey,
  NotificationType,
  ProjectType,
  RichTextFormat,
  RoleScope,
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
  lastSeenAt: ISODate | null;
  createdAt: ISODate;
}

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
}

/** Một thành viên kèm danh sách vai trò (workspace hoặc project). */
export interface MemberDto {
  membershipId: ID;
  user: UserDto;
  roles: RoleRefDto[];
  joinedAt?: ISODate | null;
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

export interface AuthTokensDto {
  accessToken: string;
  expiresIn: number;
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
  assignee?: UserDto | null;
}

export interface IssueDto extends IssueSummaryDto {
  workspaceId: ID;
  projectId: ID;
  number: number;
  description: string | null;
  descriptionFormat: RichTextFormat;
  reporter?: UserDto | null;
  reporterId: ID | null;
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
  rank: string;
  version: number;
  labels: LabelDto[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface CommentDto {
  id: ID;
  issueId: ID;
  authorId: ID | null;
  author?: UserDto | null;
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

export interface BoardDto {
  id: ID;
  projectId: ID;
  name: string;
  type: BoardType;
  filterJql: string | null;
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
