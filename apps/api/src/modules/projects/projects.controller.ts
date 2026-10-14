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
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  async list(@WorkspaceId() workspaceId: string) {
    return this.projects.list(workspaceId);
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

  @Get(':key')
  async getByKey(@WorkspaceId() workspaceId: string, @Param('key') key: string) {
    return this.projects.getByKey(workspaceId, key.toUpperCase());
  }

  @Get(':key/meta')
  async meta(@WorkspaceId() workspaceId: string, @Param('key') key: string) {
    return this.projects.meta(workspaceId, key.toUpperCase());
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
