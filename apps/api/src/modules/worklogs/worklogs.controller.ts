import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import {
  createWorklogSchema,
  deleteWorklogQuerySchema,
  updateWorklogSchema,
  type CreateWorklogInput,
  type UpdateWorklogInput,
} from '@tirapro/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { WorklogsService } from './worklogs.service';

@ApiTags('worklogs')
@Controller()
export class WorklogsController {
  constructor(private readonly worklogs: WorklogsService) {}

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('issue', 'id')
  @Get('issues/:id/worklogs')
  async list(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.worklogs.list(workspaceId, id);
  }

  @Permissions(PERMISSIONS.WORKLOG_CREATE)
  @ProjectRef('issue', 'id')
  @Post('issues/:id/worklogs')
  async create(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createWorklogSchema)) dto: CreateWorklogInput,
  ) {
    return this.worklogs.create(workspaceId, user.id, id, dto);
  }

  @Permissions(PERMISSIONS.WORKLOG_UPDATE)
  @ProjectRef('worklog', 'id')
  @Patch('worklogs/:id')
  async update(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWorklogSchema)) dto: UpdateWorklogInput,
  ) {
    return this.worklogs.update(workspaceId, user.id, id, dto);
  }

  @Permissions(PERMISSIONS.WORKLOG_DELETE)
  @ProjectRef('worklog', 'id')
  @Delete('worklogs/:id')
  async remove(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(deleteWorklogQuerySchema))
    query: { adjustRemaining?: 'auto' | 'leave' },
  ) {
    return this.worklogs.remove(workspaceId, user.id, id, query.adjustRemaining);
  }
}
