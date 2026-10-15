import {
  Body,
  Controller,
  Delete,
  Get,
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
import {
  createProjectSchema,
  updateProjectSchema,
  type CreateProjectInput,
  type UpdateProjectInput,
} from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @Get()
  async list(
    @WorkspaceId() workspaceId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.projects.list(workspaceId, includeArchived === 'true');
  }

  @Permissions(PERMISSIONS.PROJECT_CREATE)
  @Post()
  async create(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createProjectSchema)) dto: CreateProjectInput,
  ) {
    return this.projects.create(workspaceId, user.id, dto);
  }

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('projectKey', 'key')
  @Get(':key')
  async getByKey(@WorkspaceId() workspaceId: string, @Param('key') key: string) {
    return this.projects.getByKey(workspaceId, key.toUpperCase());
  }

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('projectKey', 'key')
  @Get(':key/meta')
  async meta(@WorkspaceId() workspaceId: string, @Param('key') key: string) {
    return this.projects.meta(workspaceId, key.toUpperCase());
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('param', 'id')
  @Patch(':id')
  async update(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) dto: UpdateProjectInput,
  ) {
    return this.projects.update(workspaceId, id, user.id, dto);
  }

  /** Lưu trữ dự án (chỉ đọc, ẩn khỏi danh sách mặc định). */
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('param', 'id')
  @Post(':id/archive')
  async archive(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.projects.archive(workspaceId, id, user.id);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('param', 'id')
  @Post(':id/unarchive')
  async unarchive(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.projects.unarchive(workspaceId, id, user.id);
  }

  /** Xoá mềm dự án — chỉ quản trị workspace. */
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  @ProjectRef('param', 'id')
  @Delete(':id')
  async remove(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.projects.remove(workspaceId, id, user.id);
  }

  /** Tải ảnh đại diện project (cần quyền quản trị project). */
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('projectKey', 'key')
  @Post(':key/avatar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @WorkspaceId() workspaceId: string,
    @Param('key') key: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.projects.setAvatar(workspaceId, key.toUpperCase(), file, req);
  }

  /** Gỡ ảnh đại diện project. */
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('projectKey', 'key')
  @Delete(':key/avatar')
  async removeAvatar(@WorkspaceId() workspaceId: string, @Param('key') key: string) {
    return this.projects.clearAvatar(workspaceId, key.toUpperCase());
  }
}
