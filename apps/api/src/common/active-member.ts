import { SYSTEM_USER_EMAIL } from '../modules/automation/rule-engine.service';

/**
 * Điều kiện đếm thành viên "đang hoạt động" của một không gian làm việc: bỏ tài khoản bị vô hiệu hoá và user hệ
 * thống (automation). Dùng chung cho bộ chọn không gian (`AuthService.listWorkspaces`) và bảng quản trị
 * (`AdminWorkspacesService`) để hai nơi luôn cùng một con số.
 * Vị từ SYSTEM_USER_EMAIL là lưới an toàn: user hệ thống không bao giờ có membership (`addWorkspace` chặn).
 */
export const ACTIVE_MEMBERSHIP_COUNT = {
  where: { user: { status: { not: 'DEACTIVATED' }, email: { not: SYSTEM_USER_EMAIL } } },
} as const;
