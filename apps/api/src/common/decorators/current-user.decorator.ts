import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser, AuthedRequest } from '../types/request';

/** Lấy user đã xác thực từ request. `@CurrentUser()` hoặc `@CurrentUser('id')`. */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user = req.user;
    return data && user ? user[data] : user;
  },
);
