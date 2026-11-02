/**
 * Catalog DEFAULT để seed khi tạo workspace. Đây là CONFIG khởi tạo, không phải
 * hằng số cứng — sau khi seed, admin sửa trong DB (Priority/Resolution/LinkType/
 * IssueType/Workflow). Workflow template được CLONE sang mỗi project khi tạo.
 */
import type { IssueTypeKey, StatusCategory, BoardType, ProjectType } from './enums';

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
  {
    name: 'Medium',
    iconKey: 'priority-medium',
    color: 'oklch(0.72 0.15 75)',
    rank: 3,
    isDefault: true,
  },
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
  {
    name: 'Critical',
    description: 'Sập/chặn hoàn toàn, mất dữ liệu',
    color: 'oklch(0.55 0.20 25)',
    rank: 4,
  },
  {
    name: 'Major',
    description: 'Lỗi nặng, ảnh hưởng chức năng chính',
    color: 'oklch(0.65 0.17 45)',
    rank: 3,
    isDefault: true,
  },
  { name: 'Minor', description: 'Lỗi nhỏ, có workaround', color: 'oklch(0.72 0.15 75)', rank: 2 },
  {
    name: 'Trivial',
    description: 'Mỹ thuật/typo, ít ảnh hưởng',
    color: 'oklch(0.60 0.018 256)',
    rank: 1,
  },
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
  { name: 'Duplicate', description: 'Trùng với công việc khác', rank: 3 },
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
  { name: 'Causes', outwardName: 'causes', inwardName: 'is caused by' },
  { name: 'Tests', outwardName: 'tests', inwardName: 'is tested by' },
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
  {
    name: 'Sub-task',
    key: 'SUBTASK',
    color: 'oklch(0.60 0.018 256)',
    hierarchyLevel: -1,
    isSubtask: true,
  },
];

/**
 * Nhãn hiển thị của nhóm trạng thái (category) — MỘT nguồn cho web và API (digest, tin nhắn).
 * Thuật ngữ Agile tiếng Anh, khớp tên trạng thái mặc định. Xem docs/UX_CONVENTIONS.md §19.
 */
export const STATUS_CATEGORY_LABEL: Record<StatusCategory, string> = {
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
};

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
  /**
   * Cột bảng tường minh (tên cột → tên các trạng thái). Bỏ trống = 1 cột / trạng thái, tên cột = tên trạng thái.
   */
  boardColumns?: WorkflowBoardColumnSeed[];
}

export interface WorkflowBoardColumnSeed {
  name: string;
  statuses: string[];
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
      {
        name: 'To Do',
        category: 'TODO',
        color: 'oklch(0.60 0.018 256)',
        order: 0,
        isInitial: true,
      },
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
  // Mẫu thứ 3 đặt CUỐI mảng: `find(boardType === 'KANBAN')` phải vẫn trả 'Kanban mặc định'.
  {
    name: 'Quản lý yêu cầu',
    description:
      'Theo dõi yêu cầu từ lúc đề xuất đến khi bàn giao: Đề xuất → Phân tích → Duyệt → Bàn giao',
    boardType: 'KANBAN',
    statuses: [
      {
        name: 'Đề xuất',
        category: 'TODO',
        color: 'oklch(0.60 0.018 256)',
        order: 0,
        isInitial: true,
      },
      { name: 'Đang phân tích', category: 'IN_PROGRESS', color: 'oklch(0.55 0.13 245)', order: 1 },
      { name: 'Chờ duyệt', category: 'IN_PROGRESS', color: 'oklch(0.62 0.13 285)', order: 2 },
      { name: 'Đã duyệt', category: 'IN_PROGRESS', color: 'oklch(0.58 0.13 200)', order: 3 },
      { name: 'Đã bàn giao', category: 'DONE', color: 'oklch(0.58 0.13 150)', order: 4 },
      { name: 'Từ chối', category: 'DONE', color: 'oklch(0.55 0.20 25)', order: 5 },
    ],
    transitions: [
      { name: 'Bắt đầu phân tích', from: 'Đề xuất', to: 'Đang phân tích' },
      { name: 'Gửi duyệt', from: 'Đang phân tích', to: 'Chờ duyệt' },
      { name: 'Duyệt', from: 'Chờ duyệt', to: 'Đã duyệt' },
      { name: 'Trả lại', from: 'Chờ duyệt', to: 'Đang phân tích' },
      { name: 'Từ chối', from: 'Chờ duyệt', to: 'Từ chối' },
      { name: 'Từ chối', from: 'Đề xuất', to: 'Từ chối' },
      { name: 'Bàn giao', from: 'Đã duyệt', to: 'Đã bàn giao' },
      { name: 'Mở lại', from: 'Từ chối', to: 'Đề xuất' },
      { name: 'Mở lại', from: 'Đã bàn giao', to: 'Đề xuất' },
    ],
  },
  {
    name: 'Phát triển phần mềm',
    description:
      'Quy trình BA → Dev → Test: Cần làm → Đang phân tích → Sẵn sàng phát triển → Đang làm → Review code → Chờ test → Đang test → Hoàn thành (hoặc Không xử lý)',
    boardType: 'KANBAN',
    statuses: [
      { name: 'Cần làm', category: 'TODO', color: '#64748b', order: 0, isInitial: true },
      { name: 'Đang phân tích', category: 'TODO', color: '#8b5cf6', order: 1 },
      { name: 'Sẵn sàng phát triển', category: 'TODO', color: '#0ea5e9', order: 2 },
      { name: 'Đang làm', category: 'IN_PROGRESS', color: '#2563eb', order: 3 },
      { name: 'Review code', category: 'IN_PROGRESS', color: '#6366f1', order: 4 },
      { name: 'Chờ test', category: 'IN_PROGRESS', color: '#f59e0b', order: 5 },
      { name: 'Đang test', category: 'IN_PROGRESS', color: '#d97706', order: 6 },
      { name: 'Hoàn thành', category: 'DONE', color: '#16a34a', order: 7 },
      { name: 'Không xử lý', category: 'DONE', color: '#94a3b8', order: 8 },
    ],
    transitions: [
      { name: 'Phân tích', from: 'Cần làm', to: 'Đang phân tích' },
      { name: 'Sẵn sàng phát triển', from: 'Đang phân tích', to: 'Sẵn sàng phát triển' },
      { name: 'Sẵn sàng phát triển', from: 'Cần làm', to: 'Sẵn sàng phát triển' },
      { name: 'Bắt đầu làm', from: 'Cần làm', to: 'Đang làm' },
      { name: 'Bắt đầu làm', from: 'Sẵn sàng phát triển', to: 'Đang làm' },
      { name: 'Cần làm rõ', from: 'Sẵn sàng phát triển', to: 'Đang phân tích' },
      { name: 'Tạm dừng', from: 'Đang làm', to: 'Cần làm' },
      { name: 'Gửi review', from: 'Đang làm', to: 'Review code' },
      { name: 'Trả lại', from: 'Review code', to: 'Đang làm' },
      { name: 'Chuyển test', from: 'Đang làm', to: 'Chờ test' },
      { name: 'Chuyển test', from: 'Review code', to: 'Chờ test' },
      { name: 'Bắt đầu test', from: 'Chờ test', to: 'Đang test' },
      { name: 'Test đạt', from: 'Đang test', to: 'Hoàn thành' },
      { name: 'Test không đạt', from: 'Đang test', to: 'Đang làm' },
      { name: 'Test không đạt', from: 'Chờ test', to: 'Đang làm' },
      { name: 'Không xử lý', from: null, to: 'Không xử lý' },
      { name: 'Mở lại', from: 'Hoàn thành', to: 'Cần làm' },
      { name: 'Mở lại', from: 'Không xử lý', to: 'Cần làm' },
    ],
    boardColumns: [
      { name: 'Cần làm', statuses: ['Cần làm'] },
      { name: 'BA phân tích', statuses: ['Đang phân tích'] },
      { name: 'Sẵn sàng', statuses: ['Sẵn sàng phát triển'] },
      { name: 'Đang làm', statuses: ['Đang làm'] },
      { name: 'Review code', statuses: ['Review code'] },
      { name: 'Chờ test', statuses: ['Chờ test'] },
      { name: 'Đang test', statuses: ['Đang test'] },
      { name: 'Xong', statuses: ['Hoàn thành', 'Không xử lý'] },
    ],
  },
  {
    name: 'Việc chung',
    description:
      'Việc không phải lập trình (khảo sát, hạ tầng, đào tạo, hồ sơ): Cần làm → Đang làm → Chờ duyệt → Hoàn thành',
    boardType: 'KANBAN',
    statuses: [
      { name: 'Cần làm', category: 'TODO', color: '#64748b', order: 0, isInitial: true },
      { name: 'Đang làm', category: 'IN_PROGRESS', color: '#2563eb', order: 1 },
      { name: 'Chờ duyệt', category: 'IN_PROGRESS', color: '#f59e0b', order: 2 },
      { name: 'Hoàn thành', category: 'DONE', color: '#16a34a', order: 3 },
      { name: 'Không xử lý', category: 'DONE', color: '#94a3b8', order: 4 },
    ],
    transitions: [
      { name: 'Bắt đầu làm', from: 'Cần làm', to: 'Đang làm' },
      { name: 'Tạm dừng', from: 'Đang làm', to: 'Cần làm' },
      { name: 'Gửi duyệt', from: 'Đang làm', to: 'Chờ duyệt' },
      { name: 'Trả lại', from: 'Chờ duyệt', to: 'Đang làm' },
      { name: 'Hoàn thành', from: 'Chờ duyệt', to: 'Hoàn thành' },
      { name: 'Hoàn thành', from: 'Đang làm', to: 'Hoàn thành' },
      { name: 'Không xử lý', from: null, to: 'Không xử lý' },
      { name: 'Mở lại', from: 'Hoàn thành', to: 'Cần làm' },
      { name: 'Mở lại', from: 'Không xử lý', to: 'Cần làm' },
    ],
    boardColumns: [
      { name: 'Cần làm', statuses: ['Cần làm'] },
      { name: 'Đang làm', statuses: ['Đang làm'] },
      { name: 'Chờ duyệt', statuses: ['Chờ duyệt'] },
      { name: 'Xong', statuses: ['Hoàn thành', 'Không xử lý'] },
    ],
  },
];

/** Khoá mẫu dự án chọn ở hộp "Tạo dự án". */
export type ProjectTemplateKey = 'scrum' | 'kanban' | 'requirements' | 'software' | 'general';

export interface ProjectTemplateDef {
  key: ProjectTemplateKey;
  name: string;
  description: string;
  /** Loại bảng của dự án (SCRUM | KANBAN). */
  projectType: ProjectType;
  /** Tên mẫu trong DEFAULT_WORKFLOW_TEMPLATES. */
  workflowName: string;
  /** JQL lọc bảng sinh sẵn (vd. ẩn Epic khỏi bảng). Bỏ trống = bảng không lọc. */
  boardFilterJql?: string;
}

export const PROJECT_TEMPLATES: ProjectTemplateDef[] = [
  {
    key: 'scrum',
    name: 'Scrum',
    description:
      'Làm theo sprint: To Do → In Progress → In Review → Done, có Việc chờ và báo cáo burndown',
    projectType: 'SCRUM',
    workflowName: 'Scrum mặc định',
  },
  {
    key: 'kanban',
    name: 'Kanban',
    description:
      'Dòng việc liên tục, không sprint: To Do → In Progress → Done, kéo thẻ tự do giữa các cột',
    projectType: 'KANBAN',
    workflowName: 'Kanban mặc định',
  },
  {
    key: 'requirements',
    name: 'Quản lý yêu cầu',
    description:
      'Theo dõi yêu cầu từ đề xuất đến bàn giao: Đề xuất → Đang phân tích → Chờ duyệt → Đã duyệt → Đã bàn giao (hoặc Từ chối)',
    projectType: 'KANBAN',
    workflowName: 'Quản lý yêu cầu',
  },
  {
    key: 'software',
    name: 'Phát triển phần mềm',
    description:
      'Quy trình BA → Dev → Test: Cần làm → Đang phân tích → Sẵn sàng phát triển → Đang làm → Review code → Chờ test → Đang test → Hoàn thành (hoặc Không xử lý)',
    projectType: 'KANBAN',
    workflowName: 'Phát triển phần mềm',
    boardFilterJql: 'type != Epic',
  },
  {
    key: 'general',
    name: 'Việc chung',
    description:
      'Việc không phải lập trình (khảo sát, hạ tầng, đào tạo, hồ sơ): Cần làm → Đang làm → Chờ duyệt → Hoàn thành',
    projectType: 'KANBAN',
    workflowName: 'Việc chung',
    boardFilterJql: 'type != Epic',
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
  {
    key: 'open_count',
    label: 'Số công việc đang mở',
    description: 'Tổng công việc chưa Done',
    scope: 'both',
  },
  {
    key: 'closed_count',
    label: 'Số công việc đã đóng',
    description: 'Công việc chuyển Done trong kỳ',
    scope: 'both',
  },
  {
    key: 'by_status',
    label: 'Theo trạng thái',
    description: 'Phân bố công việc theo trạng thái',
    scope: 'both',
  },
  {
    key: 'by_assignee',
    label: 'Theo người thực hiện',
    description: 'Khối lượng theo người thực hiện',
    scope: 'both',
  },
  {
    key: 'by_priority',
    label: 'Theo mức ưu tiên',
    description: 'Phân bố theo mức ưu tiên',
    scope: 'both',
  },
  { key: 'by_type', label: 'Theo loại công việc', description: 'Story/Task/Bug...', scope: 'both' },
  {
    key: 'overdue',
    label: 'Quá hạn',
    description: 'Công việc quá hạn chưa xong',
    scope: 'project',
  },
  {
    key: 'recently_updated',
    label: 'Cập nhật gần đây',
    description: 'Công việc đổi trong kỳ',
    scope: 'both',
  },
  {
    key: 'burndown',
    label: 'Burndown',
    description: 'Điểm còn lại theo ngày của sprint',
    scope: 'sprint',
  },
  {
    key: 'velocity',
    label: 'Velocity',
    description: 'Điểm hoàn thành qua các sprint',
    scope: 'project',
  },
  {
    key: 'created_vs_resolved',
    label: 'Tạo vs Giải quyết',
    description: 'Xu hướng tạo mới vs đóng',
    scope: 'project',
  },
  {
    key: 'sprint_summary',
    label: 'Tóm tắt sprint',
    description: 'Cam kết / hoàn thành / phát sinh',
    scope: 'sprint',
  },
];
