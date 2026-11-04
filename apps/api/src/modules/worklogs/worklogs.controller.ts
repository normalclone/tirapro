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
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
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
  async list(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.worklogs.list(organizationId, id);
  }

  @Permissions(PERMISSIONS.WORKLOG_CREATE)
  @ProjectRef('issue', 'id')
  @Post('issues/:id/worklogs')
  async create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createWorklogSchema)) dto: CreateWorklogInput,
  ) {
    return this.worklogs.create(organizationId, user.id, id, dto);
  }

  @Permissions(PERMISSIONS.WORKLOG_UPDATE)
  @ProjectRef('worklog', 'id')
  @Patch('worklogs/:id')
  async update(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWorklogSchema)) dto: UpdateWorklogInput,
  ) {
    return this.worklogs.update(organizationId, user.id, id, dto);
  }

  @Permissions(PERMISSIONS.WORKLOG_DELETE)
  @ProjectRef('worklog', 'id')
  @Delete('worklogs/:id')
  async remove(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(deleteWorklogQuerySchema))
    query: { adjustRemaining?: 'auto' | 'leave' },
  ) {
    return this.worklogs.remove(organizationId, user.id, id, query.adjustRemaining);
  }
}
