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

/** Trần số dự án trong một yêu cầu phạm vi nhóm (nhóm dự án thật hiếm khi tới mức này; chặn URL/IN quá dài). */
const MAX_SCOPE_PROJECTS = 200;

/**
 * `?projectIds=a,b,c` → danh sách id; vắng mặt → `undefined` (không thu hẹp); chuỗi rỗng → `[]` (phạm vi RỖNG, không phải
 * "tất cả" — nhóm không còn dự án nào người xem thấy thì ô phải trống).
 */
function parseProjectIds(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  // `?projectIds=a&projectIds=b` (hoặc `projectIds[]=`) đến dưới dạng mảng — gộp lại như CSV thay vì để `split` ném lỗi (500).
  const parts = Array.isArray(raw) ? raw : [raw];
  if (!parts.every((p): p is string => typeof p === 'string')) {
    throw new BusinessRuleException('projectIds không hợp lệ');
  }
  const ids = [
    ...new Set(
      parts
        .join(',')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length > MAX_SCOPE_PROJECTS) {
    throw new BusinessRuleException(`Tối đa ${MAX_SCOPE_PROJECTS} dự án trong một phạm vi`);
  }
  return ids;
}

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
  async overview(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    /** CSV id dự án (phạm vi nhóm dự án của dashboard): luôn giao với dự án người xem thấy ở máy chủ. */
    @Query('projectIds') projectIds?: string | string[],
    /** `1`/`true` = kèm `byAssignee` (việc chưa xong theo người) — chỉ ô "theo người" cần, Tổng quan chính không. */
    @Query('byAssignee') byAssignee?: string,
  ) {
    const requested = parseProjectIds(projectIds);
    const scope = requested
      ? await this.analytics.resolveScopeIds(organizationId, user.id, requested)
      : undefined;
    return this.analytics.organizationOverview(organizationId, user.id, scope, {
      byAssignee: byAssignee === '1' || byAssignee === 'true',
    });
  }

  /** Ba thẻ lãnh đạo (Top rủi ro, OKR chậm, người quá tải) — organization-level như `overview`, lọc theo dự án người xem thấy. */
  @Get('leadership')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async leadershipOverview(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    /** CSV id dự án như `overview`; thu hẹp rủi ro + mục tiêu chậm (thẻ người quá tải đo toàn tổ chức nên bị bỏ). */
    @Query('projectIds') projectIds?: string | string[],
  ) {
    const requested = parseProjectIds(projectIds);
    if (!requested) return this.leadership.get(organizationId, user.id);
    const scope = await this.analytics.resolveScopeIds(organizationId, user.id, requested);
    return this.leadership.get(organizationId, user.id, new Date(), { projectIds: scope });
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

  /**
   * Báo cáo QA gộp nhiều dự án (phạm vi nhóm dự án của dashboard). Quyền `report:view` cấp tổ chức (không gắn một dự án);
   * `projectIds` (CSV) luôn giao với dự án người xem thấy ở máy chủ, thiếu → 422, chuỗi rỗng → báo cáo rỗng.
   */
  @Get('qa/projects')
  @Permissions(PERMISSIONS.REPORT_VIEW)
  async qaForProjects(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Query('projectIds') projectIds?: string | string[],
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const requested = parseProjectIds(projectIds);
    if (!requested) throw new BusinessRuleException('Thiếu projectIds');
    return this.qaReport.reportForProjects(organizationId, user.id, requested, from, to);
  }
}
