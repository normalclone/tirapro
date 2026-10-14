import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { linkIssueSchema, type LinkIssueInput } from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { IssueLinksService } from './issue-links.service';

@ApiTags('issue-links')
@Controller()
export class IssueLinksController {
  constructor(private readonly links: IssueLinksService) {}

  /** Danh sách loại liên kết của workspace (chỉ cần xác thực). */
  @Get('link-types')
  async listTypes(@WorkspaceId() workspaceId: string) {
    return this.links.listTypes(workspaceId);
  }

  /** Liên kết của một issue, chuẩn hóa theo góc nhìn issue (chỉ cần xác thực). */
  @ProjectRef('issue', 'issueId')
  @Get('issues/:issueId/links')
  async listForIssue(
    @WorkspaceId() workspaceId: string,
    @Param('issueId') issueId: string,
  ) {
    return this.links.listForIssue(workspaceId, issueId);
  }

  /** Tạo liên kết từ issue nguồn (:issueId) tới issue đích. */
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ProjectRef('issue', 'issueId')
  @Post('issues/:issueId/links')
  async create(
    @WorkspaceId() workspaceId: string,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(linkIssueSchema)) dto: LinkIssueInput,
  ) {
    return this.links.create(workspaceId, issueId, dto);
  }

  /** Xóa liên kết theo id. */
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ProjectRef('issueLink', 'id')
  @Delete('links/:id')
  async remove(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.links.remove(workspaceId, id);
  }
}
