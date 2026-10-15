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
import { LinkCodesService } from './link-codes.service';

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

/** Body tạo mã liên kết (projectId: kênh chỉ nhận thông báo của dự án đó). */
export const createLinkCodeSchema = z.object({ projectId: z.string().min(1).optional() });
export type CreateLinkCodeBody = z.infer<typeof createLinkCodeSchema>;

@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly linkCodes: LinkCodesService,
  ) {}

  /** Liệt kê integration (đã ẩn token). Mọi thành viên workspace xem được; tạo/xoá cần INTEGRATION_MANAGE. */
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  @Get()
  async list(@WorkspaceId() workspaceId: string, @Query('type') type?: string) {
    const parsed = type && type in IntegrationType ? (type as IntegrationType) : undefined;
    return this.integrations.list(workspaceId, parsed);
  }

  /** Cờ hệ thống + bot chung (để wizard biết có cho dùng "bot chung" không). Đặt trước mọi route `:id`. */
  @Get('telegram/platform')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async platform() {
    return this.integrations.platform();
  }

  /** Tạo integration Telegram (xác thực token qua getMe trước khi lưu). */
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
  async remove(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.integrations.remove(workspaceId, id, user.id);
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
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addChannelSchema)) body: AddChannelBody,
  ) {
    return this.integrations.addChannel(workspaceId, id, body, user.id);
  }

  /** Xóa một kênh. */
  @Delete('channels/:channelId')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async removeChannel(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('channelId') channelId: string,
  ) {
    return this.integrations.removeChannel(workspaceId, channelId, user.id);
  }

  /** Gửi tin nhắn kiểm tra tới mọi kênh đang bật. */
  @Post(':id/test')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async test(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.integrations.test(workspaceId, id);
  }

  /** Tạo mã liên kết 6 ký tự (15 phút, dùng một lần) để gõ `/link@Bot MÃ` trong nhóm Telegram. */
  @Post(':id/link-codes')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async createLinkCode(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createLinkCodeSchema)) body: CreateLinkCodeBody,
  ) {
    return this.linkCodes.createCode(workspaceId, id, user.id, body.projectId);
  }

  /** Hỏi xem mã đã được gõ trong nhóm chưa (đọc tin mới nhất theo yêu cầu, không polling nền). */
  @Post(':id/link-codes/:code/poll')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async pollLinkCode(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Param('code') code: string,
  ) {
    return this.linkCodes.poll(workspaceId, id, code);
  }
}
