import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { createProjectSchema, type CreateProjectInput } from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return this.projects.list(user.workspaceId);
  }

  @Permissions(PERMISSIONS.PROJECT_CREATE)
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createProjectSchema)) dto: CreateProjectInput,
  ) {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return this.projects.create(user.workspaceId, user.id, dto);
  }

  @Get(':key')
  async getByKey(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return this.projects.getByKey(user.workspaceId, key.toUpperCase());
  }

  @Get(':key/meta')
  async meta(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return this.projects.meta(user.workspaceId, key.toUpperCase());
  }

  /** Tải ảnh đại diện project (cần quyền quản trị project). */
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @Post(':key/avatar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return this.projects.setAvatar(user.workspaceId, key.toUpperCase(), file, req);
  }

  /** Gỡ ảnh đại diện project. */
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @Delete(':key/avatar')
  async removeAvatar(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return this.projects.clearAvatar(user.workspaceId, key.toUpperCase());
  }
}
