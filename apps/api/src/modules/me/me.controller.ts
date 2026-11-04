import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthOnly } from '../../common/decorators/auth-only.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  BusinessRuleException,
  ForbiddenAppException,
} from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import type { Request } from 'express';
import { MeSearchService } from './me-search.service';

/**
 * Điểm vào "phạm vi cá nhân": dữ liệu của CHÍNH người gọi xuyên mọi workspace họ là thành viên — không phụ thuộc workspace
 * đang chọn (không `@WorkspaceId()`). Không có đường tắt RBAC: service lặp qua từng workspace và gọi lại đường tìm kiếm
 * của workspace đó (dự án riêng tư/đã xoá do nó lọc).
 */
@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(private readonly search: MeSearchService) {}

  // Chỉ đọc việc của chính người gọi (user.id từ token) trong các workspace họ là thành viên; quyền xem từng dự án do
  // đường tìm kiếm workspace kiểm — không cần quyền RBAC cấp workspace vì không gắn với workspace nào.
  @AuthOnly()
  @Get('search')
  async run(
    @CurrentUser() user: AuthUser,
    @Req() req: Request & { apiKey?: unknown },
    @Query('jql') jql?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    // API key gắn với MỘT workspace (và phạm vi của nó): không được dùng để đọc xuyên workspace của chủ key.
    if (req.apiKey) {
      throw new ForbiddenAppException(
        'Chỉ phiên đăng nhập của người dùng mới tìm xuyên không gian làm việc',
      );
    }
    if (!jql?.trim()) {
      throw new BusinessRuleException('Thiếu điều kiện tìm — dùng jql=… (cú pháp JQL)');
    }
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return this.search.search(user.id, { jql, cursor, limit: lim });
  }
}
