import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  bulkUpdateIssuesSchema, createIssueSchema, moveIssueSchema, transitionIssueSchema, updateIssueSchema,
  type BulkUpdateIssuesInput, type CreateIssueInput, type MoveIssueInput, type TransitionIssueInput, type UpdateIssueInput,
} from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { IssuesService } from './issues.service';

@ApiTags('issues')
@Controller('issues')
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('query', 'projectId')
  @Get()
  async list(
    @WorkspaceId() workspaceId: string,
    @Query('projectId') projectId?: string,
    @Query('statusId') statusId?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('typeId') typeId?: string,
    @Query('sprintId') sprintId?: string,
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.issues.list(
      workspaceId,
      { projectId, statusId, assigneeId, typeId, sprintId, search },
      cursor,
      Math.min(Math.max(Number(limit) || 50, 1), 100),
    );
  }

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @Get(':key')
  async getByKey(@WorkspaceId() workspaceId: string, @Param('key') key: string) {
    return this.issues.getByKey(workspaceId, key.toUpperCase());
  }

  @Permissions(PERMISSIONS.ISSUE_CREATE)
  @ProjectRef('body', 'projectId')
  @Post()
  async create(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createIssueSchema)) dto: CreateIssueInput,
  ) {
    return this.issues.create(workspaceId, user.id, dto);
  }

  // Khai báo TRƯỚC `PATCH :id` để "bulk" không bị coi là id.
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ProjectRef('body', 'projectId')
  @Patch('bulk')
  async bulkUpdate(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(bulkUpdateIssuesSchema)) dto: BulkUpdateIssuesInput,
  ) {
    return this.issues.bulkUpdate(workspaceId, user.id, dto);
  }

  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ProjectRef('issue', 'id')
  @Patch(':id')
  async update(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateIssueSchema)) dto: UpdateIssueInput,
  ) {
    return this.issues.update(workspaceId, user.id, id, dto);
  }

  @Permissions(PERMISSIONS.ISSUE_TRANSITION)
  @ProjectRef('issue', 'id')
  @Post(':id/transition')
  async transition(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(transitionIssueSchema)) dto: TransitionIssueInput,
  ) {
    return this.issues.transition(workspaceId, user.id, id, dto);
  }

  @Permissions(PERMISSIONS.ISSUE_TRANSITION)
  @ProjectRef('issue', 'id')
  @Post(':id/move')
  async move(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moveIssueSchema)) dto: MoveIssueInput,
  ) {
    return this.issues.move(workspaceId, user.id, id, dto);
  }

  @Permissions(PERMISSIONS.ISSUE_DELETE)
  @ProjectRef('issue', 'id')
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.issues.softDelete(workspaceId, user.id, id);
  }
}
