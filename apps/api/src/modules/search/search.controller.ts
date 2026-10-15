import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import type { AuthUser } from '../../common/types/request';
import { SearchService } from './search.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { AuthOnly } from '../../common/decorators/auth-only.decorator';
import { validateJqlSchema, type ValidateJqlInput } from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('query', 'projectId')
  @Get()
  async run(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Query('jql') jql?: string,
    @Query('q') q?: string,
    @Query('mode') mode?: string,
    @Query('projectId') projectId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    if (mode !== undefined && mode !== 'jql' && mode !== 'text') {
      throw new BusinessRuleException('mode chỉ nhận "jql" hoặc "text" — hãy chọn một trong hai');
    }
    return this.search.search(workspaceId, user.id, {
      mode,
      q,
      jql,
      projectId,
      cursor,
      limit: lim,
    });
  }

  /** Danh mục giá trị cho bộ dựng truy vấn trực quan (type/status/priority/sprint/label/resolution). */
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  @Get('fields')
  async fields(@WorkspaceId() workspaceId: string) {
    return this.search.fields(workspaceId);
  }

  // Chỉ phân tích cú pháp JQL, không đọc dữ liệu workspace.
  @AuthOnly()
  @Post('validate')
  validate(@Body(new ZodValidationPipe(validateJqlSchema)) body: ValidateJqlInput) {
    return this.search.validate(body.jql ?? '');
  }
}
