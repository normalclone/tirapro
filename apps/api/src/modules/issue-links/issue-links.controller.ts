import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { linkIssueSchema, type LinkIssueInput } from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { IssueLinksService } from './issue-links.service';
import { IssueOwnershipService } from '../rbac/issue-ownership.service';
import { OwnOnly } from '../../common/decorators/own-only.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/request';

@ApiTags('issue-links')
@Controller()
export class IssueLinksController {
  constructor(
    private readonly links: IssueLinksService,
    private readonly ownership: IssueOwnershipService,
  ) {}

  /** Danh sách loại liên kết của workspace (chỉ cần xác thực). */
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  @Get('link-types')
  async listTypes(@WorkspaceId() workspaceId: string) {
    return this.links.listTypes(workspaceId);
  }

  /** Liên kết của một issue, chuẩn hóa theo góc nhìn issue (chỉ cần xác thực). */
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('issue', 'issueId')
  @Get('issues/:issueId/links')
  async listForIssue(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
  ) {
    return this.links.listForIssue(workspaceId, issueId, user);
  }

  /** Tạo liên kết giữa :issueId và issue đích; `direction` chọn công việc đang xem là nguồn (outward) hay đích (inward). */
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ProjectRef('issue', 'issueId')
  @Post('issues/:issueId/links')
  async create(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(linkIssueSchema)) dto: LinkIssueInput,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, workspaceId, user.id, issueId);
    return this.links.create(workspaceId, issueId, dto, user);
  }

  /** Xóa liên kết theo id. */
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ProjectRef('issueLink', 'id')
  @Delete('links/:id')
  async remove(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsLinkSource(ownOnly, workspaceId, user.id, id);
    return this.links.remove(workspaceId, id, user);
  }
}
