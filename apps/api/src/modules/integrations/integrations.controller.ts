import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS } from '@tirapro/types';
import { IntegrationType } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
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

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  /** Liệt kê integration (đã ẩn token). Không cần quyền quản lý — chỉ đọc. */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('type') type?: string) {
    const parsed = type && type in IntegrationType ? (type as IntegrationType) : undefined;
    return this.integrations.list(this.ws(user), parsed);
  }

  /** Tạo integration Telegram. */
  @Post('telegram')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async createTelegram(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createTelegramSchema)) body: CreateTelegramBody,
  ) {
    return this.integrations.createTelegram(this.ws(user), user.id, body);
  }

  /** Xóa integration (cascade kênh). */
  @Delete(':id')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.integrations.remove(this.ws(user), id);
  }

  /** Liệt kê kênh của một integration. */
  @Get(':id/channels')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async listChannels(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.integrations.listChannels(this.ws(user), id);
  }

  /** Thêm kênh vào integration. */
  @Post(':id/channels')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async addChannel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addChannelSchema)) body: AddChannelBody,
  ) {
    return this.integrations.addChannel(this.ws(user), id, body);
  }

  /** Xóa một kênh. */
  @Delete('channels/:channelId')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async removeChannel(@CurrentUser() user: AuthUser, @Param('channelId') channelId: string) {
    return this.integrations.removeChannel(this.ws(user), channelId);
  }

  /** Gửi tin nhắn kiểm tra tới mọi kênh đang bật. */
  @Post(':id/test')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async test(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.integrations.test(this.ws(user), id);
  }
}
