import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  completeSprintSchema, createSprintSchema, updateSprintSchema,
  type CompleteSprintInput, type CreateSprintInput, type UpdateSprintInput,
} from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/request';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SprintsService } from './sprints.service';

@ApiTags('sprints')
@Controller('sprints')
export class SprintsController {
  constructor(private readonly sprints: SprintsService) {}

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('query', 'projectId')
  @Get()
  async list(@WorkspaceId() workspaceId: string, @Query('projectId') projectId: string) {
    return this.sprints.listForProject(workspaceId, projectId);
  }

  @Permissions(PERMISSIONS.SPRINT_MANAGE)
  @ProjectRef('query', 'projectId')
  @Post()
  async create(
    @WorkspaceId() workspaceId: string,
    @Query('projectId') projectId: string,
    @Body(new ZodValidationPipe(createSprintSchema)) dto: CreateSprintInput,
  ) {
    return this.sprints.create(workspaceId, projectId, dto);
  }

  @Permissions(PERMISSIONS.SPRINT_MANAGE)
  @ProjectRef('sprint', 'id')
  @Post(':id/start')
  async start(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.sprints.start(workspaceId, id);
  }

  /** Hoàn thành sprint; body (tuỳ chọn) chọn nơi chuyển việc chưa xong, mặc định về backlog. */
  @Permissions(PERMISSIONS.SPRINT_MANAGE)
  @ProjectRef('sprint', 'id')
  @Post(':id/complete')
  async complete(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(completeSprintSchema)) dto: CompleteSprintInput,
  ) {
    return this.sprints.complete(workspaceId, id, user.id, dto);
  }

  @Permissions(PERMISSIONS.SPRINT_MANAGE)
  @ProjectRef('sprint', 'id')
  @Patch(':id')
  async update(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSprintSchema)) dto: UpdateSprintInput,
  ) {
    return this.sprints.update(workspaceId, id, dto);
  }

  /** Chỉ xoá được sprint FUTURE; việc trong sprint về backlog. */
  @Permissions(PERMISSIONS.SPRINT_MANAGE)
  @ProjectRef('sprint', 'id')
  @Delete(':id')
  async remove(@WorkspaceId() workspaceId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sprints.remove(workspaceId, id, user.id);
  }
}
