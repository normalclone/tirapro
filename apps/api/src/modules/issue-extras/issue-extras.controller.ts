import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { IssueExtrasService } from './issue-extras.service';
import {
  setParticipantsSchema,
  addChecklistSchema,
  updateChecklistSchema,
  type SetParticipantsInput,
  type AddChecklistInput,
  type UpdateChecklistInput,
} from './issue-extras.schemas';
import { IssueOwnershipService } from '../rbac/issue-ownership.service';
import { OwnOnly } from '../../common/decorators/own-only.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/request';

@ApiTags('issues')
@ProjectRef('issue', 'issueId')
@Controller('issues/:issueId')
export class IssueExtrasController {
  constructor(
    private readonly extras: IssueExtrasService,
    private readonly ownership: IssueOwnershipService,
  ) {}

  /** Người tham gia issue (ngoài người phụ trách & người báo cáo). */
  @Get('participants')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async listParticipants(@WorkspaceId() workspaceId: string, @Param('issueId') issueId: string) {
    return this.extras.listParticipants(workspaceId, issueId);
  }

  @Put('participants')
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  async setParticipants(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(setParticipantsSchema)) dto: SetParticipantsInput,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, workspaceId, user.id, issueId);
    return this.extras.setParticipants(workspaceId, issueId, dto.userIds);
  }

  /** Checklist trong issue. */
  @Get('checklist')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async listChecklist(@WorkspaceId() workspaceId: string, @Param('issueId') issueId: string) {
    return this.extras.listChecklist(workspaceId, issueId);
  }

  @Post('checklist')
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  async addChecklist(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(addChecklistSchema)) dto: AddChecklistInput,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, workspaceId, user.id, issueId);
    return this.extras.addChecklistItem(workspaceId, issueId, dto.text);
  }

  @Patch('checklist/:itemId')
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  async updateChecklist(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(updateChecklistSchema)) dto: UpdateChecklistInput,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, workspaceId, user.id, issueId);
    return this.extras.updateChecklistItem(workspaceId, issueId, itemId, dto);
  }

  @Delete('checklist/:itemId')
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  async removeChecklist(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Param('itemId') itemId: string,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, workspaceId, user.id, issueId);
    return this.extras.removeChecklistItem(workspaceId, issueId, itemId);
  }
}
