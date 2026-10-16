import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/request';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SlaService } from './sla.service';
import {
  createSlaPolicySchema,
  updateSlaPolicySchema,
  type CreateSlaPolicyInput,
  type UpdateSlaPolicyInput,
} from './sla.schemas';

@ApiTags('sla')
@Controller('sla')
export class SlaController {
  constructor(private readonly sla: SlaService) {}

  /** Chính sách SLA của workspace. */
  @Get('policies')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async list(@WorkspaceId() workspaceId: string, @CurrentUser() user: AuthUser) {
    return this.sla.list(workspaceId, user.id);
  }

  @Post('policies')
  @Permissions(PERMISSIONS.SLA_MANAGE)
  async create(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSlaPolicySchema)) dto: CreateSlaPolicyInput,
  ) {
    return this.sla.create(workspaceId, dto, user.id);
  }

  @Put('policies/:id')
  @Permissions(PERMISSIONS.SLA_MANAGE)
  async update(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSlaPolicySchema)) dto: UpdateSlaPolicyInput,
  ) {
    return this.sla.update(workspaceId, id, dto, user.id);
  }

  @Delete('policies/:id')
  @Permissions(PERMISSIONS.SLA_MANAGE)
  async remove(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.sla.remove(workspaceId, id, user.id);
  }

  /** Bảng theo dõi ticket đang chạy SLA (sắp trễ / đã vi phạm). */
  @Get('board')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async board(@WorkspaceId() workspaceId: string, @CurrentUser() user: AuthUser) {
    return this.sla.board(workspaceId, user.id);
  }

  /** Trạng thái SLA của 1 issue (hiển thị badge trên trang chi tiết). */
  @ProjectRef('issue', 'issueId')
  @Get('issue/:issueId')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async forIssue(@WorkspaceId() workspaceId: string, @Param('issueId') issueId: string) {
    return this.sla.getForIssue(workspaceId, issueId);
  }
}
