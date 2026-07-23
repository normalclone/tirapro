import type { Request } from 'express';
import type { PermissionKey } from '@tirapro/types';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  workspaceId: string | null;
  isSystemAdmin: boolean;
  /** Quyền hiệu lực trong workspace hiện tại (PermissionsGuard nạp). */
  permissions?: PermissionKey[];
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
  id: string;
}
