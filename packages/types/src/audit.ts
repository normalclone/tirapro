/**
 * Nhật ký kiểm toán QUẢN TRỊ (ai làm gì với vai trò / thành viên / tích hợp / tài khoản).
 * Khác `ActivityLog` (hoạt động công việc). `action` lưu dạng chuỗi trong DB để thêm loại mới
 * không cần migration; kiểu `AuditAction` bảo vệ ở compile-time.
 */
export const AUDIT_ACTIONS = {
  ROLE_CREATED: 'role.created',
  ROLE_UPDATED: 'role.updated',
  ROLE_DELETED: 'role.deleted',
  MEMBER_ADDED: 'member.added',
  MEMBER_REMOVED: 'member.removed',
  MEMBER_ROLES_CHANGED: 'member.roles_changed',
  MEMBER_ACCOUNT_CREATED: 'member.account_created',
  PROJECT_MEMBER_ADDED: 'project_member.added',
  PROJECT_MEMBER_ROLES_CHANGED: 'project_member.roles_changed',
  PROJECT_MEMBER_REMOVED: 'project_member.removed',
  PROJECT_VISIBILITY_CHANGED: 'project.visibility_changed',
  ACCOUNT_CREATED: 'account.created',
  ACCOUNT_PERMISSIONS_CHANGED: 'account.permissions_changed',
  ACCOUNT_DEACTIVATED: 'account.deactivated',
  ACCOUNT_REACTIVATED: 'account.reactivated',
  ACCOUNT_PASSWORD_RESET: 'account.password_reset',
  ACCOUNT_SESSIONS_REVOKED: 'account.sessions_revoked',
  ACCOUNT_WORKSPACE_ADDED: 'account.workspace_added',
  INTEGRATION_CREATED: 'integration.created',
  INTEGRATION_DELETED: 'integration.deleted',
  INTEGRATION_CHANNEL_ADDED: 'integration.channel_added',
  INTEGRATION_CHANNEL_REMOVED: 'integration.channel_removed',
  INTEGRATION_CHANNELS_DISABLED: 'integration.channels_disabled',
  WIKI_PAGE_DELETED: 'wiki.page_deleted',
  WIKI_PAGE_RESTORED: 'wiki.page_restored',
  WIKI_VERSION_RESTORED: 'wiki.version_restored',
} as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Nhãn tiếng Việt cho UI (bộ lọc + dòng nhật ký). */
export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  'role.created': 'Tạo vai trò',
  'role.updated': 'Sửa vai trò',
  'role.deleted': 'Xoá vai trò',
  'member.added': 'Thêm thành viên',
  'member.removed': 'Gỡ thành viên',
  'member.roles_changed': 'Đổi vai trò thành viên',
  'member.account_created': 'Tạo tài khoản mới',
  'project_member.added': 'Thêm người vào dự án',
  'project_member.roles_changed': 'Đổi vai trò trong dự án',
  'project_member.removed': 'Gỡ vai trò riêng trong dự án',
  'project.visibility_changed': 'Đổi chế độ riêng tư dự án',
  'account.created': 'Tạo tài khoản (quản trị hệ thống)',
  'account.permissions_changed': 'Đổi quyền hệ thống của tài khoản',
  'account.deactivated': 'Khoá tài khoản',
  'account.reactivated': 'Mở khoá tài khoản',
  'account.password_reset': 'Đặt lại mật khẩu',
  'account.sessions_revoked': 'Thu hồi phiên đăng nhập',
  'account.workspace_added': 'Thêm tài khoản vào không gian làm việc',
  'integration.created': 'Tạo tích hợp',
  'integration.deleted': 'Xoá tích hợp',
  'integration.channel_added': 'Thêm kênh tích hợp',
  'integration.channel_removed': 'Gỡ kênh tích hợp',
  'integration.channels_disabled': 'Tắt kênh tích hợp (dự án chuyển riêng tư)',
  'wiki.page_deleted': 'Xoá trang wiki',
  'wiki.page_restored': 'Khôi phục trang wiki đã xoá',
  'wiki.version_restored': 'Khôi phục phiên bản trang wiki',
};

export interface AuditLogDto {
  id: string;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  /** Câu tiếng Việt dựng sẵn lúc ghi — trang xem không phải join nhiều bảng. */
  summary: string;
  meta: Record<string, unknown>;
  createdAt: string;
  actor: { id: string; displayName: string; avatarUrl: string | null } | null;
  workspace?: { id: string; name: string } | null;
}
