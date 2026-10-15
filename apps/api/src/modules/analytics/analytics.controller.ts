import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import { AnalyticsService } from './analytics.service';

@ApiTags('reports')
@Controller('reports')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** Tổng hợp toàn workspace cho Tổng quan của admin (mọi dự án). */
  @Get('overview')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async overview(@WorkspaceId() workspaceId: string) {
    return this.analytics.workspaceOverview(workspaceId);
  }

  /** Báo cáo tổng hợp một dự án (phân bố trạng thái/loại/ưu tiên/người phụ trách). */
  @ProjectRef('query', 'projectId')
  @Get('project')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async projectReport(@WorkspaceId() workspaceId: string, @Query('projectId') projectId?: string) {
    if (!projectId) throw new BusinessRuleException('Thiếu projectId');
    return this.analytics.projectReport(workspaceId, projectId);
  }

  /** projectId BẮT BUỘC: guard tính report:view theo dự án; service kiểm sprint thuộc đúng dự án đó. */
  @ProjectRef('query', 'projectId')
  @Get('burndown')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async burndown(
    @WorkspaceId() workspaceId: string,
    @Query('sprintId') sprintId?: string,
    @Query('projectId') projectId?: string,
  ) {
    if (!projectId) throw new BusinessRuleException('Thiếu projectId');
    if (!sprintId) throw new BusinessRuleException('Thiếu sprintId');
    return this.analytics.burndown(workspaceId, projectId, sprintId);
  }

  /** Tổng kết một sprint (đã xong x/y điểm, việc chuyển tiếp, so velocity TB). Cùng khuôn quyền với burndown. */
  @ProjectRef('query', 'projectId')
  @Get('sprint-summary')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async sprintSummary(
    @WorkspaceId() workspaceId: string,
    @Query('sprintId') sprintId?: string,
    @Query('projectId') projectId?: string,
  ) {
    if (!projectId) throw new BusinessRuleException('Thiếu projectId');
    if (!sprintId) throw new BusinessRuleException('Thiếu sprintId');
    return this.analytics.sprintSummary(workspaceId, projectId, sprintId);
  }

  @ProjectRef('query', 'projectId')
  @Get('velocity')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async velocity(
    @WorkspaceId() workspaceId: string,
    @Query('projectId') projectId?: string,
    @Query('limit') limit?: string,
  ) {
    if (!projectId) throw new BusinessRuleException('Thiếu projectId');
    return this.analytics.velocity(workspaceId, projectId, Number(limit) || 8);
  }

  @ProjectRef('query', 'projectId')
  @Get('cfd')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async cfd(
    @WorkspaceId() workspaceId: string,
    @Query('projectId') projectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!projectId) throw new BusinessRuleException('Thiếu projectId');
    return this.analytics.cfd(workspaceId, projectId, from, to);
  }

  @ProjectRef('query', 'projectId')
  @Get('created-resolved')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async createdResolved(
    @WorkspaceId() workspaceId: string,
    @Query('projectId') projectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!projectId) throw new BusinessRuleException('Thiếu projectId');
    return this.analytics.createdResolved(workspaceId, projectId, from, to);
  }
}
