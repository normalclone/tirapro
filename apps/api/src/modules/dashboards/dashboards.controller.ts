import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  dashboardFromTemplateSchema,
  dashboardInputSchema,
  dashboardUpdateSchema,
  type DashboardFromTemplateInput,
  type DashboardInput,
  type DashboardUpdateInput,
} from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { DashboardsService } from './dashboards.service';

/** DASHBOARD TUỲ BIẾN — đọc: organization:view (kết quả đã lọc theo quyền xem), ghi: dashboard:manage. */
@ApiTags('dashboards')
@Controller('dashboards')
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get()
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async list(@OrganizationId() organizationId: string, @CurrentUser() user: AuthUser) {
    return this.dashboards.list(organizationId, user.id);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async get(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.dashboards.get(organizationId, id, user.id);
  }

  /** Tạo từ mẫu: phạm vi dữ liệu bắt buộc chọn rõ (ORG chỉ admin tổ chức). Khai báo trước các route `:id`. */
  @Post('from-template')
  @Permissions(PERMISSIONS.DASHBOARD_MANAGE)
  async createFromTemplate(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(dashboardFromTemplateSchema)) dto: DashboardFromTemplateInput,
  ) {
    return this.dashboards.createFromTemplate(organizationId, user.id, dto);
  }

  @Post()
  @Permissions(PERMISSIONS.DASHBOARD_MANAGE)
  async create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(dashboardInputSchema)) dto: DashboardInput,
  ) {
    return this.dashboards.create(organizationId, user.id, dto);
  }

  @Put(':id')
  @Permissions(PERMISSIONS.DASHBOARD_MANAGE)
  async update(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(dashboardUpdateSchema)) dto: DashboardUpdateInput,
  ) {
    return this.dashboards.update(organizationId, id, user.id, dto);
  }

  @Post(':id/duplicate')
  @Permissions(PERMISSIONS.DASHBOARD_MANAGE)
  async duplicate(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.dashboards.duplicate(organizationId, id, user.id);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.DASHBOARD_MANAGE)
  async remove(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.dashboards.remove(organizationId, id, user.id);
  }
}

/** Thư viện mẫu dashboard (mã cứng trong @tirapro/shared) + việc người gọi có chọn được phạm vi toàn tổ chức không. */
@ApiTags('dashboards')
@Controller('dashboard-templates')
export class DashboardTemplatesController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get()
  @Permissions(PERMISSIONS.DASHBOARD_MANAGE)
  async list(@OrganizationId() organizationId: string, @CurrentUser() user: AuthUser) {
    return this.dashboards.listTemplates(organizationId, user.id);
  }
}
