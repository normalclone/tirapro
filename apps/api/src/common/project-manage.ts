import { PERMISSIONS, type PermissionKey } from '@tirapro/types';
import type { RbacService } from '../modules/rbac/rbac.service';
import { ForbiddenAppException } from './exceptions/app.exception';

/**
 * Người dùng có quản lý được mục tiêu / rủi ro / chính sách thời gian xử lý ở dự án `projectId` không: có quyền CẤP TỔ
 * CHỨC tương ứng (`goal:manage` / `risk:manage` / `sla:manage`) HOẶC là quản trị CHÍNH dự án đó (`project:admin`).
 * Quản trị chung / quản trị hệ thống (`projectVisibilityMode = all`) luôn được. Dùng cho việc guard KHÔNG kiểm được: chuyển
 * một mục sang dự án KHÁC (guard chỉ tính quyền ở dự án hiện tại của mục) — luôn kiểm quyền Ở ĐÍCH.
 */
export async function canManageInProject(
  rbac: Pick<RbacService, 'getEffectivePermissions' | 'projectVisibilityMode'>,
  userId: string,
  workspaceId: string,
  projectId: string,
  orgPerm: PermissionKey,
): Promise<boolean> {
  if ((await rbac.projectVisibilityMode(userId, workspaceId)) === 'all') return true;
  const perms = await rbac.getEffectivePermissions(userId, workspaceId, projectId);
  return perms.has(orgPerm) || perms.has(PERMISSIONS.PROJECT_ADMIN);
}

/** Như `canManageInProject` nhưng ném 403 kèm cách sửa. */
export async function assertCanManageInProject(
  rbac: Pick<RbacService, 'getEffectivePermissions' | 'projectVisibilityMode'>,
  userId: string,
  workspaceId: string,
  projectId: string,
  orgPerm: PermissionKey,
  what: string,
): Promise<void> {
  if (await canManageInProject(rbac, userId, workspaceId, projectId, orgPerm)) return;
  throw new ForbiddenAppException(
    `Bạn không có quyền quản lý ${what} ở dự án đích — hãy nhờ quản trị dự án đó cấp quyền hoặc chọn dự án khác`,
  );
}
