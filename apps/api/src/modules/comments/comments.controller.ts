import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createCommentSchema, updateCommentSchema, type CreateCommentInput, type UpdateCommentInput } from '@tirapro/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { CommentsService } from './comments.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '@tirapro/types';

@ApiTags('comments')
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('issue', 'issueId')
  @Get('issues/:issueId/comments')
  async list(@WorkspaceId() workspaceId: string, @Param('issueId') issueId: string) {
    return this.comments.list(workspaceId, issueId);
  }

  @Permissions(PERMISSIONS.COMMENT_CREATE)
  @ProjectRef('issue', 'issueId')
  @Post('issues/:issueId/comments')
  async create(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(createCommentSchema)) dto: CreateCommentInput,
  ) {
    return this.comments.create(workspaceId, user.id, issueId, dto);
  }

  @Permissions(PERMISSIONS.COMMENT_EDIT_OWN)
  @ProjectRef('comment', 'id')
  @Patch('comments/:id')
  async update(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCommentSchema)) body: UpdateCommentInput,
  ) {
    return this.comments.update(workspaceId, user.id, id, body.body, body.version);
  }

  @Permissions(PERMISSIONS.COMMENT_EDIT_OWN)
  @ProjectRef('comment', 'id')
  @Delete('comments/:id')
  async remove(@CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string, @Param('id') id: string) {
    // Guard chỉ đòi quyền sửa-của-mình; xoá bình luận của người khác cần thêm comment:delete.
    const canDeleteAny = user.isSystemAdmin || (user.permissions?.includes(PERMISSIONS.COMMENT_DELETE) ?? false);
    return this.comments.softDelete(workspaceId, user.id, id, canDeleteAny);
  }
}
