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
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { AttachmentsService } from './attachments.service';

@ApiTags('attachments')
@Controller()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  /** Workspace hiện tại của user (bắt buộc đã chọn). */
  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  @Post('issues/:issueId/attachments')
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.attachments.upload(this.ws(user), user.id, issueId, file);
  }

  @Get('issues/:issueId/attachments')
  async list(@CurrentUser() user: AuthUser, @Param('issueId') issueId: string) {
    return this.attachments.list(this.ws(user), issueId);
  }

  @Get('attachments/:id/download')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, fileName, mimeType } = await this.attachments.download(this.ws(user), id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    );
    return new StreamableFile(stream);
  }

  @Delete('attachments/:id')
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.attachments.remove(this.ws(user), id);
  }
}
