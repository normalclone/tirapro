import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { WatchersService } from './watchers.service';

@ApiTags('watchers')
@Controller()
export class WatchersController {
  constructor(private readonly watchers: WatchersService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  /** Theo dõi issue (trên danh nghĩa của chính tôi). Idempotent. */
  @Post('issues/:issueId/watch')
  async watch(@CurrentUser() user: AuthUser, @Param('issueId') issueId: string) {
    return this.watchers.watch(this.ws(user), user.id, issueId);
  }

  /** Bỏ theo dõi issue. */
  @Delete('issues/:issueId/watch')
  async unwatch(@CurrentUser() user: AuthUser, @Param('issueId') issueId: string) {
    return this.watchers.unwatch(this.ws(user), user.id, issueId);
  }

  /** Danh sách người theo dõi + cờ isWatching của tôi. */
  @Get('issues/:issueId/watchers')
  async list(@CurrentUser() user: AuthUser, @Param('issueId') issueId: string) {
    return this.watchers.list(this.ws(user), user.id, issueId);
  }

  /** Tôi có đang theo dõi issue này không. */
  @Get('issues/:issueId/watch')
  async isWatching(@CurrentUser() user: AuthUser, @Param('issueId') issueId: string) {
    return this.watchers.isWatching(this.ws(user), user.id, issueId);
  }
}
