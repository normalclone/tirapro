import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { createWorkspaceSchema, type CreateWorkspaceInput } from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { WorkspacesService } from './workspaces.service';

@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  /** Bất kỳ người dùng đã đăng nhập đều có thể tạo workspace mới (trở thành admin của nó). */
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createWorkspaceSchema)) dto: CreateWorkspaceInput,
  ) {
    return this.workspaces.create(user.id, dto);
  }

  /** Chỉ cho phép sửa workspace đang hoạt động (perm gắn với workspace hiện tại). */
  private assertCurrent(user: AuthUser, id: string): string {
    if (!user.workspaceId || user.workspaceId !== id) {
      throw new ForbiddenAppException('Chỉ có thể sửa workspace đang hoạt động');
    }
    return id;
  }

  /** Tải logo/ảnh workspace (workspace admin). */
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  @Post(':id/avatar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.workspaces.setAvatar(this.assertCurrent(user, id), file, req);
  }

  /** Gỡ logo/ảnh workspace (workspace admin). */
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  @Delete(':id/avatar')
  async removeAvatar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workspaces.clearAvatar(this.assertCurrent(user, id));
  }
}
