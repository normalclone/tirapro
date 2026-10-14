import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import type { AuthUser } from '../../common/types/request';
import { WatchersService } from './watchers.service';

@ApiTags('watchers')
@Controller()
export class WatchersController {
  constructor(private readonly watchers: WatchersService) {}

  /** Theo dõi issue (trên danh nghĩa của chính tôi). Idempotent. */
  @ProjectRef('issue', 'issueId')
  @Post('issues/:issueId/watch')
  async watch(@CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string, @Param('issueId') issueId: string) {
    return this.watchers.watch(workspaceId, user.id, issueId);
  }

  /** Bỏ theo dõi issue. */
  @ProjectRef('issue', 'issueId')
  @Delete('issues/:issueId/watch')
  async unwatch(@CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string, @Param('issueId') issueId: string) {
    return this.watchers.unwatch(workspaceId, user.id, issueId);
  }

  /** Danh sách người theo dõi + cờ isWatching của tôi. */
  @ProjectRef('issue', 'issueId')
  @Get('issues/:issueId/watchers')
  async list(@CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string, @Param('issueId') issueId: string) {
    return this.watchers.list(workspaceId, user.id, issueId);
  }

  /** Tôi có đang theo dõi issue này không. */
  @ProjectRef('issue', 'issueId')
  @Get('issues/:issueId/watch')
  async isWatching(@CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string, @Param('issueId') issueId: string) {
    return this.watchers.isWatching(workspaceId, user.id, issueId);
  }
}
