import {
  templateWidgetsFor,
  type DashboardDataScopeValue,
  type DashboardTemplate,
  type DashboardWidgetType,
} from '@tirapro/shared';

export interface PreviewBlock {
  key: string;
  type: DashboardWidgetType;
  title: string;
  /** Số cột chiếm (1–3). */
  w: 1 | 2 | 3;
  /** Chiều cao tương đối (số hàng lưới): chỉ số thấp, biểu đồ/danh sách cao hơn. */
  rows: 1 | 2;
}

const TALL: ReadonlySet<DashboardWidgetType> = new Set([
  'PIE_BY_FIELD',
  'ISSUE_LIST',
  'BURNDOWN',
  'VELOCITY',
  'CREATED_VS_RESOLVED',
  'TOP_RISKS',
  'SLOW_GOALS',
  'OVERLOAD',
]);

/** Sơ đồ khối xem trước của mẫu cho phạm vi đã chọn (đúng các ô sẽ được tạo, đúng cỡ cột). */
export function previewBlocks(
  template: DashboardTemplate,
  scope: DashboardDataScopeValue,
): PreviewBlock[] {
  return templateWidgetsFor(template, scope).map((w, i) => ({
    key: `${i}-${w.type}`,
    type: w.type,
    title: w.title,
    w: w.w,
    rows: TALL.has(w.type) ? 2 : 1,
  }));
}
