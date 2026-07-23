import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createCommentSchema, type CreateCommentInput } from '@tirapro/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { CommentsService } from './comments.service';

@ApiTags('comments')
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  @Get('issues/:issueId/comments')
  async list(@CurrentUser() user: AuthUser, @Param('issueId') issueId: string) {
    return this.comments.list(this.ws(user), issueId);
  }

  @Post('issues/:issueId/comments')
  async create(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(createCommentSchema)) dto: CreateCommentInput,
  ) {
    return this.comments.create(this.ws(user), user.id, issueId, dto);
  }

  @Patch('comments/:id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { body: string; version: number },
  ) {
    return this.comments.update(this.ws(user), user.id, id, body.body, body.version);
  }

  @Delete('comments/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.comments.softDelete(this.ws(user), user.id, id);
  }
}
