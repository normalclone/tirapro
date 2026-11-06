import { PERMISSION_CATALOG, type PermissionKey } from '@tirapro/types';

/** Quyền CẤP DỰ ÁN trong catalog — vai trò riêng của dự án chỉ chứa các quyền này (máy chủ cũng kiểm). */
export const PROJECT_ROLE_PERMISSIONS = PERMISSION_CATALOG.filter((p) => p.scope === 'PROJECT');

export type RoleCreateMode = 'template' | 'custom';

export interface RoleFormState {
  mode: RoleCreateMode;
  name: string;
  templateId: string;
  perms: ReadonlySet<PermissionKey>;
}

/**
 * Nút Tạo bật khi: "từ mẫu" → đã chọn mẫu (tên để trống = lấy tên mẫu); "tự chọn" → có tên và ≥ 1 quyền.
 * Trùng tên trong dự án do máy chủ báo (422) — không đoán ở đây.
 */
export function canCreateProjectRole(s: RoleFormState): boolean {
  if (s.mode === 'template') return s.templateId.length > 0;
  return s.name.trim().length > 0 && s.perms.size > 0;
}

/** Thân POST /projects/:id/roles theo chế độ; "từ mẫu" chỉ gửi tên khi người dùng đã nhập (không thì lấy tên mẫu). */
export function createProjectRoleBody(s: RoleFormState) {
  if (s.mode === 'template') {
    const name = s.name.trim();
    return { fromTemplateId: s.templateId, ...(name ? { name } : {}) };
  }
  return { name: s.name.trim(), permissionKeys: [...s.perms] };
}

/** Tên gợi ý khi chọn mẫu: chính tên mẫu (người dùng sửa được). */
export const suggestedRoleName = (templateName: string) => templateName;

/** Dòng mô tả số người dùng vai trò, dùng cho hàng danh sách và hộp xác nhận xoá. */
export function roleUsageText(memberCount: number): string {
  return memberCount > 0 ? `${memberCount} người đang dùng` : 'Chưa ai dùng';
}
