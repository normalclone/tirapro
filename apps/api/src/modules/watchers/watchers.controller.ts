import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import type { AuthUser } from '../../common/types/request';
import { WatchersService } from './watchers.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '@tirapro/types';

@ApiTags('watchers')
@Controller()
export class WatchersController {
  constructor(private readonly watchers: WatchersService) {}

  /** Theo dõi issue (trên danh nghĩa của chính tôi). Idempotent. */
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('issue', 'issueId')
  @Post('issues/:issueId/watch')
  async watch(@CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string, @Param('issueId') issueId: string) {
    return this.watchers.watch(workspaceId, user.id, issueId);
  }

  /** Bỏ theo dõi issue. */
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('issue', 'issueId')
  @Delete('issues/:issueId/watch')
  async unwatch(@CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string, @Param('issueId') issueId: string) {
    return this.watchers.unwatch(workspaceId, user.id, issueId);
  }

  /** Danh sách người theo dõi + cờ isWatching của tôi. */
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('issue', 'issueId')
  @Get('issues/:issueId/watchers')
  async list(@CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string, @Param('issueId') issueId: string) {
    return this.watchers.list(workspaceId, user.id, issueId);
  }

  /** Tôi có đang theo dõi issue này không. */
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('issue', 'issueId')
  @Get('issues/:issueId/watch')
  async isWatching(@CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string, @Param('issueId') issueId: string) {
    return this.watchers.isWatching(workspaceId, user.id, issueId);
  }
}
