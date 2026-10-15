import { SYSTEM_ROLES } from './permissions';

/**
 * Tên vai trò hệ thống được lưu trong CSDL bằng tiếng Anh (`Workspace Admin`,
 * `Project Developer`…) để mã nguồn, API và seed dùng chung một khoá. Bảng này chỉ
 * đổi CHỮ HIỂN THỊ sang tiếng Việt — không đổi dữ liệu.
 *
 * Vai trò do người dùng tự đặt không có trong bảng: giữ nguyên tên họ đã nhập.
 */
const ROLE_LABELS: Record<string, string> = {
  [SYSTEM_ROLES.WORKSPACE_ADMIN]: 'Quản trị chung',
  [SYSTEM_ROLES.WORKSPACE_MEMBER]: 'Thành viên',
  [SYSTEM_ROLES.WORKSPACE_VIEWER]: 'Người xem',
  [SYSTEM_ROLES.PROJECT_ADMIN]: 'Quản trị dự án',
  [SYSTEM_ROLES.PROJECT_DEVELOPER]: 'Lập trình viên',
  [SYSTEM_ROLES.PROJECT_REPORTER]: 'Người báo lỗi',
  [SYSTEM_ROLES.BUSINESS_ANALYST]: 'Phân tích nghiệp vụ',
  [SYSTEM_ROLES.PRODUCT_OWNER]: 'Chủ sản phẩm',
  [SYSTEM_ROLES.SCRUM_MASTER]: 'Điều phối Scrum',
  [SYSTEM_ROLES.DEVELOPER]: 'Lập trình viên',
  [SYSTEM_ROLES.TESTER]: 'Kiểm thử',
  [SYSTEM_ROLES.DESIGNER]: 'Thiết kế',
  [SYSTEM_ROLES.DEVOPS]: 'Vận hành hệ thống',
  [SYSTEM_ROLES.REVIEWER]: 'Người duyệt',
  [SYSTEM_ROLES.STAKEHOLDER]: 'Bên liên quan',
};

/** Tên vai trò để hiển thị (web + nhật ký quản trị). Vai trò tự đặt → trả lại đúng tên đã nhập. */
export function roleLabel(name: string): string {
  return ROLE_LABELS[name] ?? name;
}
