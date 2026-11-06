import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS } from '@tirapro/types';
import { AuthOnly } from '../../common/decorators/auth-only.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { CHANNEL_EVENT_TYPES, ProjectTelegramService } from './project-telegram.service';

/** Sửa kênh: sự kiện (rỗng = tất cả) và/hoặc bật tắt; phải có ít nhất một trường. */
export const updateProjectChannelSchema = z
  .object({
    events: z.array(z.enum(CHANNEL_EVENT_TYPES)).optional(),
    isEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.events !== undefined || v.isEnabled !== undefined, {
    message: 'Không có gì để cập nhật',
  });
type UpdateProjectChannelBody = z.infer<typeof updateProjectChannelSchema>;

/**
 * Kênh Telegram của DỰ ÁN — quyền `project:admin` của chính dự án (`@ProjectRef('param','projectId')`: guard kiểm dự án
 * thuộc tổ chức, người gọi thấy được và có quyền ở dự án đó). Không có route tạo/sửa bot.
 */
@ApiTags('integrations')
@Controller()
export class ProjectTelegramController {
  constructor(private readonly projectTelegram: ProjectTelegramService) {}

  /**
   * Dự án người gọi quản trị (để Cài đặt › Thông báo quyết định hiện mục hay không). Dữ liệu của chính người gọi và đã
   * lọc theo quyền từng dự án trong service, nên không cần quyền RBAC cấp tổ chức.
   */
  @AuthOnly()
  @Get('notifications/telegram/managed-projects')
  async managedProjects(@OrganizationId() organizationId: string, @CurrentUser() user: AuthUser) {
    return this.projectTelegram.managedProjects(user.id, organizationId);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('param', 'projectId')
  @Get('projects/:projectId/telegram')
  async overview(@OrganizationId() organizationId: string, @Param('projectId') projectId: string) {
    return this.projectTelegram.overview(organizationId, projectId);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('param', 'projectId')
  @Post('projects/:projectId/telegram/link-codes')
  async createCode(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.projectTelegram.createCode(organizationId, projectId, user.id);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('param', 'projectId')
  @Post('projects/:projectId/telegram/link-codes/:code/poll')
  async poll(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('code') code: string,
  ) {
    return this.projectTelegram.poll(organizationId, projectId, user.id, code);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('param', 'projectId')
  @Patch('projects/:projectId/telegram/channels/:channelId')
  async updateChannel(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('channelId') channelId: string,
    @Body(new ZodValidationPipe(updateProjectChannelSchema)) body: UpdateProjectChannelBody,
  ) {
    return this.projectTelegram.updateChannel(organizationId, projectId, channelId, body, user.id);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('param', 'projectId')
  @Delete('projects/:projectId/telegram/channels/:channelId')
  async removeChannel(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.projectTelegram.removeChannel(organizationId, projectId, channelId, user.id);
  }
}
