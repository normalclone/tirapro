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
  /**
   * Quyền yêu cầu mà user CHỈ thoả bằng bản `:own` (vd chỉ có `issue:edit:own`, không có `issue:edit`).
   * PermissionsGuard ghi; service phải tự kiểm quyền sở hữu tài nguyên cho các quyền trong tập này.
   */
  ownOnly?: Set<PermissionKey>;
  id: string;
}
