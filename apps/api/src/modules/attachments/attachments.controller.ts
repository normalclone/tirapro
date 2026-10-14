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

@ApiTags('attachments')
@Controller()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  /** Workspace hiện tại của user (bắt buộc đã chọn). */
  @ProjectRef('issue', 'issueId')
  @Post('issues/:issueId/attachments')
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string,
    @Param('issueId') issueId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.attachments.upload(workspaceId, user.id, issueId, file);
  }

  @ProjectRef('issue', 'issueId')
  @Get('issues/:issueId/attachments')
  async list(@WorkspaceId() workspaceId: string, @Param('issueId') issueId: string) {
    return this.attachments.list(workspaceId, issueId);
  }

  @ProjectRef('attachment', 'id')
  @Get('attachments/:id/download')
  async download(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, fileName, mimeType } = await this.attachments.download(workspaceId, id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    );
    return new StreamableFile(stream);
  }

  @ProjectRef('attachment', 'id')
  @Delete('attachments/:id')
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  async remove(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.attachments.remove(workspaceId, id);
  }
}
