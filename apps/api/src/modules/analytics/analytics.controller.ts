import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ForbiddenAppException, BusinessRuleException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { AnalyticsService } from './analytics.service';

@ApiTags('reports')
@Controller('reports')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  /** Tổng hợp toàn workspace cho Tổng quan của admin (mọi dự án). */
  @Get('overview')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async overview(@CurrentUser() user: AuthUser) {
    return this.analytics.workspaceOverview(this.ws(user));
  }

  /** Báo cáo tổng hợp một dự án (phân bố trạng thái/loại/ưu tiên/người phụ trách). */
  @Get('project')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async projectReport(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) {
    if (!projectId) throw new BusinessRuleException('Thiếu projectId');
    return this.analytics.projectReport(this.ws(user), projectId);
  }

  @Get('burndown')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async burndown(@CurrentUser() user: AuthUser, @Query('sprintId') sprintId?: string) {
    if (!sprintId) throw new BusinessRuleException('Thiếu sprintId');
    return this.analytics.burndown(this.ws(user), sprintId);
  }

  @Get('velocity')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async velocity(
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
    @Query('limit') limit?: string,
  ) {
    if (!projectId) throw new BusinessRuleException('Thiếu projectId');
    return this.analytics.velocity(this.ws(user), projectId, Number(limit) || 8);
  }

  @Get('cfd')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async cfd(
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!projectId) throw new BusinessRuleException('Thiếu projectId');
    return this.analytics.cfd(this.ws(user), projectId, from, to);
  }

  @Get('created-resolved')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async createdResolved(
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!projectId) throw new BusinessRuleException('Thiếu projectId');
    return this.analytics.createdResolved(this.ws(user), projectId, from, to);
  }
}
