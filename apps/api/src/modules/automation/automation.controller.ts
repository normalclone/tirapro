import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { AutomationService } from './automation.service';
import {
  createRecurringSchema,
  createTemplateSchema,
  updateRecurringSchema,
  updateTemplateSchema,
  type CreateRecurringInput,
  type CreateTemplateInput,
  type UpdateRecurringInput,
  type UpdateTemplateInput,
} from './automation.schemas';

@ApiTags('automation')
@Controller('automation')
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  /* ------------------------------ Mẫu issue ------------------------------ */

  @ProjectRef('query', 'projectId')
  @Get('templates')
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async listTemplates(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
  ) {
    return this.automation.listTemplates(organizationId, projectId, user.id);
  }

  @ProjectRef('automationTemplate', 'id')
  @Get('templates/:id')
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async getTemplate(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.automation.getTemplate(organizationId, id);
  }

  @Post('templates')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async createTemplate(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createTemplateSchema)) dto: CreateTemplateInput,
  ) {
    return this.automation.createTemplate(organizationId, dto, user.id);
  }

  @ProjectRef('automationTemplate', 'id')
  @Put('templates/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async updateTemplate(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTemplateSchema)) dto: UpdateTemplateInput,
  ) {
    return this.automation.updateTemplate(organizationId, id, dto, user.id);
  }

  @ProjectRef('automationTemplate', 'id')
  @Delete('templates/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async removeTemplate(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.automation.removeTemplate(organizationId, id, user.id);
  }

  /* ---------------------------- Việc lặp lại ----------------------------- */

  @ProjectRef('query', 'projectId')
  @Get('recurring')
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async listRecurring(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
  ) {
    return this.automation.listRecurring(organizationId, projectId, user.id);
  }

  @ProjectRef('recurringIssue', 'id')
  @Get('recurring/:id')
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async getRecurring(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.automation.getRecurring(organizationId, id);
  }

  @Post('recurring')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async createRecurring(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRecurringSchema)) dto: CreateRecurringInput,
  ) {
    return this.automation.createRecurring(organizationId, dto, user.id);
  }

  @ProjectRef('recurringIssue', 'id')
  @Put('recurring/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async updateRecurring(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRecurringSchema)) dto: UpdateRecurringInput,
  ) {
    return this.automation.updateRecurring(organizationId, id, dto, user.id);
  }

  /** Tạo issue ngay lập tức từ việc lặp lại (không dời lịch chạy kế tiếp). */
  @ProjectRef('recurringIssue', 'id')
  @Post('recurring/:id/run-now')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async runNow(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.automation.runNow(organizationId, id, user.id);
  }

  @ProjectRef('recurringIssue', 'id')
  @Delete('recurring/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async removeRecurring(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.automation.removeRecurring(organizationId, id, user.id);
  }
}
