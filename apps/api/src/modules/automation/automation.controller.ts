import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { AutomationService } from './automation.service';
import {
  createRecurringSchema, createTemplateSchema, updateRecurringSchema, updateTemplateSchema,
  type CreateRecurringInput, type CreateTemplateInput, type UpdateRecurringInput, type UpdateTemplateInput,
} from './automation.schemas';

@ApiTags('automation')
@Controller('automation')
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  /* ------------------------------ Mẫu issue ------------------------------ */

  @ProjectRef('query', 'projectId')
  @Get('templates')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async listTemplates(@WorkspaceId() workspaceId: string, @Query('projectId') projectId?: string) {
    return this.automation.listTemplates(workspaceId, projectId);
  }

  @ProjectRef('automationTemplate', 'id')
  @Get('templates/:id')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async getTemplate(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.automation.getTemplate(workspaceId, id);
  }

  @Post('templates')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async createTemplate(
    @CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(createTemplateSchema)) dto: CreateTemplateInput,
  ) {
    return this.automation.createTemplate(workspaceId, dto, user.id);
  }

  @ProjectRef('automationTemplate', 'id')
  @Put('templates/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async updateTemplate(
    @CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTemplateSchema)) dto: UpdateTemplateInput,
  ) {
    return this.automation.updateTemplate(workspaceId, id, dto, user.id);
  }

  @ProjectRef('automationTemplate', 'id')
  @Delete('templates/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async removeTemplate(@CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.automation.removeTemplate(workspaceId, id, user.id);
  }

  /* ---------------------------- Việc lặp lại ----------------------------- */

  @ProjectRef('query', 'projectId')
  @Get('recurring')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async listRecurring(@WorkspaceId() workspaceId: string, @Query('projectId') projectId?: string) {
    return this.automation.listRecurring(workspaceId, projectId);
  }

  @ProjectRef('recurringIssue', 'id')
  @Get('recurring/:id')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async getRecurring(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.automation.getRecurring(workspaceId, id);
  }

  @Post('recurring')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async createRecurring(
    @CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(createRecurringSchema)) dto: CreateRecurringInput,
  ) {
    return this.automation.createRecurring(workspaceId, dto, user.id);
  }

  @ProjectRef('recurringIssue', 'id')
  @Put('recurring/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async updateRecurring(
    @CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRecurringSchema)) dto: UpdateRecurringInput,
  ) {
    return this.automation.updateRecurring(workspaceId, id, dto, user.id);
  }

  /** Tạo issue ngay lập tức từ việc lặp lại (không dời lịch chạy kế tiếp). */
  @ProjectRef('recurringIssue', 'id')
  @Post('recurring/:id/run-now')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async runNow(@CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.automation.runNow(workspaceId, id, user.id);
  }

  @ProjectRef('recurringIssue', 'id')
  @Delete('recurring/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async removeRecurring(@CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.automation.removeRecurring(workspaceId, id, user.id);
  }
}
