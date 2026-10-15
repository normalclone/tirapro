import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/request';
import { GuidesService, type GuideListItemDto, type GuideStateDto } from './guides.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { AuthOnly } from '../../common/decorators/auth-only.decorator';
import { PERMISSIONS } from '@tirapro/types';

@ApiTags('guides')
@Controller('guides')
export class GuidesController {
  constructor(private readonly guides: GuidesService) {}

  /** Guide đã publish cho một màn (bỏ `screen` = toàn bộ workspace), kèm tiến độ user. */
  // Tiến độ hướng dẫn của chính người dùng — chỉ cần xác thực.
  @AuthOnly()
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('screen') screen?: string,
  ): Promise<GuideListItemDto[]> {
    return this.guides.listForScreen(user, screen);
  }

  /** Tiến độ guide của user hiện tại. */
  // Tiến độ hướng dẫn của chính người dùng — chỉ cần xác thực.
  @AuthOnly()
  @Get('state')
  async state(@CurrentUser() user: AuthUser): Promise<GuideStateDto[]> {
    return this.guides.listState(user);
  }

  /** Toàn bộ guide của workspace để quản trị. */
  @Permissions(PERMISSIONS.GUIDE_MANAGE)
  @Get('admin')
  async admin(@CurrentUser() user: AuthUser): Promise<GuideListItemDto[]> {
    return this.guides.listAdmin(user);
  }

  /** Đánh dấu đã xem guide (không hạ cấp COMPLETED). */
  // Tiến độ hướng dẫn của chính người dùng — chỉ cần xác thực.
  @AuthOnly()
  @Post(':key/seen')
  async seen(@CurrentUser() user: AuthUser, @Param('key') key: string): Promise<{ ok: true }> {
    return this.guides.markSeen(user, key);
  }

  /** Đánh dấu hoàn thành guide. */
  // Tiến độ hướng dẫn của chính người dùng — chỉ cần xác thực.
  @AuthOnly()
  @Post(':key/complete')
  async complete(@CurrentUser() user: AuthUser, @Param('key') key: string): Promise<{ ok: true }> {
    return this.guides.markComplete(user, key);
  }
}
