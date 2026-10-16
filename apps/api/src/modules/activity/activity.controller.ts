import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ActivityService } from './activity.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { PERMISSIONS } from '@tirapro/types';
import { parseFields } from './activity.fields';

@ApiTags('activity')
@Controller()
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('issue', 'issueId')
  @Get('issues/:issueId/activity')
  async forIssue(
    @WorkspaceId() workspaceId: string,
    @Param('issueId') issueId: string,
    @Query('fields') fields?: string | string[],
  ) {
    return this.activity.listForIssue(workspaceId, issueId, parseFields(fields));
  }

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('issue', 'issueId')
  @Get('issues/:issueId/activity/:activityId')
  async oneForIssue(
    @WorkspaceId() workspaceId: string,
    @Param('issueId') issueId: string,
    @Param('activityId') activityId: string,
  ) {
    return this.activity.getOne(workspaceId, issueId, activityId);
  }

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('param', 'projectId')
  @Get('projects/:projectId/activity')
  async forProject(
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.activity.listForProject(
      workspaceId,
      projectId,
      cursor,
      Math.min(Math.max(Number(limit) || 50, 1), 100),
    );
  }
}
