import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { changePasswordSchema, type ChangePasswordInput } from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Danh sách thành viên workspace hiện tại (picker assignee/@mention). */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('search') search?: string) {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return this.users.listWorkspaceMembers(user.workspaceId, search);
  }

  /** Toàn bộ user trong hệ thống (pool do admin hệ thống quản trị) — để thêm thành viên. */
  @Get('all')
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async listAll(@Query('search') search?: string) {
    return this.users.listAllUsers(search);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() user: AuthUser,
    @Body() body: { displayName?: string; avatarUrl?: string; timezone?: string; locale?: string },
  ) {
    return this.users.updateProfile(user.id, body);
  }

  /** Đổi mật khẩu của chính mình (xác minh mật khẩu hiện tại). */
  @Post('me/change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
  ) {
    return this.users.changePassword(user.id, body);
  }

  /** Tải ảnh đại diện của chính mình (multipart `file`). */
  @Post('me/avatar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.users.setAvatar(user.id, file, req);
  }

  /** Gỡ ảnh đại diện của chính mình. */
  @Delete('me/avatar')
  async removeAvatar(@CurrentUser() user: AuthUser) {
    return this.users.clearAvatar(user.id);
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.users.getById(id);
  }
}
