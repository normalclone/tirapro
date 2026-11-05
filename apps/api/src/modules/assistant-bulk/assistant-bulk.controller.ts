import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AssistantBulkAssignResult, AssistantBulkMembersResult } from '@tirapro/types';
import { AuthOnly } from '../../common/decorators/auth-only.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { AssistantBulkService } from './assistant-bulk.service';
import {
  assistantBulkAssignSchema,
  assistantBulkMembersSchema,
  type AssistantBulkAssignBody,
  type AssistantBulkMembersBody,
} from './assistant-bulk.schemas';

/**
 * Thực hiện lệnh hàng loạt của Trợ lý SAU khi người dùng đã bấm Xác nhận trên thẻ xem trước. Cố ý KHÔNG gắn `@Permissions`
 * ở cấp route: dòng thuộc nhiều dự án nên quyền được kiểm TỪNG DÒNG, từng dự án, trong service (không tin web).
 */
@ApiTags('assistant-bulk')
@Controller('assistant/bulk')
export class AssistantBulkController {
  constructor(private readonly bulk: AssistantBulkService) {}

  // AuthOnly có chủ đích: quyền phụ thuộc TỪNG DÒNG/DỰ ÁN nên được kiểm trong service (không có quyền chung ở cấp route).
  @AuthOnly()
  @Post('assign')
  assign(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(assistantBulkAssignSchema)) dto: AssistantBulkAssignBody,
  ): Promise<AssistantBulkAssignResult> {
    return this.bulk.assign(organizationId, user, dto.rows);
  }

  @AuthOnly()
  @Post('members')
  members(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(assistantBulkMembersSchema)) dto: AssistantBulkMembersBody,
  ): Promise<AssistantBulkMembersResult> {
    return this.bulk.setMembers(organizationId, user, dto.rows);
  }
}
