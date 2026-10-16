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
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import {
  changePasswordSchema,
  updateProfileSchema,
  type ChangePasswordInput,
  type UpdateProfileInput,
} from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';
import { setRefreshCookie } from '../auth/refresh-cookie';
import { AuthOnly } from '../../common/decorators/auth-only.decorator';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  /** Danh sách thành viên workspace hiện tại (picker assignee/@mention). */
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  @Get()
  async list(@WorkspaceId() workspaceId: string, @Query('search') search?: string) {
    return this.users.listWorkspaceMembers(workspaceId, search);
  }

  /** Toàn bộ user trong hệ thống (pool do admin hệ thống quản trị) — để thêm thành viên. */
  @Get('all')
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async listAll(@Query('search') search?: string) {
    return this.users.listAllUsers(search);
  }

  // Hồ sơ của chính người dùng (luôn dùng user.id từ token) — chỉ cần xác thực.
  @AuthOnly()
  @Patch('me')
  async updateMe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
  ) {
    return this.users.updateProfile(user.id, body);
  }

  /** Đổi mật khẩu của chính mình (xác minh mật khẩu hiện tại). */
  // Hồ sơ của chính người dùng (luôn dùng user.id từ token) — chỉ cần xác thực.
  @AuthOnly()
  @Post('me/change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.users.changePassword(user.id, body);
    // Mọi phiên (kể cả thiết bị này) đã bị thu hồi → cấp phiên mới cho thiết bị đang đổi mật khẩu.
    const { refreshToken, ...session } = await this.auth.reissueSession(user.id, user.workspaceId, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    setRefreshCookie(res, refreshToken, !!this.config.get<boolean>('isProd'));
    return { success: true, ...session };
  }

  /** Tải ảnh đại diện của chính mình (multipart `file`). */
  // Hồ sơ của chính người dùng (luôn dùng user.id từ token) — chỉ cần xác thực.
  @AuthOnly()
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
  // Hồ sơ của chính người dùng (luôn dùng user.id từ token) — chỉ cần xác thực.
  @AuthOnly()
  @Delete('me/avatar')
  async removeAvatar(@CurrentUser() user: AuthUser) {
    return this.users.clearAvatar(user.id);
  }

  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  @Get(':id')
  async getOne(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.users.getById(workspaceId, id);
  }
}
