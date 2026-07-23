import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@tirapro/types';

export const PERMISSIONS_KEY = 'requiredPermissions';
/** Yêu cầu quyền (resource:action) cho route. PermissionsGuard kiểm tra. */
export const Permissions = (...perms: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, perms);
