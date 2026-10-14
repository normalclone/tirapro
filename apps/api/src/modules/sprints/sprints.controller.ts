import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createSprintSchema, type CreateSprintInput } from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
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

  @Permissions(PERMISSIONS.SPRINT_MANAGE)
  @ProjectRef('sprint', 'id')
  @Post(':id/complete')
  async complete(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.sprints.complete(workspaceId, id);
  }
}
