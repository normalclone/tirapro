import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { IssueExtrasService } from './issue-extras.service';
import {
  setParticipantsSchema, addChecklistSchema, updateChecklistSchema,
  type SetParticipantsInput, type AddChecklistInput, type UpdateChecklistInput,
} from './issue-extras.schemas';

@ApiTags('issues')
@Controller('issues/:issueId')
export class IssueExtrasController {
  constructor(private readonly extras: IssueExtrasService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Bạn chưa chọn không gian làm việc — hãy chọn một không gian rồi thử lại');
    return user.workspaceId;
  }

  /** Người tham gia issue (ngoài người phụ trách & người báo cáo). */
  @Get('participants')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async listParticipants(@CurrentUser() user: AuthUser, @Param('issueId') issueId: string) {
    return this.extras.listParticipants(this.ws(user), issueId);
  }

  @Put('participants')
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  async setParticipants(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(setParticipantsSchema)) dto: SetParticipantsInput,
  ) {
    return this.extras.setParticipants(this.ws(user), issueId, dto.userIds);
  }

  /** Checklist trong issue. */
  @Get('checklist')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async listChecklist(@CurrentUser() user: AuthUser, @Param('issueId') issueId: string) {
    return this.extras.listChecklist(this.ws(user), issueId);
  }

  @Post('checklist')
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  async addChecklist(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(addChecklistSchema)) dto: AddChecklistInput,
  ) {
    return this.extras.addChecklistItem(this.ws(user), issueId, dto.text);
  }

  @Patch('checklist/:itemId')
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  async updateChecklist(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(updateChecklistSchema)) dto: UpdateChecklistInput,
  ) {
    return this.extras.updateChecklistItem(this.ws(user), issueId, itemId, dto);
  }

  @Delete('checklist/:itemId')
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  async removeChecklist(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.extras.removeChecklistItem(this.ws(user), issueId, itemId);
  }
}
