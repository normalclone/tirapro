import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import type { AuthUser } from '../../common/types/request';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import { AnalyticsService } from './analytics.service';
import { LeadershipService } from './leadership.service';
import { QaReportService } from './qa-report.service';

@ApiTags('reports')
@Controller('reports')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly qaReport: QaReportService,
    private readonly leadership: LeadershipService,
  ) {}

  /** Tổng hợp toàn tổ chức cho Tổng quan — chỉ gồm dự án người xem được thấy (dự án riêng tư chỉ cho thành viên/admin). */
  @Get('overview')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async overview(@OrganizationId() organizationId: string, @CurrentUser() user: AuthUser) {
    return this.analytics.organizationOverview(organizationId, user.id);
  }

  /** Ba thẻ lãnh đạo (Top rủi ro, OKR chậm, người quá tải) — organization-level như `overview`, lọc theo dự án người xem thấy. */
  @Get('leadership')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async leadershipOverview(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leadership.get(organizationId, user.id);
  }

  /** Báo cáo tổng hợp một dự án (phân bố trạng thái/loại/ưu tiên/người phụ trách). */
  @ProjectRef('query', 'projectId')
  @Get('project')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async projectReport(
    @OrganizationId() organizationId: string,
    @Query('projectId') projectId?: string,
  ) {
    if (!projectId) throw new BusinessRuleException('Thiếu projectId');
    return this.analytics.projectReport(organizationId, projectId);
  }

  /** projectId BẮT BUỘC: guard tính report:view theo dự án; service kiểm sprint thuộc đúng dự án đó. */
  @ProjectRef('query', 'projectId')
  @Get('burndown')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async burndown(
    @OrganizationId() organizationId: string,
    @Query('sprintId') sprintId?: string,
    @Query('projectId') projectId?: string,
  ) {
    if (!projectId) throw new BusinessRuleException('Thiếu projectId');
    if (!sprintId) throw new BusinessRuleException('Thiếu sprintId');
    return this.analytics.burndown(organizationId, projectId, sprintId);
  }

  /** Tổng kết một sprint (đã xong x/y điểm, việc chuyển tiếp, so velocity TB). Cùng khuôn quyền với burndown. */
  @ProjectRef('query', 'projectId')
  @Get('sprint-summary')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async sprintSummary(
    @OrganizationId() organizationId: string,
    @Query('sprintId') sprintId?: string,
    @Query('projectId') projectId?: string,
  ) {
    if (!projectId) throw new BusinessRuleException('Thiếu projectId');
    if (!sprintId) throw new BusinessRuleException('Thiếu sprintId');
    return this.analytics.sprintSummary(organizationId, projectId, sprintId);
  }

  @ProjectRef('query', 'projectId')
  @Get('velocity')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async velocity(
    @OrganizationId() organizationId: string,
    @Query('projectId') projectId?: string,
    @Query('limit') limit?: string,
  ) {
    if (!projectId) throw new BusinessRuleException('Thiếu projectId');
    return this.analytics.velocity(organizationId, projectId, Number(limit) || 8);
  }

  @ProjectRef('query', 'projectId')
  @Get('cfd')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async cfd(
    @OrganizationId() organizationId: string,
    @Query('projectId') projectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!projectId) throw new BusinessRuleException('Thiếu projectId');
    return this.analytics.cfd(organizationId, projectId, from, to);
  }

  @ProjectRef('query', 'projectId')
  @Get('created-resolved')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async createdResolved(
    @OrganizationId() organizationId: string,
    @Query('projectId') projectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!projectId) throw new BusinessRuleException('Thiếu projectId');
    return this.analytics.createdResolved(organizationId, projectId, from, to);
  }

  /** Báo cáo QA (chỉ bug): mở theo mức nghiêm trọng, tỷ lệ mở lại, thời gian đóng, theo phiên bản. Mặc định 30 ngày. */
  @ProjectRef('query', 'projectId')
  @Get('qa')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async qa(
    @OrganizationId() organizationId: string,
    @Query('projectId') projectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!projectId) throw new BusinessRuleException('Thiếu projectId');
    return this.qaReport.report(organizationId, projectId, from, to);
  }
}
