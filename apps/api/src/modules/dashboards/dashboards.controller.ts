import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  dashboardInputSchema,
  dashboardUpdateSchema,
  type DashboardInput,
  type DashboardUpdateInput,
} from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { DashboardsService } from './dashboards.service';

/** DASHBOARD TUỲ BIẾN — đọc: workspace:view (kết quả đã lọc theo quyền xem), ghi: dashboard:manage. */
@ApiTags('dashboards')
@Controller('dashboards')
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get()
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async list(@WorkspaceId() workspaceId: string, @CurrentUser() user: AuthUser) {
    return this.dashboards.list(workspaceId, user.id);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async get(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.dashboards.get(workspaceId, id, user.id);
  }

  @Post()
  @Permissions(PERMISSIONS.DASHBOARD_MANAGE)
  async create(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(dashboardInputSchema)) dto: DashboardInput,
  ) {
    return this.dashboards.create(workspaceId, user.id, dto);
  }

  @Put(':id')
  @Permissions(PERMISSIONS.DASHBOARD_MANAGE)
  async update(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(dashboardUpdateSchema)) dto: DashboardUpdateInput,
  ) {
    return this.dashboards.update(workspaceId, id, user.id, dto);
  }

  @Post(':id/duplicate')
  @Permissions(PERMISSIONS.DASHBOARD_MANAGE)
  async duplicate(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.dashboards.duplicate(workspaceId, id, user.id);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.DASHBOARD_MANAGE)
  async remove(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.dashboards.remove(workspaceId, id, user.id);
  }
}
