// FILE SINH TỰ ĐỘNG từ schema.prisma — chạy pnpm gen:enums, KHÔNG sửa tay
/**
 * Enums dùng chung FE/BE. Giá trị khớp 1:1 với Prisma enums trong
 * apps/api/prisma/schema.prisma. Mỗi enum là const-object + type cùng tên
 * => dùng được cả như value (UserStatus.ACTIVE) lẫn như type (: UserStatus).
 *
 * LƯU Ý: IssuePriority / IssueResolution / IssueLinkType KHÔNG phải enum —
 * chúng là bảng config (Priority/Resolution/LinkType). Xem catalogs.ts cho
 * danh sách default seed + DTO ở entities.ts.
 */

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  DEACTIVATED: 'DEACTIVATED',
  INVITED: 'INVITED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const WorkspacePlan = {
  FREE: 'FREE',
  PRO: 'PRO',
  ENTERPRISE: 'ENTERPRISE',
} as const;
export type WorkspacePlan = (typeof WorkspacePlan)[keyof typeof WorkspacePlan];

export const RoleScope = {
  WORKSPACE: 'WORKSPACE',
  PROJECT: 'PROJECT',
} as const;
export type RoleScope = (typeof RoleScope)[keyof typeof RoleScope];

export const PermissionScope = {
  WORKSPACE: 'WORKSPACE',
  PROJECT: 'PROJECT',
} as const;
export type PermissionScope = (typeof PermissionScope)[keyof typeof PermissionScope];

export const ProjectType = {
  SCRUM: 'SCRUM',
  KANBAN: 'KANBAN',
} as const;
export type ProjectType = (typeof ProjectType)[keyof typeof ProjectType];

export const DefaultAssigneeMode = {
  UNASSIGNED: 'UNASSIGNED',
  PROJECT_LEAD: 'PROJECT_LEAD',
} as const;
export type DefaultAssigneeMode = (typeof DefaultAssigneeMode)[keyof typeof DefaultAssigneeMode];

export const ProjectHealth = {
  GREEN: 'GREEN',
  YELLOW: 'YELLOW',
  RED: 'RED',
} as const;
export type ProjectHealth = (typeof ProjectHealth)[keyof typeof ProjectHealth];

export const BoardType = {
  KANBAN: 'KANBAN',
  SCRUM: 'SCRUM',
} as const;
export type BoardType = (typeof BoardType)[keyof typeof BoardType];

export const StatusCategory = {
  TODO: 'TODO',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
} as const;
export type StatusCategory = (typeof StatusCategory)[keyof typeof StatusCategory];

export const SprintState = {
  FUTURE: 'FUTURE',
  ACTIVE: 'ACTIVE',
  CLOSED: 'CLOSED',
} as const;
export type SprintState = (typeof SprintState)[keyof typeof SprintState];

export const SnapshotKind = {
  START: 'START',
  DAILY: 'DAILY',
  SCOPE_CHANGE: 'SCOPE_CHANGE',
  CLOSE: 'CLOSE',
} as const;
export type SnapshotKind = (typeof SnapshotKind)[keyof typeof SnapshotKind];

export const IssueTypeKey = {
  EPIC: 'EPIC',
  STORY: 'STORY',
  TASK: 'TASK',
  BUG: 'BUG',
  SUBTASK: 'SUBTASK',
} as const;
export type IssueTypeKey = (typeof IssueTypeKey)[keyof typeof IssueTypeKey];

export const FixVersionType = {
  FIX: 'FIX',
  AFFECTS: 'AFFECTS',
} as const;
export type FixVersionType = (typeof FixVersionType)[keyof typeof FixVersionType];

export const VersionStatus = {
  UNRELEASED: 'UNRELEASED',
  RELEASED: 'RELEASED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type VersionStatus = (typeof VersionStatus)[keyof typeof VersionStatus];

export const RichTextFormat = {
  MARKDOWN: 'MARKDOWN',
  TIPTAP_JSON: 'TIPTAP_JSON',
} as const;
export type RichTextFormat = (typeof RichTextFormat)[keyof typeof RichTextFormat];

export const CustomFieldType = {
  TEXT: 'TEXT',
  TEXTAREA: 'TEXTAREA',
  NUMBER: 'NUMBER',
  DATE: 'DATE',
  DATETIME: 'DATETIME',
  SELECT: 'SELECT',
  MULTI_SELECT: 'MULTI_SELECT',
  CHECKBOX: 'CHECKBOX',
  USER: 'USER',
  URL: 'URL',
} as const;
export type CustomFieldType = (typeof CustomFieldType)[keyof typeof CustomFieldType];

export const FilterVisibility = {
  PRIVATE: 'PRIVATE',
  WORKSPACE: 'WORKSPACE',
  PROJECT: 'PROJECT',
} as const;
export type FilterVisibility = (typeof FilterVisibility)[keyof typeof FilterVisibility];

export const DashboardScope = {
  PRIVATE: 'PRIVATE',
  PROJECT: 'PROJECT',
  GLOBAL: 'GLOBAL',
  TEAM: 'TEAM',
} as const;
export type DashboardScope = (typeof DashboardScope)[keyof typeof DashboardScope];

export const WidgetType = {
  BURNDOWN: 'BURNDOWN',
  VELOCITY: 'VELOCITY',
  CFD: 'CFD',
  SPRINT_REPORT: 'SPRINT_REPORT',
  CONTROL_CHART: 'CONTROL_CHART',
  CREATED_VS_RESOLVED: 'CREATED_VS_RESOLVED',
  STAT_NUMBER: 'STAT_NUMBER',
  ISSUE_LIST: 'ISSUE_LIST',
  PIE_BY_FIELD: 'PIE_BY_FIELD',
  AI_INSIGHT: 'AI_INSIGHT',
  TOP_RISKS: 'TOP_RISKS',
  SLOW_GOALS: 'SLOW_GOALS',
  OVERLOAD: 'OVERLOAD',
} as const;
export type WidgetType = (typeof WidgetType)[keyof typeof WidgetType];

export const NotificationType = {
  ISSUE_ASSIGNED: 'ISSUE_ASSIGNED',
  ISSUE_UPDATED: 'ISSUE_UPDATED',
  MENTIONED: 'MENTIONED',
  COMMENT_ADDED: 'COMMENT_ADDED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  SPRINT_STARTED: 'SPRINT_STARTED',
  SPRINT_COMPLETED: 'SPRINT_COMPLETED',
  WATCHING_UPDATE: 'WATCHING_UPDATE',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const ActivityAction = {
  ISSUE_CREATED: 'ISSUE_CREATED',
  ISSUE_UPDATED: 'ISSUE_UPDATED',
  ISSUE_DELETED: 'ISSUE_DELETED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  ASSIGNEE_CHANGED: 'ASSIGNEE_CHANGED',
  PRIORITY_CHANGED: 'PRIORITY_CHANGED',
  FIELD_CHANGED: 'FIELD_CHANGED',
  COMMENT_ADDED: 'COMMENT_ADDED',
  COMMENT_DELETED: 'COMMENT_DELETED',
  SPRINT_CHANGED: 'SPRINT_CHANGED',
  SPRINT_STARTED: 'SPRINT_STARTED',
  SPRINT_COMPLETED: 'SPRINT_COMPLETED',
  PROJECT_KEY_CHANGED: 'PROJECT_KEY_CHANGED',
  ATTACHMENT_ADDED: 'ATTACHMENT_ADDED',
  LINK_ADDED: 'LINK_ADDED',
} as const;
export type ActivityAction = (typeof ActivityAction)[keyof typeof ActivityAction];

export const HistoryField = {
  STATUS: 'STATUS',
  STORY_POINTS: 'STORY_POINTS',
  SPRINT: 'SPRINT',
  ASSIGNEE: 'ASSIGNEE',
  TYPE: 'TYPE',
  RESOLUTION: 'RESOLUTION',
  SCOPE: 'SCOPE',
  PRIORITY: 'PRIORITY',
  TIME_SPENT: 'TIME_SPENT',
  DESCRIPTION: 'DESCRIPTION',
  COMPONENT: 'COMPONENT',
  FIX_VERSION: 'FIX_VERSION',
} as const;
export type HistoryField = (typeof HistoryField)[keyof typeof HistoryField];

export const AiSuggestionKind = {
  ASSIGNEE: 'ASSIGNEE',
  PRIORITY: 'PRIORITY',
  STORY_POINTS: 'STORY_POINTS',
  SUMMARY: 'SUMMARY',
  DESCRIPTION: 'DESCRIPTION',
  SPRINT_PLAN: 'SPRINT_PLAN',
} as const;
export type AiSuggestionKind = (typeof AiSuggestionKind)[keyof typeof AiSuggestionKind];

export const AiSuggestionStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
} as const;
export type AiSuggestionStatus = (typeof AiSuggestionStatus)[keyof typeof AiSuggestionStatus];

export const EmbeddingEntityType = {
  ISSUE: 'ISSUE',
  COMMENT: 'COMMENT',
} as const;
export type EmbeddingEntityType = (typeof EmbeddingEntityType)[keyof typeof EmbeddingEntityType];

export const TriageState = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  SNOOZED: 'SNOOZED',
} as const;
export type TriageState = (typeof TriageState)[keyof typeof TriageState];

export const RuleTrigger = {
  ISSUE_CREATED: 'ISSUE_CREATED',
  ISSUE_TRANSITIONED: 'ISSUE_TRANSITIONED',
  ISSUE_UPDATED: 'ISSUE_UPDATED',
  COMMENT_ADDED: 'COMMENT_ADDED',
  SCHEDULED: 'SCHEDULED',
} as const;
export type RuleTrigger = (typeof RuleTrigger)[keyof typeof RuleTrigger];

export const RuleRunStatus = {
  SUCCESS: 'SUCCESS',
  SKIPPED: 'SKIPPED',
  FAILED: 'FAILED',
} as const;
export type RuleRunStatus = (typeof RuleRunStatus)[keyof typeof RuleRunStatus];

export const IntegrationType = {
  TELEGRAM: 'TELEGRAM',
  JIRA: 'JIRA',
  GITHUB: 'GITHUB',
  GITLAB: 'GITLAB',
  SLACK: 'SLACK',
  WEBHOOK: 'WEBHOOK',
  EMAIL: 'EMAIL',
} as const;
export type IntegrationType = (typeof IntegrationType)[keyof typeof IntegrationType];

export const DevLinkType = {
  BRANCH: 'BRANCH',
  COMMIT: 'COMMIT',
  PULL_REQUEST: 'PULL_REQUEST',
  TAG: 'TAG',
} as const;
export type DevLinkType = (typeof DevLinkType)[keyof typeof DevLinkType];

export const DevLinkState = {
  OPEN: 'OPEN',
  DRAFT: 'DRAFT',
  MERGED: 'MERGED',
  CLOSED: 'CLOSED',
} as const;
export type DevLinkState = (typeof DevLinkState)[keyof typeof DevLinkState];

export const IntegrationStatus = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
  ERROR: 'ERROR',
} as const;
export type IntegrationStatus = (typeof IntegrationStatus)[keyof typeof IntegrationStatus];

export const ImportSource = {
  JIRA_CLOUD: 'JIRA_CLOUD',
  JIRA_SERVER: 'JIRA_SERVER',
  CSV: 'CSV',
} as const;
export type ImportSource = (typeof ImportSource)[keyof typeof ImportSource];

export const ImportStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type ImportStatus = (typeof ImportStatus)[keyof typeof ImportStatus];

export const DigestSchedule = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  SPRINT_END: 'SPRINT_END',
  MANUAL: 'MANUAL',
} as const;
export type DigestSchedule = (typeof DigestSchedule)[keyof typeof DigestSchedule];

export const GuideType = {
  TOUR: 'TOUR',
  HELP: 'HELP',
  CHECKLIST: 'CHECKLIST',
} as const;
export type GuideType = (typeof GuideType)[keyof typeof GuideType];

export const GuideProgressState = {
  SEEN: 'SEEN',
  COMPLETED: 'COMPLETED',
  DISMISSED: 'DISMISSED',
  SNOOZED: 'SNOOZED',
} as const;
export type GuideProgressState = (typeof GuideProgressState)[keyof typeof GuideProgressState];

export const DependencyType = {
  FS: 'FS',
  SS: 'SS',
  FF: 'FF',
  SF: 'SF',
} as const;
export type DependencyType = (typeof DependencyType)[keyof typeof DependencyType];

export const RaidKind = {
  RISK: 'RISK',
  ASSUMPTION: 'ASSUMPTION',
  ISSUE: 'ISSUE',
  DEPENDENCY: 'DEPENDENCY',
} as const;
export type RaidKind = (typeof RaidKind)[keyof typeof RaidKind];

export const RaidStatus = {
  OPEN: 'OPEN',
  MITIGATING: 'MITIGATING',
  CLOSED: 'CLOSED',
  ACCEPTED: 'ACCEPTED',
} as const;
export type RaidStatus = (typeof RaidStatus)[keyof typeof RaidStatus];

export const ObjectiveStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  CLOSED: 'CLOSED',
} as const;
export type ObjectiveStatus = (typeof ObjectiveStatus)[keyof typeof ObjectiveStatus];

export const KeyResultUnit = {
  NUMBER: 'NUMBER',
  PERCENT: 'PERCENT',
  CURRENCY: 'CURRENCY',
} as const;
export type KeyResultUnit = (typeof KeyResultUnit)[keyof typeof KeyResultUnit];

export const RecurrenceFreq = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
} as const;
export type RecurrenceFreq = (typeof RecurrenceFreq)[keyof typeof RecurrenceFreq];

export const TimeOffKind = {
  LEAVE: 'LEAVE',
  HOLIDAY: 'HOLIDAY',
  OTHER: 'OTHER',
} as const;
export type TimeOffKind = (typeof TimeOffKind)[keyof typeof TimeOffKind];

export const MailStatus = {
  PENDING: 'PENDING',
  SENDING: 'SENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
} as const;
export type MailStatus = (typeof MailStatus)[keyof typeof MailStatus];
