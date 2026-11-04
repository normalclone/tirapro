import { Body, Controller, Get, Logger, Param, Patch, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AUDIT_ACTIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { AuditService } from '../audit/audit.service';
import { PointsService } from '../issues/points.service';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { AdminOverviewService } from './admin-overview.service';
import { AdminOrganizationsService } from './admin-organizations.service';
import { AdminSystemService } from './admin-system.service';
import {
  auditQuerySchema,
  patchOrganizationSchema,
  putPointsFormulaSchema,
  updateFlagsSchema,
  type PatchOrganizationInput,
  type PutPointsFormulaInput,
  type UpdateFlagsInput,
} from './admin-console.schemas';
import { AuthOnly } from '../../common/decorators/auth-only.decorator';

/** Console quản trị hệ thống (tổng quan, tổ chức, cấu hình, health/audit) — CHỈ admin hệ thống. */
// Chỉ admin hệ thống: từng handler tự kiểm tra isSystemAdmin (assertSysAdmin), không thuộc quyền RBAC của organization.
@AuthOnly()
@ApiTags('admin')
@Controller('admin')
export class AdminConsoleController {
  private readonly logger = new Logger(AdminConsoleController.name);

  constructor(
    private readonly overviewSvc: AdminOverviewService,
    private readonly organizationsSvc: AdminOrganizationsService,
    private readonly systemSvc: AdminSystemService,
    private readonly settings: SystemSettingsService,
    private readonly points: PointsService,
    private readonly auditLog: AuditService,
  ) {}

  private assertSysAdmin(user: AuthUser): void {
    if (!user.isSystemAdmin)
      throw new ForbiddenAppException('Chỉ admin hệ thống mới truy cập được');
  }

  @Get('overview')
  async overview(@CurrentUser() user: AuthUser) {
    this.assertSysAdmin(user);
    return this.overviewSvc.overview();
  }

  @Get('config')
  config(@CurrentUser() user: AuthUser) {
    this.assertSysAdmin(user);
    return this.overviewSvc.configStatus();
  }

  @Put('config/flags')
  async setFlags(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateFlagsSchema)) dto: UpdateFlagsInput,
  ) {
    this.assertSysAdmin(user);
    return this.settings.setFlags(dto);
  }

  /** Bảng hệ số điểm hiện hành (Cách tính điểm). */
  @Get('points-formula')
  async pointsFormula(@CurrentUser() user: AuthUser) {
    this.assertSysAdmin(user);
    return this.points.getFormula();
  }

  /**
   * Lưu bảng hệ số điểm TOÀN HỆ THỐNG: ghi một dòng nhật ký `points.formula_changed` (kèm bảng cũ/mới), rồi tính lại điểm mọi
   * việc không chỉnh tay ở NỀN (không chờ — yêu cầu trả về ngay; lỗi nền chỉ ghi log, chạy lại được bằng cách lưu lại).
   */
  @Put('points-formula')
  async putPointsFormula(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(putPointsFormulaSchema)) dto: PutPointsFormulaInput,
  ) {
    this.assertSysAdmin(user);
    const before = await this.points.getFormula();
    const saved = await this.points.setFormula(dto, user.id);
    await this.auditLog.record({
      organizationId: null,
      actorId: user.id,
      action: AUDIT_ACTIONS.POINTS_FORMULA_CHANGED,
      entityType: 'PointsFormulaConfig',
      entityId: 'default',
      summary:
        'Đổi bảng hệ số tính điểm (áp dụng toàn hệ thống, tính lại điểm các việc không chỉnh tay)',
      meta: { before, after: saved },
    });
    void this.points
      .recomputeAll()
      .then((r) => this.logger.log(`Tính lại điểm: ${r.updated} việc, ${r.epics} Epic`))
      .catch((e: unknown) =>
        this.logger.error(`Tính lại điểm lỗi: ${e instanceof Error ? e.message : String(e)}`),
      );
    return saved;
  }

  @Get('organizations')
  async organizations(@CurrentUser() user: AuthUser) {
    this.assertSysAdmin(user);
    return this.organizationsSvc.list();
  }

  @Patch('organizations/:id')
  async patchOrganization(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchOrganizationSchema)) dto: PatchOrganizationInput,
  ) {
    this.assertSysAdmin(user);
    return this.organizationsSvc.patch(id, dto);
  }

  @Get('system/health')
  async health(@CurrentUser() user: AuthUser) {
    this.assertSysAdmin(user);
    return this.systemSvc.health();
  }

  @Get('system/audit')
  async audit(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    this.assertSysAdmin(user);
    return this.systemSvc.audit(auditQuerySchema.parse(query));
  }
}
