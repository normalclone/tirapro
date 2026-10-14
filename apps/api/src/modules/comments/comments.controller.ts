import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createCommentSchema, type CreateCommentInput } from '@tirapro/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { CommentsService } from './comments.service';

@ApiTags('comments')
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @ProjectRef('issue', 'issueId')
  @Get('issues/:issueId/comments')
  async list(@WorkspaceId() workspaceId: string, @Param('issueId') issueId: string) {
    return this.comments.list(workspaceId, issueId);
  }

  @ProjectRef('issue', 'issueId')
  @Post('issues/:issueId/comments')
  async create(
    @CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(createCommentSchema)) dto: CreateCommentInput,
  ) {
    return this.comments.create(workspaceId, user.id, issueId, dto);
  }

  @ProjectRef('comment', 'id')
  @Patch('comments/:id')
  async update(
    @CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body() body: { body: string; version: number },
  ) {
    return this.comments.update(workspaceId, user.id, id, body.body, body.version);
  }

  @ProjectRef('comment', 'id')
  @Delete('comments/:id')
  async remove(@CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.comments.softDelete(workspaceId, user.id, id);
  }
}
