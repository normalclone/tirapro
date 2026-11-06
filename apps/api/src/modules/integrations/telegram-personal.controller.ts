import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthOnly } from '../../common/decorators/auth-only.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { TelegramPersonalService } from './telegram-personal.service';

/**
 * Liên kết Telegram cá nhân của CHÍNH người gọi (mọi thao tác lọc theo user.id + tổ chức hiện tại) — không cần quyền RBAC.
 * Đặt dưới `notifications/telegram` vì là một phần của Cài đặt › Thông báo.
 */
@AuthOnly()
@ApiTags('notifications')
@Controller('notifications/telegram')
export class TelegramPersonalController {
  constructor(private readonly personal: TelegramPersonalService) {}

  /** Trạng thái: tổ chức có bot không, đã liên kết với @username nào (không lộ chatId). */
  @Get()
  async status(@OrganizationId() organizationId: string, @CurrentUser() user: AuthUser) {
    return this.personal.status(user.id, organizationId);
  }

  /** Tạo mã một lần (10 phút) + deep link `t.me/<bot>?start=<mã>`. */
  @Post('link')
  async createLink(@OrganizationId() organizationId: string, @CurrentUser() user: AuthUser) {
    const res = await this.personal.createCode(user.id, organizationId);
    if (!res) {
      throw new BusinessRuleException(
        'Quản trị tổ chức cần cài bot Telegram ở Kết nối › Telegram trước',
      );
    }
    return res;
  }

  /** Hỏi xem `/start <mã>` đã tới bot chưa (đọc tin mới nhất theo yêu cầu, không polling nền). */
  @Post('link/:code/poll')
  async pollLink(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
  ) {
    return this.personal.poll(user.id, organizationId, code);
  }

  /** Huỷ liên kết. */
  @Delete('link')
  async unlink(@OrganizationId() organizationId: string, @CurrentUser() user: AuthUser) {
    return this.personal.unlink(user.id, organizationId);
  }
}
