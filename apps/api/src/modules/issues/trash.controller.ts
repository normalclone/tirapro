import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import type { AuthUser } from '../../common/types/request';
import { IssuesService } from './issues.service';
import { TrashService } from './trash.service';

/** Thùng rác dự án — chỉ người có `issue:delete` (quản trị dự án) xem/khôi phục. projectId lấy từ `params`. */
@ApiTags('trash')
@Controller('projects/:projectId/trash')
export class TrashController {
  constructor(
    private readonly trash: TrashService,
    private readonly issues: IssuesService,
  ) {}

  @Permissions(PERMISSIONS.ISSUE_DELETE)
  @Get()
  list(@WorkspaceId() workspaceId: string, @Param('projectId') projectId: string) {
    return this.trash.list(workspaceId, projectId);
  }

  @Permissions(PERMISSIONS.ISSUE_DELETE)
  @Post(':issueId/restore')
  restore(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('issueId') issueId: string,
  ) {
    return this.issues.restore(workspaceId, user.id, projectId, issueId);
  }
}
