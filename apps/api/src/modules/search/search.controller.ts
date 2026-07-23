import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { SearchService } from './search.service';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  @Get()
  async run(
    @CurrentUser() user: AuthUser,
    @Query('jql') jql?: string,
    @Query('projectId') projectId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return this.search.search(this.ws(user), user.id, { jql, projectId, cursor, limit: lim });
  }

  /** Danh mục giá trị cho bộ dựng truy vấn trực quan (type/status/priority/sprint/label/resolution). */
  @Get('fields')
  async fields(@CurrentUser() user: AuthUser) {
    return this.search.fields(this.ws(user));
  }

  @Post('validate')
  validate(@Body() body: { jql?: string }) {
    return this.search.validate(body?.jql ?? '');
  }
}
