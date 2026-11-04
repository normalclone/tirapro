import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
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
  async listParticipants(
    @OrganizationId() organizationId: string,
    @Param('issueId') issueId: string,
  ) {
    return this.extras.listParticipants(organizationId, issueId);
  }

  @Put('participants')
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  async setParticipants(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(setParticipantsSchema)) dto: SetParticipantsInput,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, organizationId, user.id, issueId);
    return this.extras.setParticipants(organizationId, issueId, dto.userIds);
  }

  /** Checklist trong issue. */
  @Get('checklist')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async listChecklist(@OrganizationId() organizationId: string, @Param('issueId') issueId: string) {
    return this.extras.listChecklist(organizationId, issueId);
  }

  @Post('checklist')
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  async addChecklist(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(addChecklistSchema)) dto: AddChecklistInput,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, organizationId, user.id, issueId);
    return this.extras.addChecklistItem(organizationId, issueId, dto.text);
  }

  /**
   * Sửa bước. Tick/bỏ tick (`done`) mở cho NGƯỜI ĐƯỢC GIAO dù vai trò không có `issue:edit` (logbug #15); đổi chữ/thứ tự và
   * mọi vai trò còn lại vẫn cần `issue:edit` (hoặc `issue:edit:own` + là chủ việc) — kiểm trong service.
   */
  @Patch('checklist/:itemId')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async updateChecklist(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(updateChecklistSchema)) dto: UpdateChecklistInput,
  ) {
    return this.extras.updateChecklistItem(organizationId, issueId, itemId, dto, user);
  }

  @Delete('checklist/:itemId')
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  async removeChecklist(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Param('itemId') itemId: string,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, organizationId, user.id, issueId);
    return this.extras.removeChecklistItem(organizationId, issueId, itemId);
  }
}
