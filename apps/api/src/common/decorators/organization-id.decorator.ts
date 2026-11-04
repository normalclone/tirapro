import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import { ForbiddenAppException } from '../exceptions/app.exception';
import type { AuthedRequest } from '../types/request';

/** Thông báo khi người dùng chưa có tổ chức hiện tại. */
const NO_ORGANIZATION_MESSAGE = 'Bạn chưa chọn tổ chức — hãy chọn một tổ chức rồi thử lại';

/** Lấy `organizationId` của user đã xác thực; chưa chọn tổ chức thì từ chối 403. */
export const OrganizationId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const organizationId = ctx.switchToHttp().getRequest<AuthedRequest>().user?.organizationId;
    if (!organizationId) throw new ForbiddenAppException(NO_ORGANIZATION_MESSAGE);
    return organizationId;
  },
);
