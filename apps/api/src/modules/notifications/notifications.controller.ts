import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { NotificationType } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { NotificationsService } from './notifications.service';

/** Body của PUT /notifications/preferences — object boolean tùy chọn, khóa theo enum loại thông báo. */
const updatePreferencesSchema = z.object({
  preferences: z
    .object(
      Object.fromEntries(
        Object.values(NotificationType).map((type) => [type, z.boolean().optional()]),
      ) as Record<NotificationType, z.ZodOptional<z.ZodBoolean>>,
    )
    .strict(),
});
type UpdatePreferencesBody = z.infer<typeof updatePreferencesSchema>;

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Thông báo của tôi, mới nhất trước. */
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);
    return this.notifications.listMine(user.id, cursor, lim);
  }

  /** Số thông báo chưa đọc. */
  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user.id);
  }

  /** Tùy chọn nhận thông báo của tôi (map hiệu lực + bản mặc định). */
  @Get('preferences')
  async getPreferences(@CurrentUser() user: AuthUser) {
    return this.notifications.getPreferences(user.id);
  }

  /** Cập nhật tùy chọn nhận thông báo của tôi; trả về map hiệu lực sau cập nhật. */
  @Put('preferences')
  async updatePreferences(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updatePreferencesSchema)) dto: UpdatePreferencesBody,
  ) {
    const preferences = await this.notifications.updatePreferences(user.id, dto.preferences);
    return { preferences };
  }

  /** Đánh dấu một thông báo là đã đọc. */
  @Post(':id/read')
  async markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user.id, id);
  }

  /** Đánh dấu tất cả là đã đọc. */
  @Post('read-all')
  async markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }
}
