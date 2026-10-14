import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ActivityService } from './activity.service';

@ApiTags('activity')
@Controller()
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get('issues/:issueId/activity')
  async forIssue(@WorkspaceId() workspaceId: string, @Param('issueId') issueId: string) {
    return this.activity.listForIssue(workspaceId, issueId);
  }

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
