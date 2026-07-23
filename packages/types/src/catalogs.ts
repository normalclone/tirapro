/**
 * Catalog DEFAULT để seed khi tạo workspace. Đây là CONFIG khởi tạo, không phải
 * hằng số cứng — sau khi seed, admin sửa trong DB (Priority/Resolution/LinkType/
 * IssueType/Workflow). Workflow template được CLONE sang mỗi project khi tạo.
 */
import type { IssueTypeKey, StatusCategory, BoardType } from './enums';

export interface PrioritySeed {
  name: string;
  iconKey: string;
  color: string;
  rank: number;
  isDefault?: boolean;
}

export const DEFAULT_PRIORITIES: PrioritySeed[] = [
  { name: 'Highest', iconKey: 'priority-highest', color: 'oklch(0.55 0.20 25)', rank: 5 },
  { name: 'High', iconKey: 'priority-high', color: 'oklch(0.65 0.17 45)', rank: 4 },
  { name: 'Medium', iconKey: 'priority-medium', color: 'oklch(0.72 0.15 75)', rank: 3, isDefault: true },
  { name: 'Low', iconKey: 'priority-low', color: 'oklch(0.58 0.13 150)', rank: 2 },
  { name: 'Lowest', iconKey: 'priority-lowest', color: 'oklch(0.60 0.018 256)', rank: 1 },
];

export interface SeveritySeed {
  name: string;
  description: string;
  color: string;
  rank: number;
  isDefault?: boolean;
}

// Severity = mức nghiêm trọng kỹ thuật (tách khỏi Priority nghiệp vụ).
export const DEFAULT_SEVERITIES: SeveritySeed[] = [
  { name: 'Critical', description: 'Sập/chặn hoàn toàn, mất dữ liệu', color: 'oklch(0.55 0.20 25)', rank: 4 },
  { name: 'Major', description: 'Lỗi nặng, ảnh hưởng chức năng chính', color: 'oklch(0.65 0.17 45)', rank: 3, isDefault: true },
  { name: 'Minor', description: 'Lỗi nhỏ, có workaround', color: 'oklch(0.72 0.15 75)', rank: 2 },
  { name: 'Trivial', description: 'Mỹ thuật/typo, ít ảnh hưởng', color: 'oklch(0.60 0.018 256)', rank: 1 },
];

export interface ResolutionSeed {
  name: string;
  description: string;
  rank: number;
  isDefault?: boolean;
}

export const DEFAULT_RESOLUTIONS: ResolutionSeed[] = [
  { name: 'Done', description: 'Hoàn thành', rank: 1, isDefault: true },
  { name: "Won't Do", description: 'Quyết định không làm', rank: 2 },
  { name: 'Duplicate', description: 'Trùng với issue khác', rank: 3 },
  { name: 'Cannot Reproduce', description: 'Không tái hiện được', rank: 4 },
  { name: 'Incomplete', description: 'Thiếu thông tin', rank: 5 },
];

export interface LinkTypeSeed {
  name: string;
  outwardName: string;
  inwardName: string;
}

export const DEFAULT_LINK_TYPES: LinkTypeSeed[] = [
  { name: 'Blocks', outwardName: 'blocks', inwardName: 'is blocked by' },
  { name: 'Relates', outwardName: 'relates to', inwardName: 'relates to' },
  { name: 'Duplicates', outwardName: 'duplicates', inwardName: 'is duplicated by' },
  { name: 'Clones', outwardName: 'clones', inwardName: 'is cloned by' },
];

export interface IssueTypeSeed {
  name: string;
  key: IssueTypeKey;
  color: string;
  hierarchyLevel: number;
  isSubtask?: boolean;
}

export const DEFAULT_ISSUE_TYPES: IssueTypeSeed[] = [
  { name: 'Epic', key: 'EPIC', color: 'oklch(0.55 0.16 300)', hierarchyLevel: 1 },
  { name: 'Story', key: 'STORY', color: 'oklch(0.58 0.13 150)', hierarchyLevel: 0 },
  { name: 'Task', key: 'TASK', color: 'oklch(0.55 0.13 245)', hierarchyLevel: 0 },
  { name: 'Bug', key: 'BUG', color: 'oklch(0.55 0.20 25)', hierarchyLevel: 0 },
  { name: 'Sub-task', key: 'SUBTASK', color: 'oklch(0.60 0.018 256)', hierarchyLevel: -1, isSubtask: true },
];

export interface WorkflowStatusSeed {
  name: string;
  category: StatusCategory;
  color: string;
  order: number;
  isInitial?: boolean;
}

export interface WorkflowTransitionSeed {
  name: string;
  /** null = từ mọi trạng thái. */
  from: string | null;
  to: string;
}

export interface WorkflowTemplateSeed {
  name: string;
  description: string;
  boardType: BoardType;
  isDefault?: boolean;
  statuses: WorkflowStatusSeed[];
  transitions: WorkflowTransitionSeed[];
}

const SCRUM_STATUSES: WorkflowStatusSeed[] = [
  { name: 'To Do', category: 'TODO', color: 'oklch(0.60 0.018 256)', order: 0, isInitial: true },
  { name: 'In Progress', category: 'IN_PROGRESS', color: 'oklch(0.55 0.13 245)', order: 1 },
  { name: 'In Review', category: 'IN_PROGRESS', color: 'oklch(0.62 0.13 285)', order: 2 },
  { name: 'Done', category: 'DONE', color: 'oklch(0.58 0.13 150)', order: 3 },
];

export const DEFAULT_WORKFLOW_TEMPLATES: WorkflowTemplateSeed[] = [
  {
    name: 'Scrum mặc định',
    description: 'Quy trình Scrum chuẩn: To Do → In Progress → In Review → Done',
    boardType: 'SCRUM',
    isDefault: true,
    statuses: SCRUM_STATUSES,
    transitions: [
      { name: 'Bắt đầu', from: 'To Do', to: 'In Progress' },
      { name: 'Gửi review', from: 'In Progress', to: 'In Review' },
      { name: 'Trả lại', from: 'In Review', to: 'In Progress' },
      { name: 'Hoàn thành', from: 'In Review', to: 'Done' },
      { name: 'Tạm dừng', from: 'In Progress', to: 'To Do' },
      { name: 'Mở lại', from: 'Done', to: 'To Do' },
    ],
  },
  {
    name: 'Kanban mặc định',
    description: 'Kanban đơn giản, di chuyển tự do giữa các cột',
    boardType: 'KANBAN',
    statuses: [
      { name: 'To Do', category: 'TODO', color: 'oklch(0.60 0.018 256)', order: 0, isInitial: true },
      { name: 'In Progress', category: 'IN_PROGRESS', color: 'oklch(0.55 0.13 245)', order: 1 },
      { name: 'Done', category: 'DONE', color: 'oklch(0.58 0.13 150)', order: 2 },
    ],
    // from = null: cho phép chuyển từ bất kỳ trạng thái nào (Kanban linh hoạt)
    transitions: [
      { name: 'To To Do', from: null, to: 'To Do' },
      { name: 'To In Progress', from: null, to: 'In Progress' },
      { name: 'To Done', from: null, to: 'Done' },
    ],
  },
];

/**
 * Các khối metric có thể chọn để TỔNG HỢP vào report digest (Telegram/email) —
 * "chọn các thông tin cần tổng hợp". Lưu vào ReportSubscription.metrics (theo key).
 */
export interface ReportMetricBlock {
  key: string;
  label: string;
  description: string;
  scope: 'project' | 'sprint' | 'both';
}

export const REPORT_METRIC_BLOCKS: ReportMetricBlock[] = [
  { key: 'open_count', label: 'Số issue đang mở', description: 'Tổng issue chưa Done', scope: 'both' },
  { key: 'closed_count', label: 'Số issue đã đóng', description: 'Issue chuyển Done trong kỳ', scope: 'both' },
  { key: 'by_status', label: 'Theo trạng thái', description: 'Phân bố issue theo status', scope: 'both' },
  { key: 'by_assignee', label: 'Theo người thực hiện', description: 'Khối lượng theo assignee', scope: 'both' },
  { key: 'by_priority', label: 'Theo độ ưu tiên', description: 'Phân bố theo priority', scope: 'both' },
  { key: 'by_type', label: 'Theo loại issue', description: 'Story/Task/Bug...', scope: 'both' },
  { key: 'overdue', label: 'Quá hạn', description: 'Issue quá dueDate chưa xong', scope: 'project' },
  { key: 'recently_updated', label: 'Cập nhật gần đây', description: 'Issue đổi trong kỳ', scope: 'both' },
  { key: 'burndown', label: 'Burndown', description: 'Điểm còn lại theo ngày của sprint', scope: 'sprint' },
  { key: 'velocity', label: 'Velocity', description: 'Điểm hoàn thành qua các sprint', scope: 'project' },
  { key: 'created_vs_resolved', label: 'Tạo vs Giải quyết', description: 'Xu hướng tạo mới vs đóng', scope: 'project' },
  { key: 'sprint_summary', label: 'Tóm tắt sprint', description: 'Cam kết / hoàn thành / phát sinh', scope: 'sprint' },
];
