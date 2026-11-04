import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/request';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { Permissions, PermissionsAnyOf } from '../../common/decorators/permissions.decorator';
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

  /** Chính sách SLA (luôn thuộc một dự án); `?projectId=` thu hẹp theo một dự án. */
  @Get('policies')
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async list(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
  ) {
    return this.sla.list(organizationId, user.id, projectId || undefined);
  }

  @Post('policies')
  @PermissionsAnyOf(PERMISSIONS.SLA_MANAGE, PERMISSIONS.PROJECT_ADMIN)
  async create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSlaPolicySchema)) dto: CreateSlaPolicyInput,
  ) {
    return this.sla.create(organizationId, dto, user.id);
  }

  @Put('policies/:id')
  @ProjectRef('slaPolicy', 'id')
  @PermissionsAnyOf(PERMISSIONS.SLA_MANAGE, PERMISSIONS.PROJECT_ADMIN)
  async update(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSlaPolicySchema)) dto: UpdateSlaPolicyInput,
  ) {
    return this.sla.update(organizationId, id, dto, user.id);
  }

  @Delete('policies/:id')
  @ProjectRef('slaPolicy', 'id')
  @PermissionsAnyOf(PERMISSIONS.SLA_MANAGE, PERMISSIONS.PROJECT_ADMIN)
  async remove(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.sla.remove(organizationId, id, user.id);
  }

  /** Bảng theo dõi ticket đang chạy SLA (sắp trễ / đã vi phạm); `?projectId=` thu hẹp theo một dự án. */
  @Get('board')
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async board(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
  ) {
    return this.sla.board(organizationId, user.id, projectId || undefined);
  }

  /** Trạng thái SLA của 1 issue (hiển thị badge trên trang chi tiết). */
  @ProjectRef('issue', 'issueId')
  @Get('issue/:issueId')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async forIssue(@OrganizationId() organizationId: string, @Param('issueId') issueId: string) {
    return this.sla.getForIssue(organizationId, issueId);
  }
}
