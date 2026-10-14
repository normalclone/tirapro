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

@ApiTags('intake')
@Controller('intake')
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  @Permissions(PERMISSIONS.ISSUE_CREATE)
  @Post('report')
  async report(
    @CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(reportIssueSchema)) dto: ReportIssueInput,
  ) {
    return this.intake.report(workspaceId, user.id, dto);
  }

  @Get('duplicates')
  async duplicates(
    @WorkspaceId() workspaceId: string,
    @Query('projectId') projectId: string,
    @Query('summary') summary: string,
  ) {
    return this.intake.findDuplicates(workspaceId, projectId ?? '', summary ?? '');
  }
}
