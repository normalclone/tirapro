import { Body, Controller, Delete, Get, Param, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  setProjectOverrideSchema,
  setOrganizationSchemeSchema,
  type SetProjectOverrideInput,
  type SetOrganizationSchemeInput,
} from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { WorkflowSchemeService } from './workflow-scheme.service';

/** `?dryRun=1` (hoặc `true`): chỉ xem trước các việc sẽ chuyển, không ghi gì. */
const isDryRun = (v?: string) => v === '1' || v === 'true';

const clearOverrideBodySchema = z
  .object({ statusMap: z.record(z.string().min(1), z.string().min(1)).default({}) })
  .default({});

@ApiTags('workflow-schemes')
@Controller()
export class WorkflowSchemeController {
  constructor(private readonly schemes: WorkflowSchemeService) {}

  /** Cấu hình quy trình theo loại việc của tổ chức. Chỉ Quản trị tổ chức (organization:admin) hoặc SA. */
  @Get('workflow-schemes')
  @Permissions(PERMISSIONS.ORGANIZATION_ADMIN)
  async getScheme(@OrganizationId() organizationId: string) {
    return this.schemes.getOrganizationScheme(organizationId);
  }

  /** Đặt quy trình cho từng loại việc; việc đang có chuyển sang trạng thái đích trong `statusMap`. */
  @Put('workflow-schemes')
  @Permissions(PERMISSIONS.ORGANIZATION_ADMIN)
  async setScheme(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(setOrganizationSchemeSchema)) dto: SetOrganizationSchemeInput,
    @Query('dryRun') dryRun?: string,
  ) {
    return this.schemes.setOrganizationScheme(organizationId, user.id, dto, isDryRun(dryRun));
  }

  /** Quy trình hiệu lực của từng loại việc trong dự án (ghi đè hay theo tổ chức). */
  @Get('projects/:id/workflow-overrides')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('param', 'id')
  async getProjectScheme(@OrganizationId() organizationId: string, @Param('id') projectId: string) {
    return this.schemes.getProjectScheme(organizationId, projectId);
  }

  /** Quản trị dự án, Quản trị tổ chức hoặc SA: dự án dùng quy trình riêng cho một loại việc. */
  @Put('projects/:id/workflow-overrides')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('param', 'id')
  async setOverride(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') projectId: string,
    @Body(new ZodValidationPipe(setProjectOverrideSchema)) dto: SetProjectOverrideInput,
    @Query('dryRun') dryRun?: string,
  ) {
    return this.schemes.setProjectOverride(
      organizationId,
      projectId,
      user.id,
      dto,
      isDryRun(dryRun),
    );
  }

  /** Quay về dùng chung với tổ chức cho một loại việc (kèm `statusMap` cho việc đang có). */
  @Delete('projects/:id/workflow-overrides/:issueTypeId')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('param', 'id')
  async clearOverride(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') projectId: string,
    @Param('issueTypeId') issueTypeId: string,
    @Body(new ZodValidationPipe(clearOverrideBodySchema))
    dto: z.infer<typeof clearOverrideBodySchema>,
    @Query('dryRun') dryRun?: string,
  ) {
    return this.schemes.clearProjectOverride(
      organizationId,
      projectId,
      user.id,
      issueTypeId,
      dto.statusMap,
      isDryRun(dryRun),
    );
  }
}
