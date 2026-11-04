import {
  DASHBOARD_LIMITS,
  type DashboardDataScopeValue,
  type DashboardWidgetType,
  type WidgetInput,
} from './schemas/dashboard';

/**
 * Mẫu dashboard viết bằng mã (không lưu DB, người dùng không tự lưu mẫu). Chỉ dùng loại ô + cấu hình đã có trong
 * `schemas/dashboard.ts`; `dashboard-templates.spec.ts` parse mọi ô của mọi mẫu qua `widgetInputSchema` nên mẫu sai sẽ vỡ test.
 */
export interface DashboardTemplateWidget {
  type: DashboardWidgetType;
  title: string;
  /** Cấu hình KHÔNG gồm `projectId`: ô BURNDOWN/VELOCITY được gắn dự án của phạm vi lúc tạo, các ô khác kế thừa phạm vi. */
  config: Record<string, unknown>;
  /** Độ rộng 1–3 cột. */
  w: 1 | 2 | 3;
  /** Chỉ đưa ô vào khi phạm vi dữ liệu nằm trong danh sách này (mặc định: mọi phạm vi). */
  onlyScopes?: readonly DashboardDataScopeValue[];
}

export interface DashboardTemplate {
  key: string;
  name: string;
  /** Một câu: mẫu này dành cho ai / để làm gì. */
  description: string;
  /** Phạm vi dữ liệu mà mẫu hỗ trợ (đã xét ô nào áp dụng được). */
  scopes: readonly DashboardDataScopeValue[];
  /** Phạm vi gợi ý chọn sẵn. */
  defaultScope: DashboardDataScopeValue;
  widgets: readonly DashboardTemplateWidget[];
}

const ALL: readonly DashboardDataScopeValue[] = ['PROJECT', 'GROUP', 'ORG'];
const ONE_PROJECT: readonly DashboardDataScopeValue[] = ['PROJECT'];

export const DASHBOARD_TEMPLATES: readonly DashboardTemplate[] = [
  {
    key: 'project-overview',
    name: 'Tổng quan dự án',
    description:
      'Cho quản lý dự án: tiến độ, việc quá hạn, tốc độ làm việc và ai đang gánh nhiều việc.',
    scopes: ALL,
    defaultScope: 'PROJECT',
    widgets: [
      { type: 'STAT_NUMBER', title: 'Việc đang mở', config: { metric: 'open' }, w: 1 },
      { type: 'STAT_NUMBER', title: 'Quá hạn', config: { metric: 'overdue' }, w: 1 },
      { type: 'STAT_NUMBER', title: 'Xong 14 ngày qua', config: { metric: 'done14' }, w: 1 },
      { type: 'BURNDOWN', title: 'Burndown sprint', config: {}, w: 2, onlyScopes: ONE_PROJECT },
      {
        type: 'VELOCITY',
        title: 'Điểm hoàn thành mỗi tuần',
        config: {},
        w: 1,
        onlyScopes: ONE_PROJECT,
      },
      { type: 'CREATED_VS_RESOLVED', title: 'Tạo mới và đã xử lý', config: {}, w: 2 },
      { type: 'PIE_BY_FIELD', title: 'Phân bố theo trạng thái', config: { field: 'status' }, w: 1 },
      {
        type: 'PIE_BY_FIELD',
        title: 'Việc theo người phụ trách',
        config: { field: 'assignee' },
        w: 1,
      },
    ],
  },
  {
    key: 'qa',
    name: 'Kiểm thử',
    description: 'Cho tester: bug chờ kiểm thử lại, bug còn mở, tỉ lệ mở lại và mức nghiêm trọng.',
    scopes: ALL,
    defaultScope: 'PROJECT',
    widgets: [
      {
        // Không gọi tên trạng thái (quy trình mỗi tổ chức một khác — tên không có thì máy chủ báo 422): lấy nhóm "đang làm",
        // nơi bug chờ sửa / chờ kiểm thử lại đứng.
        type: 'ISSUE_LIST',
        title: 'Bug đang xử lý hoặc chờ kiểm thử lại',
        config: {
          jql: 'type = Bug AND statusCategory = IN_PROGRESS ORDER BY updated DESC',
          limit: 10,
        },
        w: 2,
      },
      { type: 'STAT_NUMBER', title: 'Bug', config: { metric: 'bugs' }, w: 1 },
      { type: 'STAT_NUMBER', title: 'Tỉ lệ mở lại', config: { metric: 'reopenRate' }, w: 1 },
      {
        type: 'PIE_BY_FIELD',
        title: 'Bug mở theo mức nghiêm trọng',
        config: { field: 'severity' },
        w: 1,
      },
      {
        type: 'ISSUE_LIST',
        title: 'Bug chưa xử lý',
        config: { jql: 'type = Bug AND statusCategory = TODO ORDER BY updated DESC', limit: 10 },
        w: 2,
      },
      { type: 'CREATED_VS_RESOLVED', title: 'Tạo mới và đã xử lý', config: {}, w: 2 },
    ],
  },
  {
    key: 'developer',
    name: 'Lập trình viên',
    description:
      'Cho lập trình viên: việc của tôi, việc đang làm, việc đến hạn trong 7 ngày tới và việc tôi vừa xong.',
    scopes: ALL,
    defaultScope: 'PROJECT',
    widgets: [
      {
        type: 'ISSUE_LIST',
        title: 'Việc của tôi',
        config: {
          jql: 'assignee = currentUser() AND statusCategory != DONE ORDER BY updated DESC',
          limit: 10,
        },
        w: 2,
      },
      {
        type: 'ISSUE_LIST',
        title: 'Đang làm',
        config: {
          jql: 'assignee = currentUser() AND statusCategory = IN_PROGRESS ORDER BY updated DESC',
          limit: 10,
        },
        w: 1,
      },
      {
        type: 'ISSUE_LIST',
        title: 'Đến hạn trong 7 ngày tới',
        config: {
          jql: 'assignee = currentUser() AND statusCategory != DONE AND due >= startOfDay() AND due <= 7d ORDER BY due ASC',
          limit: 10,
        },
        w: 2,
      },
      {
        type: 'ISSUE_LIST',
        title: 'Tôi vừa xong',
        config: {
          jql: 'assignee = currentUser() AND statusCategory = DONE AND updated >= -14d ORDER BY updated DESC',
          limit: 10,
        },
        w: 1,
      },
    ],
  },
  {
    key: 'org-manager',
    name: 'Quản lý tổ chức',
    description:
      'Cho người quản lý nhiều dự án: số việc mở và quá hạn, rủi ro lớn nhất, mục tiêu chậm, người quá tải.',
    scopes: ['GROUP', 'ORG'],
    defaultScope: 'GROUP',
    widgets: [
      { type: 'STAT_NUMBER', title: 'Dự án', config: { metric: 'projects' }, w: 1 },
      { type: 'STAT_NUMBER', title: 'Việc đang mở', config: { metric: 'open' }, w: 1 },
      { type: 'STAT_NUMBER', title: 'Quá hạn', config: { metric: 'overdue' }, w: 1 },
      { type: 'TOP_RISKS', title: 'Rủi ro lớn nhất', config: {}, w: 2 },
      { type: 'SLOW_GOALS', title: 'Mục tiêu chậm', config: {}, w: 1 },
      // Thẻ nhân lực đo người trên MỌI dự án nên không thu hẹp theo nhóm dự án được — chỉ có ở phạm vi toàn tổ chức.
      { type: 'OVERLOAD', title: 'Người quá tải', config: {}, w: 1, onlyScopes: ['ORG'] },
      { type: 'CREATED_VS_RESOLVED', title: 'Tạo mới và đã xử lý theo tuần', config: {}, w: 2 },
      { type: 'PIE_BY_FIELD', title: 'Phân bố theo trạng thái', config: { field: 'status' }, w: 1 },
    ],
  },
  {
    key: 'blank',
    name: 'Trống',
    description: 'Bắt đầu từ trang trắng rồi tự thêm ô.',
    scopes: ALL,
    defaultScope: 'PROJECT',
    widgets: [],
  },
];

export function findDashboardTemplate(key: string): DashboardTemplate | undefined {
  return DASHBOARD_TEMPLATES.find((t) => t.key === key);
}

/** Các ô của mẫu áp dụng được cho phạm vi này (ô `onlyScopes` không chứa phạm vi bị bỏ). */
export function templateWidgetsFor(
  template: DashboardTemplate,
  dataScope: DashboardDataScopeValue,
): DashboardTemplateWidget[] {
  return template.widgets.filter((w) => !w.onlyScopes || w.onlyScopes.includes(dataScope));
}

/**
 * Dựng danh sách ô sẽ lưu cho phạm vi đã chọn. BURNDOWN/VELOCITY bắt buộc có dự án nên được gắn thẳng `scopeProjectId`
 * (phạm vi "một dự án") — chúng thuộc nhóm "ô tự đặt dự án": đổi phạm vi dashboard sau đó không đổi dự án của hai ô này.
 */
export function buildTemplateWidgets(
  template: DashboardTemplate,
  dataScope: DashboardDataScopeValue,
  scopeProjectId?: string,
): Array<Pick<WidgetInput, 'type' | 'title' | 'config' | 'position'>> {
  return templateWidgetsFor(template, dataScope)
    .slice(0, DASHBOARD_LIMITS.widgetsPerDashboard)
    .map((w, order) => ({
      type: w.type,
      title: w.title,
      config:
        (w.type === 'BURNDOWN' || w.type === 'VELOCITY') && scopeProjectId
          ? { ...w.config, projectId: scopeProjectId }
          : { ...w.config },
      position: { order, w: w.w },
    }));
}

const ORDER_BY = /(?:^|\s+)order\s+by\s+/i;

/**
 * Gắn điều kiện dự án vào JQL của ô danh sách kế thừa phạm vi: `project IN ("A","B") AND (<điều kiện>) ORDER BY …`.
 * Không có dự án nào (người xem không thấy dự án nào trong phạm vi) → `null`: ô phải hiện trống, KHÔNG được chạy JQL không giới hạn.
 */
export function scopeJql(jql: string, projectKeys: readonly string[]): string | null {
  if (projectKeys.length === 0) return null;
  const list = projectKeys.map((k) => `"${k.replace(/"/g, '')}"`).join(', ');
  const parts = jql.trim().split(ORDER_BY);
  const where = (parts[0] ?? '').trim();
  const order = parts.length > 1 ? ` ORDER BY ${parts.slice(1).join(' ORDER BY ').trim()}` : '';
  return `project IN (${list})${where ? ` AND (${where})` : ''}${order}`;
}
