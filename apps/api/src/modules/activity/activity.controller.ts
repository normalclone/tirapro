import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
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
    @OrganizationId() organizationId: string,
    @Param('issueId') issueId: string,
    @Query('fields') fields?: string | string[],
  ) {
    return this.activity.listForIssue(organizationId, issueId, parseFields(fields));
  }

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('issue', 'issueId')
  @Get('issues/:issueId/activity/:activityId')
  async oneForIssue(
    @OrganizationId() organizationId: string,
    @Param('issueId') issueId: string,
    @Param('activityId') activityId: string,
  ) {
    return this.activity.getOne(organizationId, issueId, activityId);
  }

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('param', 'projectId')
  @Get('projects/:projectId/activity')
  async forProject(
    @OrganizationId() organizationId: string,
    @Param('projectId') projectId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.activity.listForProject(
      organizationId,
      projectId,
      cursor,
      Math.min(Math.max(Number(limit) || 50, 1), 100),
    );
  }
}
