import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { IntakeService } from './intake.service';
import { reportIssueSchema, type ReportIssueInput } from './intake.schema';

@ApiTags('intake')
@Controller('intake')
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  @Permissions(PERMISSIONS.ISSUE_CREATE)
  @Post('report')
  async report(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(reportIssueSchema)) dto: ReportIssueInput,
  ) {
    return this.intake.report(this.ws(user), user.id, dto);
  }

  @Get('duplicates')
  async duplicates(
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId: string,
    @Query('summary') summary: string,
  ) {
    return this.intake.findDuplicates(this.ws(user), projectId ?? '', summary ?? '');
  }
}
