import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import type { AuthUser } from '../../common/types/request';
import { MeOverviewService } from './me-overview.service';

/** Dữ liệu của CHÍNH người gọi trong workspace hiện tại (theo JWT như mọi API khác). */
@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(private readonly overview: MeOverviewService) {}

  /** Tổng quan cá nhân: số đếm, việc của tôi, bug liên quan đến tôi, điểm đã xong 8 tuần. Chỉ dự án người gọi xem được. */
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @Get('overview')
  async getOverview(@WorkspaceId() workspaceId: string, @CurrentUser() user: AuthUser) {
    return this.overview.overview(workspaceId, user.id);
  }
}
