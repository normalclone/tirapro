import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { PermissionKey } from '@tirapro/types';
import type { AuthedRequest } from '../types/request';

/** Factory của `@OwnOnly` — export để spec phản chiếu (own-only-coverage.spec.ts) nhận diện được tham số. */
export const ownOnlyFactory = (permission: PermissionKey, ctx: ExecutionContext): boolean => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.ownOnly?.has(permission) ?? false;
};

/**
 * `@OwnOnly(PERMISSIONS.ISSUE_EDIT)` → true khi user chỉ qua guard nhờ bản `:own` của quyền đó
 * (PermissionsGuard ghi `req.ownOnly`), nên handler/service phải kiểm tài nguyên có phải của họ không
 * (xem `IssueOwnershipService`).
 */
export const OwnOnly = createParamDecorator(ownOnlyFactory);
