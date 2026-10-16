import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import type { AuthUser } from '../../common/types/request';
import { SearchService } from './search.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
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
    const hasJql = !!jql?.trim();
    const hasQ = !!q?.trim();
    if (mode !== undefined && mode !== 'jql' && mode !== 'text') {
      throw new BusinessRuleException('mode chỉ nhận "jql" hoặc "text" — hãy chọn một trong hai');
    }
    // Không im lặng trả mọi issue: thiếu điều kiện là lỗi. Chỉ siết ở đây — board/saved-filter gọi thẳng service.
    const effective = mode ?? (hasJql ? 'jql' : hasQ ? 'text' : undefined);
    if (effective === undefined || (effective === 'jql' && !hasJql)) {
      throw new BusinessRuleException(
        'Thiếu điều kiện tìm — dùng jql=… (cú pháp JQL) hoặc q=…&mode=text (tìm theo chữ)',
      );
    }
    return this.search.search(workspaceId, user.id, {
      mode: effective,
      q,
      jql,
      projectId,
      cursor,
      limit: lim,
      checkValues: true,
    });
  }

  /** Danh mục giá trị cho bộ dựng truy vấn trực quan (type/status/priority/sprint/label/resolution). */
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  @Get('fields')
  async fields(@WorkspaceId() workspaceId: string, @CurrentUser() user: AuthUser) {
    return this.search.fields(workspaceId, user.id);
  }

  /** Kiểm cú pháp + giá trị JQL (có "ý bạn là …") cho ô JQL báo lỗi ngay khi gõ. Đọc danh mục workspace nên cần `workspace:view`. */
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  @Post('validate')
  validate(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(validateJqlSchema)) body: ValidateJqlInput,
  ) {
    return this.search.validate(workspaceId, user.id, body.jql ?? '');
  }
}
