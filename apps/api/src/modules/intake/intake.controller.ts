import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { IntakeService } from './intake.service';
import { reportIssueSchema, type ReportIssueInput } from './intake.schema';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';

@ApiTags('intake')
@Controller('intake')
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  @Permissions(PERMISSIONS.ISSUE_CREATE)
  @Post('report')
  async report(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(reportIssueSchema)) dto: ReportIssueInput,
  ) {
    // Gộp vào bug cũ = một bình luận nên cần `comment:create` ở dự án (guard đã nạp quyền hiệu lực vào user.permissions).
    const canComment =
      !!user.isSystemAdmin || !!user.permissions?.some((p) => p === PERMISSIONS.COMMENT_CREATE);
    return this.intake.report(workspaceId, user.id, dto, { canComment });
  }

  @Permissions(PERMISSIONS.ISSUE_CREATE)
  @ProjectRef('query', 'projectId')
  @Get('duplicates')
  async duplicates(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId: string,
    @Query('summary') summary: string,
    @Query('limit') limit?: string,
  ) {
    const n = Number(limit);
    return this.intake.findDuplicates(
      workspaceId,
      projectId ?? '',
      summary ?? '',
      Number.isFinite(n) && n > 0 ? n : undefined,
      user.id,
    );
  }
}
