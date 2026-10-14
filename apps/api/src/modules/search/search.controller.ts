import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import type { AuthUser } from '../../common/types/request';
import { SearchService } from './search.service';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  async run(
    @CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string,
    @Query('jql') jql?: string,
    @Query('projectId') projectId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return this.search.search(workspaceId, user.id, { jql, projectId, cursor, limit: lim });
  }

  /** Danh mục giá trị cho bộ dựng truy vấn trực quan (type/status/priority/sprint/label/resolution). */
  @Get('fields')
  async fields(@WorkspaceId() workspaceId: string) {
    return this.search.fields(workspaceId);
  }

  @Post('validate')
  validate(@Body() body: { jql?: string }) {
    return this.search.validate(body?.jql ?? '');
  }
}
