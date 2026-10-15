import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import type { AuthUser } from '../../common/types/request';
import { AttachmentsService } from './attachments.service';
import { IssueOwnershipService } from '../rbac/issue-ownership.service';
import { OwnOnly } from '../../common/decorators/own-only.decorator';

@ApiTags('attachments')
@Controller()
export class AttachmentsController {
  constructor(
    private readonly attachments: AttachmentsService,
    private readonly ownership: IssueOwnershipService,
  ) {}

  @ProjectRef('issue', 'issueId')
  @Post('issues/:issueId/attachments')
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @UploadedFile() file: Express.Multer.File,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, workspaceId, user.id, issueId);
    return this.attachments.upload(workspaceId, user.id, issueId, file);
  }

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('issue', 'issueId')
  @Get('issues/:issueId/attachments')
  async list(@WorkspaceId() workspaceId: string, @Param('issueId') issueId: string) {
    return this.attachments.list(workspaceId, issueId);
  }

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('attachment', 'id')
  @Get('attachments/:id/download')
  async download(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, fileName, mimeType } = await this.attachments.download(workspaceId, id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    return new StreamableFile(stream);
  }

  @ProjectRef('attachment', 'id')
  @Delete('attachments/:id')
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  async remove(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsAttachment(ownOnly, workspaceId, user.id, id);
    return this.attachments.remove(workspaceId, id);
  }
}
