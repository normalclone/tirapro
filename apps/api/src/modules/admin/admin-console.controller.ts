import { Body, Controller, Get, Param, Patch, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { AdminOverviewService } from './admin-overview.service';
import { AdminWorkspacesService } from './admin-workspaces.service';
import { AdminSystemService } from './admin-system.service';
import {
  auditQuerySchema,
  patchWorkspaceSchema,
  updateFlagsSchema,
  type PatchWorkspaceInput,
  type UpdateFlagsInput,
} from './admin-console.schemas';

/** Console quản trị hệ thống (tổng quan, workspaces, cấu hình, health/audit) — CHỈ admin hệ thống. */
@ApiTags('admin')
@Controller('admin')
export class AdminConsoleController {
  constructor(
    private readonly overviewSvc: AdminOverviewService,
    private readonly workspacesSvc: AdminWorkspacesService,
    private readonly systemSvc: AdminSystemService,
    private readonly settings: SystemSettingsService,
  ) {}

  private assertSysAdmin(user: AuthUser): void {
    if (!user.isSystemAdmin) throw new ForbiddenAppException('Chỉ admin hệ thống mới truy cập được');
  }

  @Get('overview')
  async overview(@CurrentUser() user: AuthUser) {
    this.assertSysAdmin(user);
    return this.overviewSvc.overview();
  }

  @Get('config')
  async config(@CurrentUser() user: AuthUser) {
    this.assertSysAdmin(user);
    return this.overviewSvc.configStatus();
  }

  @Put('config/flags')
  async setFlags(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(updateFlagsSchema)) dto: UpdateFlagsInput) {
    this.assertSysAdmin(user);
    return this.settings.setFlags(dto);
  }

  @Get('workspaces')
  async workspaces(@CurrentUser() user: AuthUser) {
    this.assertSysAdmin(user);
    return this.workspacesSvc.list();
  }

  @Patch('workspaces/:id')
  async patchWorkspace(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchWorkspaceSchema)) dto: PatchWorkspaceInput,
  ) {
    this.assertSysAdmin(user);
    return this.workspacesSvc.patch(id, dto);
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
