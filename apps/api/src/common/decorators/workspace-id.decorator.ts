import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import { ForbiddenAppException } from '../exceptions/app.exception';
import type { AuthedRequest } from '../types/request';

/** Thông báo khi người dùng chưa có workspace hiện tại. */
const NO_WORKSPACE_MESSAGE = 'Bạn chưa chọn tổ chức — hãy chọn một tổ chức rồi thử lại';

/** Lấy `workspaceId` của user đã xác thực; chưa chọn workspace thì từ chối 403. */
export const WorkspaceId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const workspaceId = ctx.switchToHttp().getRequest<AuthedRequest>().user?.workspaceId;
  if (!workspaceId) throw new ForbiddenAppException(NO_WORKSPACE_MESSAGE);
  return workspaceId;
});
