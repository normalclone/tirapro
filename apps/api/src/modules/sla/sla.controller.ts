import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { SlaService } from './sla.service';
import { createSlaPolicySchema, updateSlaPolicySchema, type CreateSlaPolicyInput, type UpdateSlaPolicyInput } from './sla.schemas';

@ApiTags('sla')
@Controller('sla')
export class SlaController {
  constructor(private readonly sla: SlaService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  /** Chính sách SLA của workspace. */
  @Get('policies')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async list(@CurrentUser() user: AuthUser) {
    return this.sla.list(this.ws(user));
  }

  @Post('policies')
  @Permissions(PERMISSIONS.SLA_MANAGE)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSlaPolicySchema)) dto: CreateSlaPolicyInput,
  ) {
    return this.sla.create(this.ws(user), dto);
  }

  @Put('policies/:id')
  @Permissions(PERMISSIONS.SLA_MANAGE)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSlaPolicySchema)) dto: UpdateSlaPolicyInput,
  ) {
    return this.sla.update(this.ws(user), id, dto);
  }

  @Delete('policies/:id')
  @Permissions(PERMISSIONS.SLA_MANAGE)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sla.remove(this.ws(user), id);
  }

  /** Bảng theo dõi ticket đang chạy SLA (sắp trễ / đã vi phạm). */
  @Get('board')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async board(@CurrentUser() user: AuthUser) {
    return this.sla.board(this.ws(user));
  }

  /** Trạng thái SLA của 1 issue (hiển thị badge trên trang chi tiết). */
  @Get('issue/:issueId')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async forIssue(@CurrentUser() user: AuthUser, @Param('issueId') issueId: string) {
    return this.sla.getForIssue(this.ws(user), issueId);
  }
}
