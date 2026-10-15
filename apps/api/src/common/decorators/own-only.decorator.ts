import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { PermissionKey } from '@tirapro/types';
import type { AuthedRequest } from '../types/request';

/**
 * `@OwnOnly(PERMISSIONS.ISSUE_EDIT)` → true khi user chỉ qua guard nhờ bản `:own` của quyền đó
 * (PermissionsGuard ghi `req.ownOnly`), nên service phải kiểm tài nguyên có phải của họ không.
 */
export const OwnOnly = createParamDecorator(
  (permission: PermissionKey, ctx: ExecutionContext): boolean => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    return req.ownOnly?.has(permission) ?? false;
  },
);
