import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
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

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Bạn chưa chọn không gian làm việc — hãy chọn một không gian rồi thử lại');
    return user.workspaceId;
  }

  /* ------------------------------ Mẫu issue ------------------------------ */

  @Get('templates')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async listTemplates(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) {
    return this.automation.listTemplates(this.ws(user), projectId);
  }

  @Get('templates/:id')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async getTemplate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.automation.getTemplate(this.ws(user), id);
  }

  @Post('templates')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async createTemplate(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createTemplateSchema)) dto: CreateTemplateInput,
  ) {
    return this.automation.createTemplate(this.ws(user), dto, user.id);
  }

  @Put('templates/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async updateTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTemplateSchema)) dto: UpdateTemplateInput,
  ) {
    return this.automation.updateTemplate(this.ws(user), id, dto, user.id);
  }

  @Delete('templates/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async removeTemplate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.automation.removeTemplate(this.ws(user), id, user.id);
  }

  /* ---------------------------- Việc lặp lại ----------------------------- */

  @Get('recurring')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async listRecurring(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) {
    return this.automation.listRecurring(this.ws(user), projectId);
  }

  @Get('recurring/:id')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async getRecurring(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.automation.getRecurring(this.ws(user), id);
  }

  @Post('recurring')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async createRecurring(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRecurringSchema)) dto: CreateRecurringInput,
  ) {
    return this.automation.createRecurring(this.ws(user), dto, user.id);
  }

  @Put('recurring/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async updateRecurring(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRecurringSchema)) dto: UpdateRecurringInput,
  ) {
    return this.automation.updateRecurring(this.ws(user), id, dto, user.id);
  }

  /** Tạo issue ngay lập tức từ việc lặp lại (không dời lịch chạy kế tiếp). */
  @Post('recurring/:id/run-now')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async runNow(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.automation.runNow(this.ws(user), id, user.id);
  }

  @Delete('recurring/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async removeRecurring(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.automation.removeRecurring(this.ws(user), id, user.id);
  }
}
