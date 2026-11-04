/** Khoá mẫu "Trống" (khớp `packages/shared/src/dashboard-templates.ts`). */
export const BLANK_TEMPLATE_KEY = 'blank';

/**
 * Mẫu Trống không cần phạm vi để tạo: chưa chọn đích (hoặc người dùng không có dự án/nhóm nào) thì vẫn tạo được — như bảng
 * tổng quan cũ. Mẫu khác luôn cần phạm vi rõ ràng.
 */
export function blankNeedsNoScope(templateKey: string, scopeIssue: string | null): boolean {
  return templateKey === BLANK_TEMPLATE_KEY && scopeIssue !== null;
}

/** Sau khi tạo: bảng Trống mở thẳng trình soạn để thêm ô; mẫu khác về màn xem (đã có sẵn ô). */
export function landingUrl(templateKey: string, dashboardId: string): string {
  return templateKey === BLANK_TEMPLATE_KEY
    ? `/dashboards/${dashboardId}?edit=1`
    : `/dashboards/${dashboardId}`;
}
