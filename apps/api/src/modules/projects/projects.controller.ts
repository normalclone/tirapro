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
  setProjectHealthSchema,
  updateProjectSchema,
  type CreateProjectInput,
  type SetProjectHealthInput,
  type UpdateProjectInput,
} from '@tirapro/shared';
import { PERMISSIONS, type PermissionKey, type ProjectPermissionsDto } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { RbacService } from '../rbac/rbac.service';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly rbac: RbacService,
  ) {}

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @Get()
  async list(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.projects.list(workspaceId, includeArchived === 'true', user.id);
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

  /** Quyền hiệu lực của chính người gọi ở dự án này — để web hiện đúng nút theo vai trò dự án. */
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('param', 'id')
  @Get(':id/permissions/me')
  async myPermissions(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<ProjectPermissionsDto> {
    const perms = await this.rbac.getEffectivePermissions(user.id, workspaceId, id);
    return { projectId: id, permissions: [...perms].sort() as PermissionKey[] };
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

  /** Ghi đè sức khoẻ dự án (kèm ghi chú) hoặc bỏ ghi đè (`health: null`). */
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('param', 'id')
  @Patch(':id/health')
  async setHealth(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setProjectHealthSchema)) dto: SetProjectHealthInput,
  ) {
    return this.projects.setHealth(workspaceId, id, user.id, dto);
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
