import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { TriageService } from './triage.service';

const acceptSchema = z.object({
  version: z.number().int().nonnegative(),
  assigneeId: z.string().optional(),
});
type AcceptInput = z.infer<typeof acceptSchema>;

const declineSchema = z.object({
  version: z.number().int().nonnegative(),
  reason: z.string().optional(),
});
type DeclineInput = z.infer<typeof declineSchema>;

const snoozeSchema = z.object({
  version: z.number().int().nonnegative(),
  until: z.string().datetime(),
});
type SnoozeInput = z.infer<typeof snoozeSchema>;

@ApiTags('triage')
@Controller('triage')
export class TriageController {
  constructor(private readonly triage: TriageService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  @Get()
  async inbox(
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.triage.inbox(
      this.ws(user),
      projectId,
      cursor,
      Math.min(Math.max(Number(limit) || 50, 1), 100),
    );
  }

  @Get('count')
  async count(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) {
    return this.triage.count(this.ws(user), projectId);
  }

  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @Post(':issueId/accept')
  async accept(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(acceptSchema)) dto: AcceptInput,
  ) {
    return this.triage.accept(this.ws(user), user.id, issueId, dto);
  }

  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @Post(':issueId/decline')
  async decline(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(declineSchema)) dto: DeclineInput,
  ) {
    return this.triage.decline(this.ws(user), user.id, issueId, dto);
  }

  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @Post(':issueId/snooze')
  async snooze(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(snoozeSchema)) dto: SnoozeInput,
  ) {
    return this.triage.snooze(this.ws(user), user.id, issueId, dto);
  }
}
