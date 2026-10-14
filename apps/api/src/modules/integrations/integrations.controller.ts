import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS } from '@tirapro/types';
import { IntegrationType } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { IntegrationsService } from './integrations.service';

/** Body tạo integration Telegram. */
export const createTelegramSchema = z.object({
  name: z.string().min(1, 'Tên không được để trống'),
  botToken: z.string().min(1).optional(),
});
export type CreateTelegramBody = z.infer<typeof createTelegramSchema>;

/** Body thêm kênh. */
export const addChannelSchema = z.object({
  externalId: z.string().min(1, 'Thiếu chat_id'),
  title: z.string().optional(),
  events: z.array(z.string()).optional(),
  projectId: z.string().optional(),
});
export type AddChannelBody = z.infer<typeof addChannelSchema>;

@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  /** Liệt kê integration (đã ẩn token). Không cần quyền quản lý — chỉ đọc. */
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  @Get()
  async list(@WorkspaceId() workspaceId: string, @Query('type') type?: string) {
    const parsed = type && type in IntegrationType ? (type as IntegrationType) : undefined;
    return this.integrations.list(workspaceId, parsed);
  }

  /** Tạo integration Telegram. */
  @Post('telegram')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async createTelegram(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createTelegramSchema)) body: CreateTelegramBody,
  ) {
    return this.integrations.createTelegram(workspaceId, user.id, body);
  }

  /** Xóa integration (cascade kênh). */
  @Delete(':id')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async remove(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.integrations.remove(workspaceId, id);
  }

  /** Liệt kê kênh của một integration. */
  @Get(':id/channels')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async listChannels(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.integrations.listChannels(workspaceId, id);
  }

  /** Thêm kênh vào integration. */
  @Post(':id/channels')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async addChannel(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addChannelSchema)) body: AddChannelBody,
  ) {
    return this.integrations.addChannel(workspaceId, id, body);
  }

  /** Xóa một kênh. */
  @Delete('channels/:channelId')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async removeChannel(@WorkspaceId() workspaceId: string, @Param('channelId') channelId: string) {
    return this.integrations.removeChannel(workspaceId, channelId);
  }

  /** Gửi tin nhắn kiểm tra tới mọi kênh đang bật. */
  @Post(':id/test')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async test(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.integrations.test(workspaceId, id);
  }
}
