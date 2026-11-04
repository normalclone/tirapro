import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@tirapro/types';

export const PERMISSIONS_KEY = 'requiredPermissions';
/** Yêu cầu quyền (resource:action) cho route. PermissionsGuard kiểm tra. */
export const Permissions = (...perms: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, perms);

export const PERMISSIONS_ANY_KEY = 'requiredAnyPermissions';
/**
 * Đạt khi người gọi có ÍT NHẤT MỘT trong các quyền (tính theo dự án của route: `@ProjectRef` hoặc `body.projectId`). Dùng khi
 * một việc cho phép quyền cấp tổ chức HOẶC quyền quản trị CHÍNH dự án đó (vd mục tiêu: `goal:manage` hoặc `project:admin`).
 * Có thể đi kèm `@Permissions(...)` — khi đó phải đạt cả hai điều kiện.
 */
export const PermissionsAnyOf = (...perms: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_ANY_KEY, perms);
