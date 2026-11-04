import type { IssueTypeKey, StatusCategory, WorkflowDefaultKey } from '@tirapro/types';

export {
  setWorkspaceSchemeSchema,
  setProjectOverrideSchema,
  type SetWorkspaceSchemeInput,
  type SetProjectOverrideInput,
} from './schemas/workflow-scheme';

/**
 * Ba quy trình mặc định (Standard / Bug / Epic) và bảng ánh xạ dữ liệu cũ.
 * MỘT nơi định nghĩa cho API (seed workspace mới, script migrate) + web.
 */

/** `from` của bước chuyển: tên trạng thái, `null` = mọi trạng thái, `'*OPEN'` = mọi trạng thái mở. */
export const WORKFLOW_OPEN_FROM = '*OPEN' as const;

export interface DefaultWorkflowStatus {
  name: string;
  category: StatusCategory;
  isInitial: boolean;
}

export interface DefaultWorkflowTransition {
  name: string;
  /** Tên trạng thái, `null` = mọi trạng thái, `WORKFLOW_OPEN_FROM` ('*OPEN') = mọi trạng thái mở. */
  from: string | null;
  to: string;
}

export interface DefaultWorkflowDef {
  name: string;
  statuses: DefaultWorkflowStatus[];
  transitions: DefaultWorkflowTransition[];
}

const st = (name: string, category: StatusCategory, isInitial = false): DefaultWorkflowStatus => ({
  name,
  category,
  isInitial,
});

/** Bước "tạm dừng / huỷ" dùng chung: mọi trạng thái mở → Pending / Cancelled. */
const OPEN_TO_PENDING: DefaultWorkflowTransition = {
  name: 'Tạm dừng',
  from: WORKFLOW_OPEN_FROM,
  to: 'Pending',
};
const OPEN_TO_CANCELLED: DefaultWorkflowTransition = {
  name: 'Huỷ',
  from: WORKFLOW_OPEN_FROM,
  to: 'Cancelled',
};

/** Trạng thái mở = chưa đóng (nhóm khác DONE) và không phải Pending. */
function isOpenStatus(s: DefaultWorkflowStatus): boolean {
  return s.category !== 'DONE' && s.name !== 'Pending';
}

const STANDARD_STATUSES = [
  st('To Do', 'TODO', true),
  st('Ready', 'TODO'),
  st('In Progress', 'IN_PROGRESS'),
  st('In Review', 'IN_PROGRESS'),
  st('Rework', 'IN_PROGRESS'),
  st('Pending', 'IN_PROGRESS'),
  st('Done', 'DONE'),
  st('Cancelled', 'DONE'),
];

const BUG_STATUSES = [
  st('New', 'TODO', true),
  st('To Do', 'TODO'),
  st('In Progress', 'IN_PROGRESS'),
  st('Ready for Retest', 'IN_PROGRESS'),
  st('Reopened', 'IN_PROGRESS'),
  st('Pending', 'IN_PROGRESS'),
  st('Done', 'DONE'),
  st('Closed', 'DONE'),
  st('Cancelled', 'DONE'),
];

const EPIC_STATUSES = [
  st('Not Started', 'TODO', true),
  st('In Progress', 'IN_PROGRESS'),
  st('Awaiting Acceptance', 'IN_PROGRESS'),
  st('Pending', 'IN_PROGRESS'),
  st('Done', 'DONE'),
  st('Cancelled', 'DONE'),
];

/** "Rời Pending": một bước tới mỗi trạng thái mở (giao diện gợi ý trạng thái trước khi tạm dừng). */
function leavePending(statuses: DefaultWorkflowStatus[]): DefaultWorkflowTransition[] {
  return statuses
    .filter(isOpenStatus)
    .map((s) => ({ name: `Tiếp tục: ${s.name}`, from: 'Pending', to: s.name }));
}

export const DEFAULT_WORKFLOWS: Record<WorkflowDefaultKey, DefaultWorkflowDef> = {
  STANDARD: {
    name: 'Standard Workflow',
    statuses: STANDARD_STATUSES,
    transitions: [
      { name: 'Sẵn sàng', from: 'To Do', to: 'Ready' },
      { name: 'Bắt đầu', from: 'Ready', to: 'In Progress' },
      { name: 'Gửi review', from: 'In Progress', to: 'In Review' },
      { name: 'Hoàn thành', from: 'In Review', to: 'Done' },
      { name: 'Làm lại', from: 'In Review', to: 'Rework' },
      { name: 'Tiếp tục làm', from: 'Rework', to: 'In Progress' },
      OPEN_TO_PENDING,
      ...leavePending(STANDARD_STATUSES),
      OPEN_TO_CANCELLED,
    ],
  },
  BUG: {
    name: 'Bug Workflow',
    statuses: BUG_STATUSES,
    transitions: [
      { name: 'Tiếp nhận', from: 'New', to: 'To Do' },
      { name: 'Bắt đầu sửa', from: 'To Do', to: 'In Progress' },
      { name: 'Chờ test lại', from: 'In Progress', to: 'Ready for Retest' },
      { name: 'Đạt', from: 'Ready for Retest', to: 'Done' },
      { name: 'Đóng', from: 'Done', to: 'Closed' },
      { name: 'Mở lại', from: 'Ready for Retest', to: 'Reopened' },
      { name: 'Sửa lại', from: 'Reopened', to: 'In Progress' },
      OPEN_TO_PENDING,
      ...leavePending(BUG_STATUSES),
      OPEN_TO_CANCELLED,
    ],
  },
  EPIC: {
    name: 'Epic Workflow',
    statuses: EPIC_STATUSES,
    transitions: [
      { name: 'Bắt đầu', from: 'Not Started', to: 'In Progress' },
      { name: 'Chờ nghiệm thu', from: 'In Progress', to: 'Awaiting Acceptance' },
      { name: 'Nghiệm thu', from: 'Awaiting Acceptance', to: 'Done' },
      OPEN_TO_PENDING,
      ...leavePending(EPIC_STATUSES),
      OPEN_TO_CANCELLED,
    ],
  },
};

export interface ExpandedWorkflowTransition {
  name: string;
  /** Tên trạng thái nguồn; `null` = từ mọi trạng thái (chỉ khi định nghĩa gốc khai `null`). */
  from: string | null;
  to: string;
}

/**
 * Trải `'*OPEN'` thành từng trạng thái mở (nhóm khác DONE, trừ Pending, trừ chính đích).
 * Kết quả chỉ còn tên trạng thái hoặc `null`; không có bước trùng.
 */
export function expandWorkflowTransitions(def: DefaultWorkflowDef): ExpandedWorkflowTransition[] {
  const open = def.statuses.filter(isOpenStatus).map((s) => s.name);
  const out: ExpandedWorkflowTransition[] = [];
  const seen = new Set<string>();
  const push = (t: ExpandedWorkflowTransition) => {
    const key = `${t.from ?? '*'}>${t.to}`;
    if (seen.has(key) || t.from === t.to) return;
    seen.add(key);
    out.push(t);
  };
  for (const t of def.transitions) {
    if (t.from === WORKFLOW_OPEN_FROM) {
      for (const o of open) push({ name: t.name, from: o, to: t.to });
    } else {
      push({ name: t.name, from: t.from, to: t.to });
    }
  }
  return out;
}

/** Loại việc → quy trình mặc định. `CUSTOM` = mọi loại tuỳ chỉnh (key null). */
export const DEFAULT_SCHEME: Record<IssueTypeKey | 'CUSTOM', WorkflowDefaultKey> = {
  EPIC: 'EPIC',
  STORY: 'STANDARD',
  TASK: 'STANDARD',
  BUG: 'BUG',
  SUBTASK: 'STANDARD',
  CUSTOM: 'STANDARD',
};

/**
 * Ánh xạ dữ liệu cũ: quy trình "Phát triển phần mềm" (9 trạng thái) → tên trạng thái trong từng
 * quy trình mặc định. Theo bảng trong đặc tả 2026-11-04.
 */
export const LEGACY_STATUS_MAP: Record<string, Record<WorkflowDefaultKey, string>> = {
  'Cần làm': { STANDARD: 'To Do', BUG: 'New', EPIC: 'Not Started' },
  'Đang phân tích': { STANDARD: 'To Do', BUG: 'To Do', EPIC: 'Not Started' },
  'Sẵn sàng phát triển': { STANDARD: 'Ready', BUG: 'To Do', EPIC: 'Not Started' },
  'Đang làm': { STANDARD: 'In Progress', BUG: 'In Progress', EPIC: 'In Progress' },
  'Review code': { STANDARD: 'In Review', BUG: 'In Progress', EPIC: 'In Progress' },
  'Chờ test': { STANDARD: 'In Review', BUG: 'Ready for Retest', EPIC: 'In Progress' },
  'Đang test': { STANDARD: 'In Review', BUG: 'Ready for Retest', EPIC: 'In Progress' },
  'Hoàn thành': { STANDARD: 'Done', BUG: 'Done', EPIC: 'Done' },
  'Không xử lý': { STANDARD: 'Cancelled', BUG: 'Cancelled', EPIC: 'Cancelled' },
};

/**
 * Ánh xạ theo nhóm cho quy trình cũ không có tên khớp:
 * TODO → trạng thái khởi tạo của quy trình đích; IN_PROGRESS → In Progress; DONE → Done.
 * Trả về TÊN trạng thái trong quy trình mặc định đích.
 */
export function mapStatusByCategory(category: StatusCategory, target: WorkflowDefaultKey): string {
  if (category === 'TODO') {
    const initial = DEFAULT_WORKFLOWS[target].statuses.find((s) => s.isInitial);
    if (!initial) throw new Error(`Quy trình ${target} thiếu trạng thái khởi tạo`);
    return initial.name;
  }
  return category === 'IN_PROGRESS' ? 'In Progress' : 'Done';
}
