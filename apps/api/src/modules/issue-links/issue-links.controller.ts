import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { linkIssueSchema, type LinkIssueInput } from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { IssueLinksService } from './issue-links.service';

@ApiTags('issue-links')
@Controller()
export class IssueLinksController {
  constructor(private readonly links: IssueLinksService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  /** Danh sách loại liên kết của workspace (chỉ cần xác thực). */
  @Get('link-types')
  async listTypes(@CurrentUser() user: AuthUser) {
    return this.links.listTypes(this.ws(user));
  }

  /** Liên kết của một issue, chuẩn hóa theo góc nhìn issue (chỉ cần xác thực). */
  @Get('issues/:issueId/links')
  async listForIssue(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
  ) {
    return this.links.listForIssue(this.ws(user), issueId);
  }

  /** Tạo liên kết từ issue nguồn (:issueId) tới issue đích. */
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @Post('issues/:issueId/links')
  async create(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(linkIssueSchema)) dto: LinkIssueInput,
  ) {
    return this.links.create(this.ws(user), issueId, dto);
  }

  /** Xóa liên kết theo id. */
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @Delete('links/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.links.remove(this.ws(user), id);
  }
}
