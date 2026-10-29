import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import type { AuthUser } from '../../common/types/request';
import { SearchService } from './search.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import {
  relaxCountsSchema,
  validateJqlSchema,
  type RelaxCountsInput,
  type ValidateJqlInput,
} from '@tirapro/shared';
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

  /**
   * Bộ lọc không ra kết quả → đếm số việc khi bỏ từng điều kiện (092). Quyền như `GET /search`; `projectId` trong body
   * để guard kiểm dự án xem được. Mỗi lần gọi chạy tới 8 truy vấn đếm nên throttle riêng 20 lần/phút.
   * Throttle này tính theo IP (tracker mặc định): `ThrottlerGuard` chạy TRƯỚC `JwtAuthGuard` nên chưa có `req.user`, đổi
   * sang khoá theo người dùng cần giải mã JWT trong guard — không rẻ. Trần chống cạn kết nối DB nằm ở
   * `SearchService` (semaphore toàn tiến trình + hạn tổng mỗi request), không dựa vào throttle.
   */
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('body', 'projectId')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('relax-counts')
  relaxCounts(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(relaxCountsSchema)) body: RelaxCountsInput,
  ) {
    return this.search.relaxCounts(workspaceId, user.id, body);
  }
}
